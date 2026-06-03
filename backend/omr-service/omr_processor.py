"""
OMR Processor — Student identity (MSSV) + MCQ answer reading via OpenCV.

Designed for the anchor-based answer sheet produced by docx.service:
  * 4 solid black square anchors at the page corners (perspective reference).
  * Alternating timing marks down the left/right margins of the MSSV and MCQ
    answer regions.
  * Faded letters inside each bubble (vanish under threshold) and no grid
    border lines, so filled bubbles stand out cleanly.

Pipeline
--------
1. Detect the paper (largest bright quad) and warp it flat (pass 1).
2. Re-detect the 4 corner anchors in the flat image and snap them to fixed
   canonical positions (pass 2) so every scan lands in the same coordinate
   frame: A4 at 5 px/mm  ->  1050 x 1485 px, anchor centres at the corners.
3. Read the MSSV grid (6 columns x 10 digit rows) and the MCQ grid
   (4 question columns x 10 rows x A/B/C/D) at fixed canonical positions,
   with a small per-bubble search to absorb residual warp error.

MSSV note: the identifier uses the first 2 + last 4 digits of the student
code (the 3rd/4th digits are dropped on the sheet), so there are 6 columns.
"""

import cv2
import numpy as np
import os
import itertools

# ---------------------------------------------------------------------------
# Canonical geometry (A4 at 5 px/mm)
# ---------------------------------------------------------------------------

SCALE = 5
PAGE_W_MM, PAGE_H_MM = 210, 297
CW, CH = PAGE_W_MM * SCALE, PAGE_H_MM * SCALE          # 1050 x 1485
PAGE_CORNERS = np.array([(0, 0), (CW - 1, 0), (CW - 1, CH - 1), (0, CH - 1)],
                        dtype=np.float32)
# Anchor centres (mm, from the template) -> canonical px. Order: TL,TR,BR,BL.
ANCHOR_MM = [(10, 10), (200, 10), (200, 287), (10, 287)]
ANCHOR_PX = np.array([(x * SCALE, y * SCALE) for x, y in ANCHOR_MM], dtype=np.float32)

# MCQ grid: 4 question columns (1-10, 11-20, 21-30, 31-40), each with A/B/C/D.
# Geometry calibrated from the warped sheet by detecting the printed bubble
# circles (Hough) across the reference scans; centres land within ~2 px.
MCQ_GROUP_X = [123, 361, 596, 832]        # x of option A in each column
MCQ_OPTION_DX = [0, 51, 101, 152]         # A,B,C,D offsets
MCQ_ROW_Y0, MCQ_ROW_DY = 711, 62.95       # first row y, row pitch
MCQ_ROWS_PER_COLUMN = 10
MCQ_OPTIONS = ["A", "B", "C", "D"]

# MSSV grid: 6 digit columns x 10 rows (digits 0-9 top to bottom).
MSSV_COL_X0, MSSV_COL_DX = 634.0, 68.1
MSSV_ROW_Y0, MSSV_ROW_DY = 247.0, 42.1
MSSV_COLUMNS = 6
MSSV_DIGIT_ROWS = 10

BUBBLE_R = 13                  # nominal printed bubble radius (px)
SEARCH_WIN = 10                # +/- px local search to absorb residual warp

# MCQ marks are read by darkness relative to paper, with the per-question
# baseline (median of the 4 options) removed so only the student's added ink
# remains. This is robust to shadow/curvature near the page edge that would
# otherwise make empty bubbles look filled under a global threshold.
MCQ_DARK_R = 9                 # disk radius used when measuring MCQ bubble darkness
MCQ_MARK_MIN = 0.12            # min excess darkness for an option to count as marked
MCQ_MULTI_MIN = 0.07           # a 2nd option this dark => multiple marks (invalid)
# MSSV bubbles are smaller and the marks are frequently faint pencil, so an
# absolute fill level is unreliable. A digit is recognised by how much DARKER
# its bubble is than the per-row baseline (the printed digit glyph, estimated as
# the median darkness of that row across the 6 columns since most columns are
# unmarked on any given row). This cancels the glyph ink and isolates the mark.
MSSV_MIN_EXCESS = 0.025        # min darkness added above the printed-glyph baseline
MSSV_MIN_GAP = 0.012           # winner digit must beat runner-up digit by this much
MSSV_DARK_R = 7                # disk radius used when measuring MSSV bubble darkness

