import DOMPurify from "dompurify";
import hljs from "highlight.js";
import MarkdownIt from "markdown-it";

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

      const m = first.content.match(/^\[([ xX])\]\s+/);
      if (!m) continue;

      const checked = m[1].toLowerCase() === "x";
      const line0 = inline.map?.[0] ?? listItemOpen.map?.[0] ?? -1;

      first.content = first.content.replace(/^\[[ xX]\]\s+/, "");
      inline.content = inline.content.replace(/^\[[ xX]\]\s+/, "");

      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input class="taskListCheckbox" type="checkbox" data-task-line="${line0}"${
        checked ? " checked" : ""
      } aria-label="task" /> `;
      inline.children.unshift(checkbox);

      listItemOpen.attrJoin("class", "taskListItem");
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

export function markdownToHtml(markdown: string): string {
  const raw = md.render(markdown);
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ["input"],
    ADD_ATTR: ["type", "checked", "data-task-line", "aria-label"]
  });
}
