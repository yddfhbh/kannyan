#!/usr/bin/env python3
import json
import os
import sys
import tempfile
from pathlib import Path

from PIL import Image


def fail(message: str, code: int = 1) -> None:
    print(f"chess image recognition failed: {message}", file=sys.stderr)
    raise SystemExit(code)


def compress_row(row: str) -> str:
    output = []
    empty = 0

    for ch in row:
        if ch in {"1", "."}:
            empty += 1
        else:
            if empty:
                output.append(str(empty))
                empty = 0
            output.append(ch)

    if empty:
        output.append(str(empty))

    return "".join(output)


def expand_row(row: str) -> str:
    output = []

    for ch in row:
        if ch.isdigit():
            output.append("1" * int(ch))
        else:
            output.append(ch)

    expanded = "".join(output)

    if len(expanded) != 8:
        fail(f"invalid FEN row width: {row}")

    return expanded


def normalize_board_fen(raw: str) -> str:
    board = str(raw or "").strip().split()[0]

    if not board:
        fail("empty FEN returned")

    rows = board.split("/")

    if len(rows) != 8:
        fail(f"invalid FEN row count: {board}")

    normalized_rows = []

    for row in rows:
        expanded = expand_row(row)
        normalized_rows.append(compress_row(expanded))

    return "/".join(normalized_rows)


def rotate_board_180(board_fen: str) -> str:
    rows = [expand_row(row) for row in board_fen.split("/")]
    rotated_rows = []

    for row in reversed(rows):
        rotated_rows.append(compress_row("".join(reversed(row))))

    return "/".join(rotated_rows)


def load_rgb_image(image_path: str):
    try:
        import numpy as np
    except Exception as exc:
        fail(f"numpy import failed: {exc}", 2)

    try:
        image = Image.open(image_path).convert("RGB")
    except Exception as exc:
        fail(f"failed to open image: {exc}")

    return np.array(image)


def make_checker_template(size: int):
    import numpy as np

    template = np.zeros((size, size), dtype=np.float32)
    cell = size / 8

    for row in range(8):
        for col in range(8):
            value = 1.0 if (row + col) % 2 == 0 else -1.0
            y0 = int(round(row * cell))
            y1 = int(round((row + 1) * cell))
            x0 = int(round(col * cell))
            x1 = int(round((col + 1) * cell))
            template[y0:y1, x0:x1] = value

    return template