DEBUG = os.environ.get("OMR_DEBUG", "0") == "1"


# ---------------------------------------------------------------------------
# Page detection + perspective warp
# ---------------------------------------------------------------------------

def _order_quad_by_position(pts):
    """Order 4 points as TL, TR, BR, BL (robust up to ~40 deg rotation)."""
    pts = sorted(np.array(pts, dtype=np.float32).tolist(), key=lambda p: p[1])
    top = sorted(pts[:2], key=lambda p: p[0])
    bot = sorted(pts[2:], key=lambda p: p[0])
    return np.array([top[0], top[1], bot[1], bot[0]], dtype=np.float32)


def _anchor_candidates(gray):
    """Solid dark squares whose surroundings are bright (i.e. on white paper).

    Adaptive thresholding makes anchors stand out against their local white
    background even when a large dark laptop dominates the global histogram.
    Returns [(cx, cy, area), ...] (anchors + some filled bubbles / strays).
    """
    H, W = gray.shape
    img_area = H * W
    blur = cv2.GaussianBlur(gray, (3, 3), 0)
    th = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_MEAN_C,
                               cv2.THRESH_BINARY_INV, 61, 12)
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    n, _, stats, cent = cv2.connectedComponentsWithStats(th, 8)
    bright = float(np.percentile(gray, 90))
    cands = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < img_area * 3e-5 or area > img_area * 4e-3:
            continue
        if not (0.5 <= w / max(1, h) <= 2.0):
            continue
        if area / (w * h) < 0.78:
            continue
        cx, cy = cent[i]
        rad = int(max(w, h) * 1.15) + 5
        nb = tot = 0
        for ang in range(0, 360, 30):
            sx = int(cx + rad * np.cos(np.radians(ang)))
            sy = int(cy + rad * np.sin(np.radians(ang)))
            if 0 <= sx < W and 0 <= sy < H:
                tot += 1
                nb += gray[sy, sx] > bright * 0.6
        if tot and nb / tot >= 0.6:
            cands.append((float(cx), float(cy), float(area)))
    return cands


def _best_anchor_quad(cands):
    """Pick 4 candidates forming the best page-aspect (190:277) quadrilateral."""
    if len(cands) < 4:
        return None
    pts = sorted(cands, key=lambda c: -c[2])[:18]
    pts = [(c[0], c[1]) for c in pts]
    best, best_score = None, -1.0
    for combo in itertools.combinations(pts, 4):
        quad = _order_quad_by_position(list(combo))
        TL, TR, BR, BL = quad
        top = np.linalg.norm(TR - TL); bot = np.linalg.norm(BR - BL)
        left = np.linalg.norm(BL - TL); right = np.linalg.norm(BR - TR)
        if min(top, bot, left, right) < 50:
            continue
        if abs(top - bot) / max(top, bot) > 0.25 or abs(left - right) / max(left, right) > 0.25:
            continue
        w = (top + bot) / 2; h = (left + right) / 2
        if h < 1:
            continue
        aspect = w / h
        if not (0.55 <= aspect <= 0.82):
            continue
        area = cv2.contourArea(quad)
        score = area * (0.5 + 0.5 * (1 - abs(aspect - 0.686) / 0.686))
        if score > best_score:
            best_score, best = score, quad
    return best


def _detect_anchors(gray):
    """Detect the 4 corner anchors -> ordered [TL,TR,BR,BL] or None."""
    return _best_anchor_quad(_anchor_candidates(gray))


def _find_page_quad(gray):
    """Largest bright region = the paper. Returns ordered corner quad or None."""
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (25, 25)))
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.15 * gray.shape[0] * gray.shape[1]:
        return None
    peri = cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, 0.02 * peri, True)
    if len(approx) == 4:
        quad = approx.reshape(4, 2).astype(np.float32)
    else:
        quad = cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float32)
    return _order_quad_by_position(quad)


