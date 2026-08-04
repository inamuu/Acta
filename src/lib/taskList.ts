export type TaskState = "unchecked" | "checked" | "partial";

const TASK_STATE_ORDER: TaskState[] = ["unchecked", "checked", "partial"];

export function taskStateFromMarker(marker: string): TaskState | null {
  switch (String(marker ?? "").toLowerCase()) {
    case " ":
      return "unchecked";
    case "x":
      return "checked";
    case "-":
    case "/":
    // 旧「レビュー中」マーカー。互換のため作業中として扱う。
    case "r":
      return "partial";
    default:
      return null;
  }
}

export function markerFromTaskState(state: TaskState): string {
  switch (state) {
    case "checked":
      return "x";
    case "partial":
      return "-";
    case "unchecked":
    default:
      return " ";
  }
}

export function nextTaskState(state: TaskState): TaskState {
  const idx = TASK_STATE_ORDER.indexOf(state);
  if (idx < 0) return "unchecked";
  return TASK_STATE_ORDER[(idx + 1) % TASK_STATE_ORDER.length] ?? "unchecked";
}

function taskStateLabel(state: TaskState): string {
  switch (state) {
    case "checked":
      return "完了";
    case "partial":
      return "作業中";
    case "unchecked":
    default:
      return "未着手";
  }
}

function normalizeTaskState(raw: string | undefined): TaskState {
  const s = String(raw ?? "").toLowerCase();
  if (s === "checked") return "checked";
  if (s === "partial") return "partial";
  return "unchecked";
}

export function taskStateFromInput(el: HTMLInputElement): TaskState {
  const raw = String(el.dataset.taskState ?? "").toLowerCase();
  if (raw === "checked") return "checked";
  if (raw === "partial") return "partial";
  if (raw === "unchecked") return "unchecked";
  return el.checked ? "checked" : "unchecked";
}

export function hydrateTaskCheckboxStates(root: ParentNode): void {
  const boxes = root.querySelectorAll<HTMLInputElement>("input.taskListCheckbox");
  for (const box of boxes) {
    const taskState = normalizeTaskState(box.dataset.taskState);
    box.indeterminate = taskState === "partial";
    box.checked = taskState === "checked";
    box.title = taskStateLabel(taskState);
    box.setAttribute("aria-label", `task:${taskStateLabel(taskState)}`);
  }
}

export function setTaskStateOnLine(markdown: string, line0: number, state: TaskState): string | null {
  if (!Number.isFinite(line0) || line0 < 0) return null;

  const hasCrlf = markdown.includes("\r\n");
  const lines = markdown.split(/\r?\n/);
  if (line0 >= lines.length) return null;

  const marker = markerFromTaskState(state);
  const line = lines[line0] ?? "";
  // Typical: "- [ ] task" (with optional blockquote prefix).
  // Accept "-[ ] task" as well.
  let replaced = line.replace(
    /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s*)\[([ xX\-\/rR])\](\s+)/,
    `$1[${marker}]$3`
  );

  // Some list items put the checkbox on the next line:
  // "-\n  [ ] task"
  if (replaced === line) {
    replaced = line.replace(/^(\s*(?:>\s*)*)\[([ xX\-\/rR])\](\s+)/, `$1[${marker}]$3`);
  }

  if (replaced === line && line0 + 1 < lines.length) {
    const nextLine = lines[line0 + 1] ?? "";
    const nextReplaced = nextLine.replace(
      /^(\s*(?:>\s*)*)\[([ xX\-\/rR])\](\s+)/,
      `$1[${marker}]$3`
    );
    if (nextReplaced !== nextLine) {
      lines[line0 + 1] = nextReplaced;
      return lines.join(hasCrlf ? "\r\n" : "\n");
    }
  }

  if (replaced === line) return null;

  lines[line0] = replaced;
  return lines.join(hasCrlf ? "\r\n" : "\n");
}

export type TaskSummary = {
  total: number;
  done: number;
  doing: number;
  todo: number;
};

const TASK_LINE_RE = /^\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s*\[([ xX\-\/rR])\]\s+/;

/** ToDo本文のチェックボックス行を数えて進捗を出す。 */
export function summarizeTaskStates(markdown: string): TaskSummary {
  const summary: TaskSummary = { total: 0, done: 0, doing: 0, todo: 0 };

  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const m = TASK_LINE_RE.exec(line);
    if (!m) continue;
    const state = taskStateFromMarker(m[1] ?? "");
    if (!state) continue;
    summary.total += 1;
    if (state === "checked") summary.done += 1;
    else if (state === "partial") summary.doing += 1;
    else summary.todo += 1;
  }

  return summary;
}

export function setTaskCheckedOnLine(markdown: string, line0: number, checked: boolean): string | null {
  return setTaskStateOnLine(markdown, line0, checked ? "checked" : "unchecked");
}
