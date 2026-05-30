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

# MCQ answer table fallback ROI. The processor prefers dynamic table-line
# detection; this static layout is only used when the table borders are not
# confidently detected.
MCQ_ROI = {"x": 0.09, "y": 0.467, "width": 0.85, "height": 0.452}

MCQ_COLUMN_COUNT = 4
MCQ_ROWS_PER_COLUMN = 13
MCQ_OPTIONS = ["A", "B", "C", "D"]

MIN_MARK_THRESHOLD = 0.20
TIE_GAP = 0.06

MCQ_DYNAMIC_HEADER_RATIO = 0.07
MCQ_DYNAMIC_BUBBLE_START = 0.17
MCQ_DYNAMIC_BUBBLE_END = 0.91
MCQ_FALLBACK_HEADER_RATIO = MCQ_DYNAMIC_HEADER_RATIO
MCQ_FALLBACK_BUBBLE_START = MCQ_DYNAMIC_BUBBLE_START
MCQ_FALLBACK_BUBBLE_END = MCQ_DYNAMIC_BUBBLE_END

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


def _refine_filled_bubble_center(binary_roi: np.ndarray, cx: int, cy: int, r: int):
    """Snap an accepted filled bubble to the centroid of its dark pixels."""
    h, w = binary_roi.shape[:2]
    search_r = max(r + 2, int(r * 1.9))
    top = max(0, cy - search_r)
    bottom = min(h, cy + search_r + 1)
    left = max(0, cx - search_r)
    right = min(w, cx + search_r + 1)
    patch = binary_roi[top:bottom, left:right]
    if patch.size < 16:
        return int(cx), int(cy)

    ys, xs = np.where(patch > 0)
    if len(xs) < max(8, r):
        return int(cx), int(cy)

    refined_x = int(round(left + float(xs.mean())))
    refined_y = int(round(top + float(ys.mean())))
    max_shift = max(2, int(r * 0.8))
    if abs(refined_x - cx) > max_shift or abs(refined_y - cy) > max_shift:
        return int(cx), int(cy)
    return refined_x, refined_y


def _refine_bubble_center(binary_roi: np.ndarray, cx: int, cy: int, r: int):
    """Snap a bubble to the nearby printed/filled mark center.

    The first-pass grid gives reliable row/option ordering, but percentage
    positions can drift a few pixels on phone captures. Refining every option
    keeps both scoring and exported red/green markers on the physical bubbles.
    """
    h, w = binary_roi.shape[:2]
    search_r = max(r + 5, int(r * 2.2))
    top = max(0, cy - search_r)
    bottom = min(h, cy + search_r + 1)
    left = max(0, cx - search_r)
    right = min(w, cx + search_r + 1)
    patch = binary_roi[top:bottom, left:right]
    if patch.size < 16:
        return int(cx), int(cy)

    ys, xs = np.where(patch > 0)
    if len(xs) < max(6, r):
        return int(cx), int(cy)

    # Ignore marks near the edge of the search window; those usually belong to
    # neighboring bubbles or question text rather than this option.
    local_cx = cx - left
    local_cy = cy - top
    dist = np.sqrt((xs - local_cx) ** 2 + (ys - local_cy) ** 2)
    keep = dist <= search_r * 0.78
    if int(np.sum(keep)) < max(6, r):
        return int(cx), int(cy)

    refined_x = int(round(left + float(xs[keep].mean())))
    refined_y = int(round(top + float(ys[keep].mean())))
    max_shift = max(2, int(r * 0.9))
    if abs(refined_x - cx) > max_shift or abs(refined_y - cy) > max_shift:
        return int(cx), int(cy)
    return refined_x, refined_y


def _group_projection_indices(indices: np.ndarray, projection: np.ndarray, gap: int = 1):
    """Group adjacent projection indexes and keep each group's peak strength."""
    if len(indices) == 0:
        return []

    groups = []
    start = prev = int(indices[0])
    for raw_index in indices[1:]:
        index = int(raw_index)
        if index > prev + gap:
            groups.append((start, prev, int(projection[start:prev + 1].max())))
            start = index
        prev = index

    groups.append((start, prev, int(projection[start:prev + 1].max())))
    return groups


# ---------------------------------------------------------------------------
# MSSV Recognition
# ---------------------------------------------------------------------------

def _roi_bounds(gray: np.ndarray, roi: dict):
    h, w = gray.shape[:2]
    x = int(w * roi["x"])
    y = int(h * roi["y"])
    rw = int(w * roi["width"])
    rh = int(h * roi["height"])
    return x, y, rw, rh


def _crop_roi(gray: np.ndarray, roi: dict) -> np.ndarray:
    x, y, rw, rh = _roi_bounds(gray, roi)
    return gray[y:y + rh, x:x + rw]


def _find_student_grid(gray: np.ndarray):
    """Find the MSSV 8x10 table inside the wider identity search area."""
    search_x, search_y, _, _ = _roi_bounds(gray, STUDENT_CODE_SEARCH_ROI)
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
    return {
        "image": search[y0:y1, x0:x1],
        "x": int(search_x + x0),
        "y": int(search_y + y0),
    }