def _refine_anchor(warped, tx, ty, win=55):
    """Find the precise anchor centroid near canonical corner (tx,ty)."""
    y0, y1 = max(0, ty - win), min(warped.shape[0], ty + win)
    x0, x1 = max(0, tx - win), min(warped.shape[1], tx + win)
    roi = warped[y0:y1, x0:x1]
    if roi.size == 0:
        return None
    _, th = cv2.threshold(roi, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE,
                          cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))
    n, _, stats, cent = cv2.connectedComponentsWithStats(th, 8)
    best, bd = None, 1e18
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < 120 or area > 1800:
            continue
        if not (0.45 <= w / max(1, h) <= 2.2):
            continue
        if area / (w * h) < 0.55:
            continue
        cx, cy = x0 + cent[i][0], y0 + cent[i][1]
        d = (cx - tx) ** 2 + (cy - ty) ** 2
        if d < bd:
            bd, best = d, (cx, cy)
    return best


def _find_corner_anchors(warped, win=55):
    """Return list of (found_point, target) for anchors near canonical corners."""
    found, tgt = [], []
    for (tx, ty) in ANCHOR_PX.astype(int):
        a = _refine_anchor(warped, int(tx), int(ty), win)
        if a is not None:
            found.append(a)
            tgt.append((float(tx), float(ty)))
    return found, tgt


def _refine_warp(warped, win=55):
    """Pass 2: snap detected anchors to their exact canonical positions."""
    found, tgt = _find_corner_anchors(warped, win)
    if len(found) == 4:
        M = cv2.getPerspectiveTransform(np.array(found, np.float32),
                                        np.array(tgt, np.float32))
        return cv2.warpPerspective(warped, M, (CW, CH)), len(found)
    if len(found) == 3:
        M, _ = cv2.estimateAffine2D(np.array(found, np.float32),
                                    np.array(tgt, np.float32))
        if M is not None:
            return cv2.warpAffine(warped, M, (CW, CH)), len(found)
    return warped, len(found)


def _alignment_score(warped):
    """How many of the 4 anchors sit within ~6px of their canonical corner."""
    found, tgt = _find_corner_anchors(warped, win=30)
    ok = 0
    for (fx, fy), (tx, ty) in zip(found, tgt):
        if abs(fx - tx) <= 8 and abs(fy - ty) <= 8:
            ok += 1
    return ok


def preprocess_image(image_path):
    """Load and warp an exam scan into the canonical coordinate frame.

    Returns (warped_gray, warnings, aligned_corners) where aligned_corners is
    how many of the 4 anchors landed on their canonical position (0-4). A low
    count means the scan could not be reliably flattened.
    """
    warnings = []
    image = cv2.imread(image_path)
    if image is None:
        return None, ["Cannot read image file"], 0
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Pass 1: prefer direct anchor detection (maps anchor centres exactly);
    # fall back to the page quad (maps paper corners) when anchors are unclear.
    anchors = _detect_anchors(gray)
    if anchors is not None:
        M = cv2.getPerspectiveTransform(anchors, ANCHOR_PX)
        warped = cv2.warpPerspective(gray, M, (CW, CH))
    else:
        warnings.append("Corner anchors not found; aligning by paper outline")
        quad = _find_page_quad(gray)
        if quad is None:
            warnings.append("Page not detected; using direct resize fallback")
            return cv2.resize(gray, (CW, CH), interpolation=cv2.INTER_AREA), warnings, 0
        M = cv2.getPerspectiveTransform(quad, PAGE_CORNERS)
        warped = cv2.warpPerspective(gray, M, (CW, CH))

    # Pass 2: snap anchors to exact canonical corners (iterate; widen window
    # once if the first pass barely moved the anchors into reach).
    warped, _ = _refine_warp(warped, win=75)
    warped, _ = _refine_warp(warped, win=40)

    aligned = _alignment_score(warped)
    if aligned < 4:
        warnings.append(
            f"Sheet alignment uncertain ({aligned}/4 corner anchors locked); "
            "results on this scan may be unreliable")
    return warped, warnings, aligned


# ---------------------------------------------------------------------------
# Bubble scoring
# ---------------------------------------------------------------------------

def _disk_darkness(gray, cx, cy, r, paper):
    """Mean darkness of a disk relative to paper white, in [0,1] (0=white)."""
    h, w = gray.shape
    if cx - r < 0 or cy - r < 0 or cx + r >= w or cy + r >= h:
        return 0.0
    patch = gray[cy - r:cy + r + 1, cx - r:cx + r + 1].astype(np.float32)
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    disk = (xx * xx + yy * yy) <= r * r
    return float(np.clip((paper - patch[disk]) / max(paper, 1.0), 0.0, 1.0).mean())


