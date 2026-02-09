export function setTaskCheckedOnLine(markdown: string, line0: number, checked: boolean): string | null {
  if (!Number.isFinite(line0) || line0 < 0) return null;

  const hasCrlf = markdown.includes("\r\n");
  const lines = markdown.split(/\r?\n/);
  if (line0 >= lines.length) return null;

  const line = lines[line0] ?? "";
  // Typical: "- [ ] task" (with optional blockquote prefix).
  let replaced = line.replace(
    /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)])\s+)\[([ xX])\](\s+)/,
    `$1[${checked ? "x" : " "}]$3`
  );

  // Some list items put the checkbox on the next line:
  // "-\n  [ ] task"
  if (replaced === line) {
    replaced = line.replace(/^(\s*(?:>\s*)*)\[([ xX])\](\s+)/, `$1[${checked ? "x" : " "}]$3`);
  }

  if (replaced === line && line0 + 1 < lines.length) {
    const nextLine = lines[line0 + 1] ?? "";
    const nextReplaced = nextLine.replace(
      /^(\s*(?:>\s*)*)\[([ xX])\](\s+)/,
      `$1[${checked ? "x" : " "}]$3`
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