def find_board_bbox(rgb):
    """
    전체 스샷에서 8x8 체크무늬 패턴을 찾아 체스판 bbox를 반환한다.
    return: (x, y, size, score)
    """
    try:
        import cv2
        import numpy as np
    except Exception as exc:
        height, width = rgb.shape[:2]
        if abs(width - height) <= max(width, height) * 0.04:
            size = min(width, height)
            return 0, 0, size, 1.0
        fail(f"opencv-python-headless is required for board auto-crop: {exc}", 2)

    height, width = rgb.shape[:2]

    # 이미 거의 정사각형이면 체스판만 들어온 이미지로 보고 그대로 사용
    if min(width, height) >= 160 and abs(width - height) <= max(width, height) * 0.04:
        size = min(width, height)
        return 0, 0, size, 1.0

    max_dim = max(width, height)
    scale = 1000 / max_dim if max_dim > 1000 else 1.0

    if scale != 1.0:
        small = cv2.resize(
            rgb,
            (int(round(width * scale)), int(round(height * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        small = rgb

    gray = cv2.cvtColor(small, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    small_h, small_w = gray.shape[:2]
    min_side = min(small_w, small_h)

    min_size = max(96, int(min_side * 0.15))
    max_size = int(min_side * 0.98)
    step = max(6, min_side // 80)

    best_score = -1.0
    best_size = None
    best_loc = None

    for size in range(min_size, max_size + 1, step):
        if size >= small_w or size >= small_h:
            continue

        template = make_checker_template(size)
        result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)

        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

        # 밝은 칸/어두운 칸이 반대로 잡혀도 허용
        if abs(min_val) > max_val:
            score = abs(min_val)
            loc = min_loc
        else:
            score = max_val
            loc = max_loc

        if score > best_score:
            best_score = float(score)
            best_size = size
            best_loc = loc

    if best_size is None or best_loc is None:
        fail("could not locate chessboard in image")

    # 주변 사이즈를 조금 더 촘촘하게 재탐색
    refine_from = max(min_size, best_size - step * 2)
    refine_to = min(max_size, best_size + step * 2)

    for size in range(refine_from, refine_to + 1, 2):
        if size >= small_w or size >= small_h:
            continue

        template = make_checker_template(size)
        result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)

        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)

        if abs(min_val) > max_val:
            score = abs(min_val)
            loc = min_loc
        else:
            score = max_val
            loc = max_loc

        if score > best_score:
            best_score = float(score)
            best_size = size
            best_loc = loc

    if best_score < 0.22:
        fail(f"could not locate chessboard confidently. score={best_score:.3f}")

    inv_scale = 1.0 / scale
    x = int(round(best_loc[0] * inv_scale))
    y = int(round(best_loc[1] * inv_scale))
    size = int(round(best_size * inv_scale))

    x = max(0, min(x, width - 1))
    y = max(0, min(y, height - 1))
    size = max(1, min(size, width - x, height - y))

    return x, y, size, best_score


def label_ink_score(patch) -> float:
    """
    좌상단 작은 좌표 숫자 패치에서 글자 잉크량을 대충 계산.
    8은 1보다 보통 넓고 잉크량이 많아서 orientation 판별에 쓴다.
    """
    try:
        import numpy as np
    except Exception:
        return 0.0

    if patch.size == 0:
        return 0.0

    arr = patch.astype(np.float32)
    flat = arr.reshape(-1, 3)

    median = np.median(flat, axis=0)
    dist = np.linalg.norm(arr - median, axis=2)

    threshold = max(16.0, float(np.percentile(dist, 78)))
    mask = dist > threshold

    ys, xs = np.where(mask)

    if len(xs) < 3:
        return 0.0

    box_w = int(xs.max() - xs.min() + 1)
    box_h = int(ys.max() - ys.min() + 1)
    ink = int(mask.sum())
    area = box_w * box_h

    return float(ink + area * 0.12 + box_w * 1.5)


def detect_board_orientation_from_coords(board_rgb, fallback: str) -> tuple[str, str]:
    """
    보드 안쪽 좌측 랭크 숫자로 방향 판별.
    백 시점: 좌상단이 8, 좌하단 첫 칸 위쪽이 1
    흑 시점: 좌상단이 1, 좌하단 첫 칸 위쪽이 8
    """
    height, width = board_rgb.shape[:2]
    size = min(width, height)
    cell = size / 8

    patch_w = max(10, int(cell * 0.18))
    patch_h = max(12, int(cell * 0.24))

    # 좌상단: 백 시점이면 8, 흑 시점이면 1
    top_patch = board_rgb[0:patch_h, 0:patch_w]

    # 좌하단 칸의 "위쪽" 좌표 숫자 위치
    bottom_y = int(round(7 * cell))
    bottom_patch = board_rgb[bottom_y:bottom_y + patch_h, 0:patch_w]

    top_score = label_ink_score(top_patch)
    bottom_score = label_ink_score(bottom_patch)

    # 8이 1보다 잉크량/폭이 크다는 점을 이용
    if top_score > 24 and top_score >= bottom_score * 1.25:
        return "w", "rank-labels"

    if bottom_score > 24 and bottom_score >= top_score * 1.25:
        return "b", "rank-labels"

    return fallback, "fallback"


def save_board_crop(image_path: str, fallback_orientation: str):
    rgb = load_rgb_image(image_path)

    x, y, size, score = find_board_bbox(rgb)
    board_rgb = rgb[y:y + size, x:x + size]

    board_orientation, orientation_source = detect_board_orientation_from_coords(
        board_rgb,
        fallback_orientation,
    )

    fd, crop_path = tempfile.mkstemp(prefix="chess-board-", suffix=".png")
    os.close(fd)

    Image.fromarray(board_rgb).save(crop_path)

    return crop_path, {
        "x": x,
        "y": y,
        "size": size,
        "score": round(float(score), 4),
    }, board_orientation, orientation_source


def main() -> None:
    if len(sys.argv) < 2:
        fail("usage: chess-image-to-fen.py <imagePath> [boardOrientation]")

    image_path = sys.argv[1]

    requested_orientation = (sys.argv[2] if len(sys.argv) >= 3 else "w").lower()
    requested_orientation = "b" if requested_orientation == "b" else "w"

    try:
        from chessimg2pos import predict_fen
    except Exception as exc:
        fail(f"chessimg2pos import failed: {exc}", 2)

    crop_path = None

    try:
        crop_path, board_bbox, board_orientation, orientation_source = save_board_crop(
            image_path,
            requested_orientation,
        )

        raw_fen = predict_fen(crop_path)
    except Exception as exc:
        fail(str(exc))
    finally:
        if crop_path:
            try:
                os.remove(crop_path)
            except OSError:
                pass

    board_fen = normalize_board_fen(raw_fen)

    if board_orientation == "b":
        board_fen = rotate_board_180(board_fen)

    print(json.dumps({
        "fen": board_fen,
        "rawFen": str(raw_fen),
        "boardOrientation": board_orientation,
        "orientationSource": orientation_source,
        "requestedOrientation": requested_orientation,
        "boardBBox": board_bbox,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()