def _darkest_bubble(gray, cx, cy, paper, win=SEARCH_WIN, r=MSSV_DARK_R):
    """Best (darkest) darkness within a small search window; returns (score,cx,cy)."""
    best, bx, by = 0.0, cx, cy
    for dy in range(-win, win + 1, 2):
        for dx in range(-win, win + 1, 2):
            d = _disk_darkness(gray, cx + dx, cy + dy, r, paper)
            if d > best:
                best, bx, by = d, cx + dx, cy + dy
    return best, bx, by


# ---------------------------------------------------------------------------
# Timing-mark row localisation (absorbs tilt and local paper curvature)
# ---------------------------------------------------------------------------

def _detect_mark_ys(warped, xl, xh, ylo, yhi):
    """Y-centroids of the tall-thin solid timing marks in a margin strip."""
    strip = warped[ylo:yhi, xl:xh]
    if strip.size == 0:
        return []
    _, th = cv2.threshold(strip, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    n, _, stats, cent = cv2.connectedComponentsWithStats(th, 8)
    ys = []
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if not (9 <= h <= 42 and 3 <= w <= 20):
            continue
        if area < 25 or area / (w * h) < 0.5 or h <= w:
            continue
        ys.append(ylo + cent[i][1])
    return sorted(ys)


def _fit_n_rows(ys, n, y0, dy):
    """Fit n evenly spaced row centres from detected mark y's (handles gaps)."""
    if len(ys) < 3:
        return None
    by_idx = {}
    for y in ys:
        idx = int(round((y - y0) / dy))
        if 0 <= idx < n:
            by_idx.setdefault(idx, []).append(y)
    if len(by_idx) < 3:
        return None
    idxs = sorted(by_idx)
    meds = [float(np.median(by_idx[i])) for i in idxs]
    A = np.vstack([idxs, np.ones(len(idxs))]).T
    (b, a), *_ = np.linalg.lstsq(A, np.array(meds), rcond=None)
    if not (0.6 * dy <= b <= 1.6 * dy):     # sane spacing only
        return None
    return [a + b * i for i in range(n)]


def _region_rows(warped, x_left, x_right, ylo, yhi, n, y0, dy):
    """Per-side row centres from left/right timing marks; canonical fallback."""
    pad = 16
    lrows = _fit_n_rows(_detect_mark_ys(warped, x_left - pad, x_left + pad, ylo, yhi), n, y0, dy)
    rrows = _fit_n_rows(_detect_mark_ys(warped, x_right - pad, x_right + pad, ylo, yhi), n, y0, dy)
    canonical = [y0 + dy * i for i in range(n)]
    if lrows is None and rrows is None:
        return canonical, canonical
    if lrows is None:
        lrows = rrows
    if rrows is None:
        rrows = lrows
    return lrows, rrows


def _row_y(lrows, rrows, x_left, x_right, r, x):
    """Interpolate the row-r centre y at horizontal position x."""
    t = (x - x_left) / float(x_right - x_left)
    t = min(1.0, max(0.0, t))
    return int(round(lrows[r] + (rrows[r] - lrows[r]) * t))


# ---------------------------------------------------------------------------
# MCQ recognition
# ---------------------------------------------------------------------------

MCQ_MARK_XL, MCQ_MARK_XR = 58, 1006
MSSV_MARK_XL, MSSV_MARK_XR = 594, 1008


def extract_mcq_answers(warped, total_questions):
    """Read MCQ answers. 'x' marks a blank or multi-marked (invalid) question.

    Each option's darkness (relative to paper) is measured, then the per-question
    baseline (median of the 4 options) is removed so only the student's added ink
    remains. An option is the answer when its excess clearly exceeds the mark
    threshold and no second option is also marked; otherwise the question is 'x'.
    """
    paper = float(np.percentile(warped, 85))
    answers = {}
    questions = []
    warnings = []

    lrows, rrows = _region_rows(warped, MCQ_MARK_XL, MCQ_MARK_XR,
                                660, 1320, MCQ_ROWS_PER_COLUMN, MCQ_ROW_Y0, MCQ_ROW_DY)

    for q in range(1, total_questions + 1):
        col = (q - 1) // MCQ_ROWS_PER_COLUMN
        row = (q - 1) % MCQ_ROWS_PER_COLUMN
        if col >= len(MCQ_GROUP_X):
            break
        bubbles = []
        darks = []
        for oi, opt in enumerate(MCQ_OPTIONS):
            cx0 = int(round(MCQ_GROUP_X[col] + MCQ_OPTION_DX[oi]))
            cy0 = _row_y(lrows, rrows, MCQ_MARK_XL, MCQ_MARK_XR, row, cx0)
            s, bx, by = _darkest_bubble(warped, cx0, cy0, paper, r=MCQ_DARK_R)
            darks.append(s)
            bubbles.append({"option": opt, "cx": int(bx), "cy": int(by),
                            "r": int(BUBBLE_R)})
        base = float(np.median(darks))
        excess = [d - base for d in darks]
        for bi, b in enumerate(bubbles):
            b["score"] = round(excess[bi], 3)
            b["marked"] = bool(excess[bi] >= MCQ_MARK_MIN)
        order = sorted(range(4), key=lambda i: -excess[i])
        best, second = excess[order[0]], excess[order[1]]
        if best < MCQ_MARK_MIN:
            answers[str(q)] = "x"
            status = "blank"
            warnings.append(f"Q{q}: invalid (blank)")
        elif second >= MCQ_MULTI_MIN:
            answers[str(q)] = "x"
            status = "multi"
            warnings.append(f"Q{q}: invalid (multiple marks)")
        else:
            answers[str(q)] = MCQ_OPTIONS[order[0]]
            status = "ok"
        questions.append({"questionNumber": q, "bubbles": bubbles,
                          "selected": answers[str(q)], "status": status})
        if DEBUG:
            print(f"[OMR] Q{q}: excess={[round(e,2) for e in excess]} -> {answers[str(q)]}")

    layout = {"referenceWidth": CW, "referenceHeight": CH,
              "source": "anchor_canonical", "questions": questions}
    return {"answers": answers, "layout": layout, "warnings": warnings}


# ---------------------------------------------------------------------------
# MSSV recognition
# ---------------------------------------------------------------------------

def extract_student_code(warped):
    """Read the 6-digit MSSV (first 2 + last 4 digits of the student code).

    Marks here are often faint pencil and the printed digit glyphs survive
    binarisation unevenly (a printed "8" carries more ink than a faint "1"
    mark). So instead of an absolute fill we measure each bubble's darkness
    relative to paper, then subtract the per-row baseline (median darkness of
    that digit row across the 6 columns ~= the printed glyph), leaving only the
    ink the student added. The marked digit is the row with the most excess.
    """
    paper = float(np.percentile(warped, 85))
    digit_bubbles = []
    warnings = []

    lrows, rrows = _region_rows(warped, MSSV_MARK_XL, MSSV_MARK_XR,
                                185, 660, MSSV_DIGIT_ROWS, MSSV_ROW_Y0, MSSV_ROW_DY)

    # Pass 1: darkness of every bubble + the (cx,cy) where it was darkest.
    dark = np.zeros((MSSV_COLUMNS, MSSV_DIGIT_ROWS), dtype=np.float32)
    pos = [[None] * MSSV_DIGIT_ROWS for _ in range(MSSV_COLUMNS)]
    for c in range(MSSV_COLUMNS):
        cx0 = int(round(MSSV_COL_X0 + MSSV_COL_DX * c))
        for d in range(MSSV_DIGIT_ROWS):
            cy0 = _row_y(lrows, rrows, MSSV_MARK_XL, MSSV_MARK_XR, d, cx0)
            s, bx, by = _darkest_bubble(warped, cx0, cy0, paper)
            dark[c, d] = s
            pos[c][d] = (bx, by)

    # Per-row glyph baseline; excess isolates the student's mark.
    baseline = np.median(dark, axis=0)
    excess = dark - baseline[None, :]

    digits = []
    total_conf = 0.0
    detected = 0
    for c in range(MSSV_COLUMNS):
        ex = excess[c]
        order = sorted(range(MSSV_DIGIT_ROWS), key=lambda i: -ex[i])
        best, second = ex[order[0]], ex[order[1]]
        if best < MSSV_MIN_EXCESS or (best - second) < MSSV_MIN_GAP:
            digits.append("?")
            warnings.append(f"MSSV column {c + 1} not confident")
        else:
            d = order[0]
            digits.append(str(d))
            detected += 1
            total_conf += float(min(1.0, best / 0.25))
            bx, by = pos[c][d]
            digit_bubbles.append({"column": c + 1, "digit": d,
                                  "cx": int(bx), "cy": int(by), "r": int(BUBBLE_R)})
        if DEBUG:
            print(f"[OMR] MSSV col {c+1}: d{order[0]} excess={best:.3f} gap={best-second:.3f}")

    code = "".join(digits) if not all(x == "?" for x in digits) else None
    if code and "?" in code:
        warnings.append(f"Partial MSSV: {code}")
    confidence = total_conf / detected if detected else 0.0
    layout = {"referenceWidth": CW, "referenceHeight": CH,
              "source": "anchor_canonical", "digits": digit_bubbles}
    return {"studentCode": code, "identityLayout": layout,
            "confidence": round(confidence, 3), "warnings": warnings}


# ---------------------------------------------------------------------------
# Result image (green = correct answer, red = student's wrong/invalid mark)
# ---------------------------------------------------------------------------

GREEN = (0, 170, 0)
RED = (0, 0, 255)
BLUE = (200, 120, 0)


def annotate_result(warped, mcq_layout, identity_layout, answer_key=None):
    """Render the graded result onto the aligned sheet.

    For every question a GREEN ring marks the correct answer; for questions the
    student got wrong or left blank/multi-marked, a RED ring also marks each
    bubble the student actually filled. Detected MSSV digits are ringed in blue.
    `answer_key` is a string like "aabbccddaabbbbaaccdd" (one char per question,
    case-insensitive). When it is None only the student's marks are shown.
    """
    vis = cv2.cvtColor(cv2.convertScaleAbs(warped, alpha=1.15, beta=0),
                       cv2.COLOR_GRAY2BGR)

    if identity_layout:
        for d in identity_layout.get("digits", []):
            cv2.circle(vis, (d["cx"], d["cy"]), d["r"] + 4, BLUE, 2)

    if mcq_layout:
        for q in mcq_layout.get("questions", []):
            qn = q["questionNumber"]
            correct = None
            if answer_key and qn <= len(answer_key):
                correct = answer_key[qn - 1].upper()
            sel = (q.get("selected") or "x").upper()
            got_it = correct is not None and sel == correct
            for b in q["bubbles"]:
                pos = (b["cx"], b["cy"])
                r = b["r"]
                if correct and b["option"] == correct:
                    cv2.circle(vis, pos, r + 5, GREEN, 2)
                if not got_it and b.get("marked") and b["option"] != correct:
                    cv2.circle(vis, pos, r + 5, RED, 2)

    cv2.putText(vis, "Green = correct answer   Red = student's (wrong/invalid) mark",
                (40, CH - 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)
    return vis


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def process_omr_image(image_path, total_questions=20, answer_key=None,
                      output_image_path=None):
    """Process an exam scan: extract student code and MCQ answers.

    Returns a dict with studentCode, answers, mcqLayout, identityLayout,
    confidence, aligned and warnings (kept backward compatible with the Node
    client). When `output_image_path` is given, a graded result image is saved
    there (green = correct answer, red = student's wrong/invalid mark) and its
    path is returned under `resultImage`.
    """
    all_warnings = []
    warped, pw, aligned = preprocess_image(image_path)
    all_warnings.extend(pw)
    if warped is None:
        return {"studentCode": None, "answers": {}, "mcqLayout": None,
                "identityLayout": None, "confidence": 0.0,
                "aligned": 0, "resultImage": None, "warnings": all_warnings}

    identity = extract_student_code(warped)
    all_warnings.extend(identity.get("warnings", []))
    mcq = extract_mcq_answers(warped, total_questions)
    all_warnings.extend(mcq.get("warnings", []))

    # Fold alignment quality into the reported confidence so the backend can
    # flag scans that were only partially aligned.
    confidence = identity["confidence"] * (aligned / 4.0)

    result_path = None
    if output_image_path:
        vis = annotate_result(warped, mcq.get("layout"),
                              identity.get("identityLayout"), answer_key)
        cv2.imwrite(output_image_path, vis)
        result_path = output_image_path

    return {
        "studentCode": identity["studentCode"],
        "answers": mcq["answers"],
        "mcqLayout": mcq.get("layout"),
        "identityLayout": identity.get("identityLayout"),
        "confidence": round(confidence, 3),
        "aligned": aligned,
        "resultImage": result_path,
        "warnings": sorted(set(all_warnings)),
    }
