import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  linkify: true,
  breaks: true
});

export function markdownToHtml(markdown: string): string {
  const raw = md.render(markdown);
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

