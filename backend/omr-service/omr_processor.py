"""
OMR Processor — Student identity + MCQ answer reading via OpenCV.

Uses vectorized numpy/OpenCV ops. Works at a normalized resolution
(800 wide) for consistent results regardless of input image size.

Calibrated ROI positions for the standard exam template generated
by the system's docx.service.
"""

import cv2
import numpy as np
import os

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WORKING_WIDTH = 800

STUDENT_CODE_COLUMNS = 8
STUDENT_CODE_DIGIT_ROWS = 10

# Calibrated ROI for MSSV region (relative to working-size image).
#
# The search ROI is intentionally wider than the actual 8x10 grid. Phone
# captures in the test set use the resize fallback and can shift/compress the
# right edge enough that a tight static ROI clips the last MSSV column.
STUDENT_CODE_ROI = {"x": 0.63, "y": 0.12, "width": 0.27, "height": 0.30}
STUDENT_CODE_SEARCH_ROI = {"x": 0.55, "y": 0.08, "width": 0.43, "height": 0.34}
STUDENT_CODE_HEADER_FRAC = 0.20  # Top 20% is label/header, skip it
STUDENT_CODE_GRID_HEADER_FRAC = 0.12  # Header row inside the detected MSSV table

# MCQ answer region ROI.
MCQ_ROI = {"x": 0.03, "y": 0.42, "width": 0.94, "height": 0.52}

MCQ_COLUMN_COUNT = 4
MCQ_ROWS_PER_COLUMN = 13
MCQ_OPTIONS = ["A", "B", "C", "D"]

MIN_MARK_THRESHOLD = 0.20
TIE_GAP = 0.06

DEBUG = os.environ.get("OMR_DEBUG", "0") == "1"


# ---------------------------------------------------------------------------
# Preprocessing
# ---------------------------------------------------------------------------

def _order_corners(pts: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    rect[1] = pts[np.argmin(d)]
    rect[3] = pts[np.argmax(d)]
    return rect


def _detect_document_corners(gray: np.ndarray):
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]
    for c in contours:
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)
    return None


def preprocess_image(image_path: str):
    """Load and normalize image to WORKING_WIDTH with A4 aspect ratio."""
    warnings = []
    image = cv2.imread(image_path)
    if image is None:
        return None, ["Cannot read image file"]

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape[:2]

    working_h = int(WORKING_WIDTH * 3508 / 2480)

    # Try perspective warp
    corners = _detect_document_corners(gray)
    if corners is not None:
        area_ratio = cv2.contourArea(corners) / max(1, w * h)
        if area_ratio > 0.7:
            ordered = _order_corners(corners)
            dst = np.array([
                [0, 0], [WORKING_WIDTH - 1, 0],
                [WORKING_WIDTH - 1, working_h - 1], [0, working_h - 1]
            ], dtype=np.float32)
            M = cv2.getPerspectiveTransform(ordered, dst)
            warped = cv2.warpPerspective(gray, M, (WORKING_WIDTH, working_h))
            return warped, warnings

    # Fallback: resize to working dimensions
    warnings.append("Using direct resize fallback")
    return cv2.resize(gray, (WORKING_WIDTH, working_h), interpolation=cv2.INTER_LINEAR), warnings


# ---------------------------------------------------------------------------
# Bubble Scoring
# ---------------------------------------------------------------------------

def _score_cell(binary_roi: np.ndarray, cx: int, cy: int, r: int) -> float:
    """Score a bubble cell in a pre-binarized image."""
    h, w = binary_roi.shape[:2]
    top = max(0, cy - r)
    bottom = min(h, cy + r + 1)
    left = max(0, cx - r)
    right = min(w, cx + r + 1)
    if bottom <= top or right <= left:
        return 0.0
    patch = binary_roi[top:bottom, left:right]
    if patch.size < 4:
        return 0.0
    return float(np.sum(patch > 0)) / float(patch.size)


