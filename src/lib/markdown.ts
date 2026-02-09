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
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}
