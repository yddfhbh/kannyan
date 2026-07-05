#!/usr/bin/env python3
import json
import sys


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


def main() -> None:
    if len(sys.argv) < 2:
        fail("usage: chess-image-to-fen.py <imagePath> [boardOrientation]")

    image_path = sys.argv[1]
    board_orientation = (sys.argv[2] if len(sys.argv) >= 3 else "w").lower()
    board_orientation = "b" if board_orientation == "b" else "w"

    try:
        from chessimg2pos import predict_fen
    except Exception:
        print(
            "chessimg2pos is not installed. Install requirements-chess.txt first.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    try:
        raw_fen = predict_fen(image_path)
    except Exception as exc:
        fail(str(exc))

    board_fen = normalize_board_fen(raw_fen)

    if board_orientation == "b":
        board_fen = rotate_board_180(board_fen)

    print(json.dumps({
        "fen": board_fen,
        "rawFen": str(raw_fen),
        "boardOrientation": board_orientation,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()