import React, { useEffect, useMemo, useRef, useState } from "react";
import { markdownToHtml } from "../lib/markdown";
import { renderMermaid } from "../lib/mermaid";
import { setTaskCheckedOnLine } from "../lib/taskList";
import { TagInput } from "./TagInput";

type Props = {
  onSubmit: (body: string, tags: string[]) => Promise<void>;
  tagSuggestions?: string[];
  popularTagSuggestions?: string[];
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
  popularTagSuggestions,
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
      {mode === "edit" ? <div className="composerTitle">編集中</div> : null}

      {error ? <div className="composerError">{error}</div> : null}

      <TagInput
        tags={tags}
        onChangeTags={setTags}
        suggestions={tagSuggestions}
        popularSuggestions={popularTagSuggestions}
        onTabToNext={() => editorRef.current?.focus()}
      />

      <div className="composerGrid">
        <div className="pane paneWrite">
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

        <div className="pane panePreview">
          <div className="paneTitle">Preview</div>
          <div className="previewWrap">
            <div
              ref={previewRef}
              className="preview md"
              onChange={(e) => {
                const t = e.target;
                if (!(t instanceof HTMLInputElement)) return;
                if (t.type !== "checkbox") return;
                const line0 = Number(t.dataset.taskLine);
                if (!Number.isFinite(line0)) return;
                const next = setTaskCheckedOnLine(body, line0, t.checked);
                if (typeof next === "string") setBody(next);
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />

            <div className="previewActions">
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

              <button
                className="primaryBtn"
                type="button"
                title="⌘/Ctrl+Enter でも保存できます"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {submitting ? "保存中..." : mode === "edit" ? "更新" : "追加"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
