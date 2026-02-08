import React, { useMemo, useRef, useState } from "react";
import { markdownToHtml } from "../lib/markdown";
import { TagInput } from "./TagInput";

type Props = {
  onSubmit: (body: string, tags: string[]) => Promise<void>;
  tagSuggestions?: string[];
};

export function Composer({ onSubmit, tagSuggestions }: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const previewHtml = useMemo(() => markdownToHtml(body || " "), [body]);
  const canSubmit = body.trim().length > 0 && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(body, tags);
      setBody("");
      setTags([]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "保存に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="composer">
      <div className="composerTop">
        <div className="composerTitle">コメントを追加</div>
        <button className="primaryBtn" type="button" disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? "保存中..." : "追加 (⌘/Ctrl+Enter)"}
        </button>
      </div>

      {error ? <div className="composerError">{error}</div> : null}

      <TagInput
        tags={tags}
        onChangeTags={setTags}
        suggestions={tagSuggestions}
        onTabToNext={() => editorRef.current?.focus()}
      />

      <div className="composerGrid">
        <div className="pane">
          <div className="paneTitle">Write</div>
          <textarea
            ref={editorRef}
            className="editor"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              const isSubmit = (e.metaKey || e.ctrlKey) && e.key === "Enter";
              if (isSubmit) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={"Markdownで書けます。\n例:\n- 今日やったこと\n- 次やること\n\n```ts\nconsole.log('hello')\n```"}
            spellCheck={false}
          />
        </div>

        <div className="pane">
          <div className="paneTitle">Preview</div>
          <div className="preview md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>
    </div>
  );
}