# ---------------------------------------------------------------------------
# MSSV Recognition
# ---------------------------------------------------------------------------

def _crop_roi(gray: np.ndarray, roi: dict) -> np.ndarray:
    h, w = gray.shape[:2]
    x = int(w * roi["x"])
    y = int(h * roi["y"])
    rw = int(w * roi["width"])
    rh = int(h * roi["height"])
    return gray[y:y + rh, x:x + rw]


def _find_student_grid(gray: np.ndarray):
    """Find the MSSV 8x10 table inside the wider identity search area."""
    search = _crop_roi(gray, STUDENT_CODE_SEARCH_ROI)
    rh, rw = search.shape[:2]
    if rw < 40 or rh < 80:
        return None

    _, binary = cv2.threshold(search, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    dilated = cv2.dilate(
        binary,
        cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)),
        iterations=1,
    )

    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(dilated, 8)
    candidates = []
    for label in range(1, num_labels):
        x, y, w, h, area = stats[label]
        if w < rw * 0.45 or h < rh * 0.55:
            continue
        aspect = w / max(1, h)
        if 0.55 <= aspect <= 1.10:
            candidates.append((int(area), int(x), int(y), int(w), int(h)))

    if not candidates:
        return None

    _, x, y, w, h = max(candidates, key=lambda item: item[0])
    pad = 1
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(rw, x + w + pad)
    y1 = min(rh, y + h + pad)
    return search[y0:y1, x0:x1]