def extract_student_code(warped_gray: np.ndarray) -> dict:
    """Extract 8-digit student code from MSSV bubble grid."""
    warnings = []
    grid_result = _find_student_grid(warped_gray)
    adaptive = grid_result is not None

    if grid_result is None:
        warnings.append("Using static MSSV ROI fallback")
        roi_x, roi_y, _, _ = _roi_bounds(warped_gray, STUDENT_CODE_ROI)
        roi = _crop_roi(warped_gray, STUDENT_CODE_ROI)
        rh, rw = roi.shape[:2]

        if rw < 10 or rh < 10:
            return {"studentCode": None, "confidence": 0.0, "warnings": ["MSSV ROI too small"]}

        grid_start_y = int(rh * STUDENT_CODE_HEADER_FRAC)
        grid = roi[grid_start_y:rh, 0:rw]
        grid_x = roi_x
        grid_y = roi_y + grid_start_y
    else:
        raw_grid = grid_result["image"]
        grid_start_y = int(raw_grid.shape[0] * STUDENT_CODE_GRID_HEADER_FRAC)
        grid = raw_grid[grid_start_y:raw_grid.shape[0], 0:raw_grid.shape[1]]
        grid_x = int(grid_result["x"])
        grid_y = int(grid_result["y"] + grid_start_y)

    rh, rw = grid.shape[:2]
    if rw < 10 or rh < 10:
        return {"studentCode": None, "confidence": 0.0, "warnings": ["MSSV grid too small"]}

    _, binary = cv2.threshold(grid, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    cell_w = rw / STUDENT_CODE_COLUMNS
    cell_h = rh / STUDENT_CODE_DIGIT_ROWS
    r = max(3, int(min(cell_w, cell_h) * (0.20 if adaptive else 0.25)))

    digits = []
    digit_bubbles = []
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
            raw_cx = int((col + 0.5) * cell_w)
            raw_cy = int((best_digit + 0.5) * cell_h)
            refined_cx, refined_cy = _refine_filled_bubble_center(binary, raw_cx, raw_cy, r)
            digit_bubbles.append({
                "column": int(col + 1),
                "digit": int(best_digit),
                "cx": int(grid_x + refined_cx),
                "cy": int(grid_y + refined_cy),
                "r": int(r),
            })

    code = "".join(digits) if not all(d == "?" for d in digits) else None
    if code and "?" in code:
        warnings.append(f"Partial MSSV: {code}")

    confidence = total_confidence / max(1, detected) if detected > 0 else 0.0
    return {
        "studentCode": code,
        "identityLayout": {
            "referenceWidth": int(warped_gray.shape[1]),
            "referenceHeight": int(warped_gray.shape[0]),
            "source": "detected_table" if adaptive else "static_roi",
            "digits": digit_bubbles,
        },
        "confidence": round(confidence, 3),
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# MCQ Recognition
# ---------------------------------------------------------------------------

def _find_mcq_table_bounds(warped_gray: np.ndarray):
    """Locate the printed MCQ answer table using long table lines."""
    h, w = warped_gray.shape[:2]
    _, binary = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    vertical_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (1, max(35, int(h * 0.035))),
    )
    vertical_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    vertical_projection = (vertical_lines[h // 3:, :] > 0).sum(axis=0)
    vertical_groups = _group_projection_indices(
        np.where(vertical_projection > max(45, h * 0.035))[0],
        vertical_projection,
    )

    strongest_vertical = sorted(vertical_groups, key=lambda item: item[2], reverse=True)[:5]
    if len(strongest_vertical) < 5:
        return None

    vertical_centers = sorted((start + end) // 2 for start, end, _ in strongest_vertical)
    vertical_spacings = np.diff(vertical_centers)
    if (
        len(vertical_spacings) != MCQ_COLUMN_COUNT
        or min(vertical_spacings) < w * 0.12
        or max(vertical_spacings) - min(vertical_spacings) > w * 0.08
    ):
        return None

    left = int(vertical_centers[0])
    right = int(vertical_centers[-1])
    if right <= left:
        return None

    horizontal_kernel = cv2.getStructuringElement(
        cv2.MORPH_RECT,
        (max(40, int(w * 0.25)), 1),
    )
    horizontal_lines = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    horizontal_projection = (horizontal_lines[:, max(0, left):min(w, right)] > 0).sum(axis=1)
    horizontal_groups = _group_projection_indices(
        np.where(horizontal_projection > (right - left) * 0.65)[0],
        horizontal_projection,
    )

    strong_horizontal = [
        group for group in horizontal_groups
        if ((group[0] + group[1]) // 2) > h * 0.35
    ]
    strongest_horizontal = sorted(strong_horizontal, key=lambda item: item[2], reverse=True)[:2]
    if len(strongest_horizontal) < 2:
        return None

    horizontal_centers = sorted((start + end) // 2 for start, end, _ in strongest_horizontal)
    top = int(horizontal_centers[0])
    bottom = int(horizontal_centers[-1])
    if bottom <= top or bottom - top < h * 0.20:
        return None

    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "source": "detected_table",
    }


def _build_mcq_layout(warped_gray: np.ndarray, total_questions: int = 52):
    h, w = warped_gray.shape[:2]
    bounds = _find_mcq_table_bounds(warped_gray)

    if bounds is None:
        left = int(w * MCQ_ROI["x"])
        top = int(h * MCQ_ROI["y"])
        right = int(w * (MCQ_ROI["x"] + MCQ_ROI["width"]))
        bottom = int(h * (MCQ_ROI["y"] + MCQ_ROI["height"]))
        header_ratio = MCQ_FALLBACK_HEADER_RATIO
        bubble_start = MCQ_FALLBACK_BUBBLE_START
        bubble_end = MCQ_FALLBACK_BUBBLE_END
        source = "static_roi"
    else:
        left = bounds["left"]
        top = bounds["top"]
        right = bounds["right"]
        bottom = bounds["bottom"]
        header_ratio = MCQ_DYNAMIC_HEADER_RATIO
        bubble_start = MCQ_DYNAMIC_BUBBLE_START
        bubble_end = MCQ_DYNAMIC_BUBBLE_END
        source = bounds["source"]

    table_width = right - left
    table_height = bottom - top
    if table_width < 20 or table_height < 20:
        return None

    col_width = table_width / MCQ_COLUMN_COUNT
    row_start_y = top + int(table_height * header_ratio)
    row_area_height = bottom - row_start_y
    row_height = row_area_height / MCQ_ROWS_PER_COLUMN
    bubble_span = bubble_end - bubble_start
    radius = max(4, int(min(col_width * 0.07, row_height * 0.24)))

    questions = []
    qnum = 0
    for col_idx in range(MCQ_COLUMN_COUNT):
        col_x = left + col_idx * col_width
        for row_idx in range(MCQ_ROWS_PER_COLUMN):
            qnum += 1
            if qnum > total_questions:
                break

            cy = row_start_y + int((row_idx + 0.5) * row_height)
            bubbles = []
            for opt_idx, label in enumerate(MCQ_OPTIONS):
                frac = (opt_idx + 0.5) / len(MCQ_OPTIONS)
                cx = col_x + int((bubble_start + frac * bubble_span) * col_width)
                bubbles.append({
                    "option": label,
                    "cx": int(cx),
                    "cy": int(cy),
                    "r": int(radius),
                })

            questions.append({
                "questionNumber": qnum,
                "bubbles": bubbles,
            })

    _, binary = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    for question in questions:
        for bubble in question["bubbles"]:
            refined_cx, refined_cy = _refine_bubble_center(
                binary,
                int(bubble["cx"]),
                int(bubble["cy"]),
                int(bubble["r"]),
            )
            bubble["cx"] = int(refined_cx)
            bubble["cy"] = int(refined_cy)

    return {
        "referenceWidth": int(w),
        "referenceHeight": int(h),
        "source": source,
        "table": {
            "left": int(left),
            "top": int(top),
            "right": int(right),
            "bottom": int(bottom),
        },
        "questions": questions,
    }


def extract_mcq_answers(warped_gray: np.ndarray, total_questions: int = 52) -> dict:
    """Extract MCQ answers from the answer grid."""
    warnings = []
    layout = _build_mcq_layout(warped_gray, total_questions)

    if layout is None:
        return {"answers": {}, "layout": None, "warnings": ["MCQ ROI too small"]}

    _, binary = cv2.threshold(warped_gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    if layout["source"] == "static_roi":
        warnings.append("Using static MCQ ROI fallback")

    answers = {}
    for question in layout["questions"]:
        qnum = question["questionNumber"]
        scores = []

        for bubble in question["bubbles"]:
            fill = _score_cell(binary, bubble["cx"], bubble["cy"], bubble["r"])
            scores.append((bubble["option"], fill))

        scores.sort(key=lambda s: s[1], reverse=True)
        best_label, best_fill = scores[0]
        _, second_fill = scores[1] if len(scores) > 1 else ("", 0.0)
        gap = best_fill - second_fill

        if best_fill >= MIN_MARK_THRESHOLD and gap >= TIE_GAP:
            answers[str(qnum)] = best_label
            for bubble in question["bubbles"]:
                if bubble["option"] == best_label:
                    refined_cx, refined_cy = _refine_filled_bubble_center(
                        binary,
                        int(bubble["cx"]),
                        int(bubble["cy"]),
                        int(bubble["r"]),
                    )
                    bubble["cx"] = refined_cx
                    bubble["cy"] = refined_cy
                    break
        elif best_fill >= MIN_MARK_THRESHOLD:
            warnings.append(f"Q{qnum}: ambiguous")

    return {"answers": answers, "layout": layout, "warnings": warnings}


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
            "mcqLayout": { "referenceWidth": 800, "referenceHeight": 1131, "questions": [...] },
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
        "mcqLayout": mcq.get("layout"),
        "identityLayout": identity.get("identityLayout"),
        "confidence": identity["confidence"],
        "warnings": list(set(all_warnings)),
    }
