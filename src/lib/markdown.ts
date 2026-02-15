import DOMPurify from "dompurify";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { taskStateFromMarker } from "./taskList";

const md = new MarkdownIt({
  linkify: true,
  breaks: true,
  highlight(code: string, langName: string): string {
    // Mermaid blocks are handled by a custom fence renderer below.
    if (langName?.trim().toLowerCase() === "mermaid") return "";

    const lang = (langName || "").trim().toLowerCase().replace(/[^0-9a-z_-]/g, "");
    try {
      const value =
        lang && hljs.getLanguage(lang)
          ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
          : hljs.highlightAuto(code).value;
      const langClass = lang ? ` language-${lang}` : "";
      return `<pre class="hljs"><code class="hljs${langClass}">${value}</code></pre>`;
    } catch {
      return "";
    }
  }
});

function taskListPlugin(markdownIt: MarkdownIt) {
  markdownIt.core.ruler.after("inline", "acta_task_list", (state) => {
    const tokens = state.tokens;

    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== "inline") continue;
      if (!inline.children || inline.children.length === 0) continue;

      const paragraphOpen = tokens[i - 1];
      const listItemOpen = tokens[i - 2];
      if (paragraphOpen?.type !== "paragraph_open") continue;
      if (listItemOpen?.type !== "list_item_open") continue;

      const first = inline.children[0];
      if (!first || first.type !== "text") continue;

      const m = first.content.match(/^\[([ xX\-\/rR])\]\s+/);
      if (!m) continue;

      const taskState = taskStateFromMarker(m[1] ?? "");
      if (!taskState) continue;
      const checked = taskState === "checked";
      const line0 = inline.map?.[0] ?? listItemOpen.map?.[0] ?? -1;

      first.content = first.content.replace(/^\[[ xX\-\/rR]\]\s+/, "");
      inline.content = inline.content.replace(/^\[[ xX\-\/rR]\]\s+/, "");

      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content =
        `<input class="taskListCheckbox" type="checkbox" data-task-line="${line0}" data-task-state="${taskState}"` +
        `${checked ? " checked" : ""} aria-label="task" />`;
      inline.children.unshift(checkbox);
      if (taskState === "review") {
        const badge = new state.Token("html_inline", "", 0);
        badge.content = `<span class="taskStateBadge taskStateBadgeReview" aria-hidden="true">R</span>`;
        inline.children.splice(1, 0, badge);
      }

      listItemOpen.attrJoin("class", "taskListItem");
      if (taskState === "partial") listItemOpen.attrJoin("class", "taskStatePartial");
      if (taskState === "review") listItemOpen.attrJoin("class", "taskStateReview");
    }
  });
}

md.use(taskListPlugin);

const defaultFence =
  md.renderer.rules.fence ??
  ((tokens, idx, options, env, slf) => slf.renderToken(tokens, idx, options));

md.renderer.rules.fence = (tokens, idx, options, env, slf) => {
  const token = tokens[idx];
  const info = token.info ? md.utils.unescapeAll(token.info).trim() : "";
  const langName = info ? info.split(/\s+/g)[0].toLowerCase() : "";

  if (langName === "mermaid") {
    // Keep it as text; we render to SVG on the client via mermaid.run().
    return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>\n`;
  }

  return defaultFence(tokens, idx, options, env, slf);
};

function normalizeLooseTaskListSyntax(markdown: string): string {
  return markdown.replace(
    /^(\s*(?:>\s*)*(?:[-+*]|\d+[.)]))\[([ xX\-\/rR])\](\s+)/gm,
    "$1 [$2]$3"
  );
}

export function markdownToHtml(markdown: string): string {
  const normalized = normalizeLooseTaskListSyntax(markdown);
  const raw = md.render(normalized);
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "data-task-line", "data-task-state", "aria-label", "aria-hidden"]
  });
}
