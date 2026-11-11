/**
 * The puzzle specifies a number of half-moves (6 normal / 10 expert).
 * Guard every input path, not only the submit button.
 */
export function canEnterChessleMove(puzzle, moveCount, busy = false) {
  return Number.isInteger(puzzle?.length)
    && puzzle.length > 0
    && !puzzle.finished
    && !busy
    && Number.isInteger(moveCount)
    && moveCount >= 0
    && moveCount < puzzle.length;
}
