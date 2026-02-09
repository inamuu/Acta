import React, { useEffect, useMemo, useRef, useState } from "react";
import { markdownToHtml } from "../lib/markdown";
import { renderMermaid } from "../lib/mermaid";
import { TagInput } from "./TagInput";

type Props = {
  onSubmit: (body: string, tags: string[]) => Promise<void>;
  tagSuggestions?: string[];
  mode?: "create" | "edit";
  draftKey?: string;
  initialBody?: string;
  initialTags?: string[];
  onCancel?: () => void;
  autoFocusEditor?: boolean;
};

export function Composer({
  onSubmit,
  tagSuggestions,
  mode = "create",
  draftKey,
  initialBody,
  initialTags,
  onCancel,
  autoFocusEditor
}: Props) {
  const [tags, setTags] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTags(Array.isArray(initialTags) ? initialTags : []);
    setBody(typeof initialBody === "string" ? initialBody : "");
    setError("");
  }, [draftKey, initialBody, initialTags]);

  useEffect(() => {
    if (!autoFocusEditor) return;
    editorRef.current?.focus();
  }, [draftKey, autoFocusEditor]);

  const previewHtml = useMemo(() => markdownToHtml(body || " "), [body]);
  const canSubmit = body.trim().length > 0 && !submitting;

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    void renderMermaid(el);
  }, [previewHtml]);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(body, tags);
      if (mode === "create") {
        setBody("");
        setTags([]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("No handler registered")) {
        setError("アプリを再起動してください（更新が反映されていない可能性があります）");
      } else {
        setError(msg || "保存に失敗しました");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="composer">
      <div className={`composerTop ${mode === "edit" ? "" : "composerTopCompact"}`}>
        {mode === "edit" ? <div className="composerTitle">編集中</div> : null}

        <div className="composerActions">
          {mode === "edit" ? (
            <button
              className="ghostBtn"
              type="button"
              onClick={() => {
                setError("");
                onCancel?.();
              }}
            >
              キャンセル
            </button>
          ) : null}

          <button className="primaryBtn" type="button" disabled={!canSubmit} onClick={() => void submit()}>
            {submitting ? "保存中..." : mode === "edit" ? "更新 (⌘/Ctrl+Enter)" : "追加 (⌘/Ctrl+Enter)"}
          </button>
        </div>
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
          <div ref={previewRef} className="preview md" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>
    </div>
  );
}