def extract_student_code(warped_gray: np.ndarray) -> dict:
    """Extract 8-digit student code from MSSV bubble grid."""
    warnings = []
    grid = _find_student_grid(warped_gray)
    adaptive = grid is not None

    if grid is None:
        warnings.append("Using static MSSV ROI fallback")
        roi = _crop_roi(warped_gray, STUDENT_CODE_ROI)
        rh, rw = roi.shape[:2]

        if rw < 10 or rh < 10:
            return {"studentCode": None, "confidence": 0.0, "warnings": ["MSSV ROI too small"]}

        grid_start_y = int(rh * STUDENT_CODE_HEADER_FRAC)
        grid = roi[grid_start_y:rh, 0:rw]
    else:
        grid_start_y = int(grid.shape[0] * STUDENT_CODE_GRID_HEADER_FRAC)
        grid = grid[grid_start_y:grid.shape[0], 0:grid.shape[1]]

    rh, rw = grid.shape[:2]
    if rw < 10 or rh < 10:
        return {"studentCode": None, "confidence": 0.0, "warnings": ["MSSV grid too small"]}

    _, binary = cv2.threshold(grid, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    cell_w = rw / STUDENT_CODE_COLUMNS
    cell_h = rh / STUDENT_CODE_DIGIT_ROWS
    r = max(3, int(min(cell_w, cell_h) * (0.20 if adaptive else 0.25)))

    digits = []
    total_confidence = 0.0
    detected = 0

    for col in range(STUDENT_CODE_COLUMNS):
        cx = int((col + 0.5) * cell_w)
        fills = []

        for row in range(STUDENT_CODE_DIGIT_ROWS):
            cy = int((row + 0.5) * cell_h)
            fill = _score_cell(binary, cx, cy, r)
            fills.append(fill)

        fills_arr = np.array(fills)
        sorted_idx = np.argsort(fills_arr)[::-1]
        best_digit = int(sorted_idx[0])
        best_fill = float(fills_arr[best_digit])
        second_fill = float(fills_arr[sorted_idx[1]]) if len(sorted_idx) > 1 else 0.0
        gap = best_fill - second_fill

        if DEBUG:
            top3 = [(int(sorted_idx[i]), round(float(fills_arr[sorted_idx[i]]), 3)) for i in range(min(3, len(sorted_idx)))]
            print(f"[OMR] MSSV col {col + 1}: best=digit{best_digit}({best_fill:.3f}) gap={gap:.3f} top3={top3}")

        if best_fill < MIN_MARK_THRESHOLD or gap < TIE_GAP:
            warnings.append(f"MSSV column {col + 1} not confident")
            digits.append("?")
        else:
            digits.append(str(best_digit))
            detected += 1
            total_confidence += min(1.0, best_fill)

    code = "".join(digits) if not all(d == "?" for d in digits) else None
    if code and "?" in code:
        warnings.append(f"Partial MSSV: {code}")

    confidence = total_confidence / max(1, detected) if detected > 0 else 0.0
    return {"studentCode": code, "confidence": round(confidence, 3), "warnings": warnings}


# ---------------------------------------------------------------------------
# MCQ Recognition
# ---------------------------------------------------------------------------

def extract_mcq_answers(warped_gray: np.ndarray, total_questions: int = 52) -> dict:
    """Extract MCQ answers from the answer grid."""
    warnings = []
    roi = _crop_roi(warped_gray, MCQ_ROI)
    rh, rw = roi.shape[:2]

    if rw < 20 or rh < 20:
        return {"answers": {}, "warnings": ["MCQ ROI too small"]}

    # Apply Otsu on the MCQ region
    _, binary = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    answers = {}
    col_width = rw / MCQ_COLUMN_COUNT
    header_ratio = 0.06
    row_start_y = int(rh * header_ratio)
    row_area_height = rh - row_start_y
    row_height = row_area_height / MCQ_ROWS_PER_COLUMN

    bubble_start = 0.30
    bubble_end = 0.92
    bubble_span = bubble_end - bubble_start
    r = max(2, int(min(col_width * 0.07, row_height * 0.22)))

    qnum = 0
    for col_idx in range(MCQ_COLUMN_COUNT):
        col_x = int(col_idx * col_width)
        for row_idx in range(MCQ_ROWS_PER_COLUMN):
            qnum += 1
            if qnum > total_questions:
                break

            cy = row_start_y + int((row_idx + 0.5) * row_height)
            scores = []

            for opt_idx, label in enumerate(MCQ_OPTIONS):
                frac = (opt_idx + 0.5) / len(MCQ_OPTIONS)
                bx = col_x + int((bubble_start + frac * bubble_span) * col_width)
                fill = _score_cell(binary, bx, cy, r)
                scores.append((label, fill))

            scores.sort(key=lambda s: s[1], reverse=True)
            best_label, best_fill = scores[0]
            _, second_fill = scores[1] if len(scores) > 1 else ("", 0.0)
            gap = best_fill - second_fill

            if best_fill >= MIN_MARK_THRESHOLD and gap >= TIE_GAP:
                answers[str(qnum)] = best_label
            elif best_fill >= MIN_MARK_THRESHOLD:
                warnings.append(f"Q{qnum}: ambiguous")

    return {"answers": answers, "warnings": warnings}


# ---------------------------------------------------------------------------
# Main Entry Point
# ---------------------------------------------------------------------------

def process_omr_image(image_path: str, total_questions: int = 52) -> dict:
    """
    Process exam scan: extract student code and MCQ answers.

    Returns:
        {
            "studentCode": "22521000" | null,
            "answers": { "1": "A", "2": "C", ... },
            "confidence": 0.92,
            "warnings": ["..."]
        }
    """
    all_warnings = []

    warped_gray, pw = preprocess_image(image_path)
    all_warnings.extend(pw)

    if warped_gray is None:
        return {"studentCode": None, "answers": {}, "confidence": 0.0, "warnings": all_warnings}

    identity = extract_student_code(warped_gray)
    all_warnings.extend(identity.get("warnings", []))

    mcq = extract_mcq_answers(warped_gray, total_questions)
    all_warnings.extend(mcq.get("warnings", []))

    return {
        "studentCode": identity["studentCode"],
        "answers": mcq["answers"],
        "confidence": identity["confidence"],
        "warnings": list(set(all_warnings)),
    }
