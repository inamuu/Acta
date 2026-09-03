/**
 * Markdown エディタ（textarea）の入力補助。
 * DOM に依存しない純粋関数として実装し、テキストと選択範囲だけを受け取って結果を返す。
 */

export type EditResult = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

const INDENT_UNIT = "  ";

// 例: "  - [ ] task" / "1. task" / "* task" / "> - task"
const LIST_LINE_RE = /^(\s*(?:>\s*)*)([-+*]|\d+[.)])(\s+)(\[[ xX\-\/rR]\]\s+)?(.*)$/;

function lineStartAt(value: string, pos: number): number {
  return value.lastIndexOf("\n", pos - 1) + 1;
}

function lineEndAt(value: string, pos: number): number {
  const idx = value.indexOf("\n", pos);
  return idx < 0 ? value.length : idx;
}

function bumpOrderedMarker(marker: string): string {
  const m = /^(\d+)([.)])$/.exec(marker);
  if (!m) return marker;
  return `${Number(m[1]) + 1}${m[2]}`;
}

/**
 * Enter 押下時にリスト記号を次行へ引き継ぐ。
 * - 空のリスト行なら記号を消して通常行にする（リスト終了）
 * - 番号付きリストは番号を進める
 * - チェックボックスは未チェックで引き継ぐ
 * リスト行でなければ null を返し、呼び出し側は既定の改行に任せる。
 */
export function continueListOnEnter(value: string, selectionStart: number, selectionEnd: number): EditResult | null {
  if (selectionStart !== selectionEnd) return null;

  const start = lineStartAt(value, selectionStart);
  const end = lineEndAt(value, selectionStart);
  const line = value.slice(start, end);
  const m = LIST_LINE_RE.exec(line);
  if (!m) return null;

  const [, indent, marker, gap, checkbox = "", rest] = m;
  const caretInLine = selectionStart - start;
  const prefixLength = indent.length + marker.length + gap.length + checkbox.length;
  // 記号より前にカーソルがある場合は補助しない。
  if (caretInLine < prefixLength) return null;

  if (rest.trim().length === 0) {
    // 空のリスト行で Enter: 記号を削除して行を空にする。
    const next = value.slice(0, start) + indent + value.slice(end);
    const caret = start + indent.length;
    return { value: next, selectionStart: caret, selectionEnd: caret };
  }

  const nextMarker = bumpOrderedMarker(marker);
  const nextCheckbox = checkbox ? "[ ] " : "";
  const insertion = `\n${indent}${nextMarker} ${nextCheckbox}`;
  const next = value.slice(0, selectionStart) + insertion + value.slice(selectionStart);
  const caret = selectionStart + insertion.length;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}

/**
 * 選択範囲に含まれる行をインデント/アウトデントする。
 * 1行だけの場合でも行全体を対象にするので、リスト項目の階層調整に使える。
 */
export function indentLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: "in" | "out"
): EditResult {
  const blockStart = lineStartAt(value, selectionStart);
  // 選択終端が行頭にあるとき、その行は対象に含めない（複数行選択の慣例）。
  const effectiveEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
  const blockEnd = lineEndAt(value, effectiveEnd);
  const block = value.slice(blockStart, blockEnd);
  const lines = block.split("\n");

  let firstLineDelta = 0;
  let totalDelta = 0;
  const nextLines = lines.map((line, index) => {
    let nextLine: string;
    if (direction === "in") {
      nextLine = INDENT_UNIT + line;
    } else if (line.startsWith("\t")) {
      nextLine = line.slice(1);
    } else {
      const spaces = /^ {1,2}/.exec(line)?.[0].length ?? 0;
      nextLine = line.slice(spaces);
    }
    const delta = nextLine.length - line.length;
    if (index === 0) firstLineDelta = delta;
    totalDelta += delta;
    return nextLine;
  });

  const nextValue = value.slice(0, blockStart) + nextLines.join("\n") + value.slice(blockEnd);
  const nextStart = Math.max(blockStart, selectionStart + firstLineDelta);
  const nextEnd =
    selectionEnd === selectionStart ? nextStart : Math.max(nextStart, selectionEnd + totalDelta);
  return { value: nextValue, selectionStart: nextStart, selectionEnd: nextEnd };
}

/** Tab を押した位置がリスト行か、複数行選択かを判定する。それ以外はタブ文字挿入に任せる。 */
export function shouldIndentOnTab(value: string, selectionStart: number, selectionEnd: number): boolean {
  if (selectionStart !== selectionEnd) return true;
  const start = lineStartAt(value, selectionStart);
  const end = lineEndAt(value, selectionStart);
  return LIST_LINE_RE.test(value.slice(start, end));
}
