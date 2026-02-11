import React, { useEffect, useRef, useState } from "react";
import { markdownToHtml } from "../lib/markdown";
import { renderMermaid } from "../lib/mermaid";
import { setTaskCheckedOnLine } from "../lib/taskList";
import { TagInput } from "./TagInput";

const PREVIEW_DEBOUNCE_MS = 320;
const EMPTY_PREVIEW_SOURCE = " ";

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
  const initialBodyValue = typeof initialBody === "string" ? initialBody : "";
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [isBodyEmpty, setIsBodyEmpty] = useState(() => initialBodyValue.trim().length === 0);
  const [error, setError] = useState<string>("");
  const [previewHtml, setPreviewHtml] = useState<string>(() => markdownToHtml(initialBodyValue || EMPTY_PREVIEW_SOURCE));
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<string>(initialBodyValue);
  const isBodyEmptyRef = useRef(initialBodyValue.trim().length === 0);
  const previewTimerRef = useRef<number | null>(null);
  const lastPreviewBodyRef = useRef<string>(initialBodyValue);

  function updateBody(nextBody: string) {
    bodyRef.current = nextBody;

    const nextIsEmpty = nextBody.trim().length === 0;
    if (isBodyEmptyRef.current !== nextIsEmpty) {
      isBodyEmptyRef.current = nextIsEmpty;
      setIsBodyEmpty(nextIsEmpty);
    }
  }

  function cancelScheduledPreview() {
    if (previewTimerRef.current === null) return;
    window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }

  function renderPreviewNow(nextBody: string) {
    cancelScheduledPreview();
    lastPreviewBodyRef.current = nextBody;
    setPreviewHtml(markdownToHtml(nextBody || EMPTY_PREVIEW_SOURCE));
  }

  function schedulePreview(nextBody: string) {
    cancelScheduledPreview();
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      if (lastPreviewBodyRef.current === nextBody) return;
      lastPreviewBodyRef.current = nextBody;
      setPreviewHtml(markdownToHtml(nextBody || EMPTY_PREVIEW_SOURCE));
    }, PREVIEW_DEBOUNCE_MS);
  }

  useEffect(() => {
    const nextBody = typeof initialBody === "string" ? initialBody : "";
    setTags(Array.isArray(initialTags) ? initialTags : []);
    updateBody(nextBody);
    if (editorRef.current) editorRef.current.value = nextBody;
    renderPreviewNow(nextBody);
    setError("");
  }, [draftKey, initialBody, initialTags]);

  useEffect(() => {
    if (!autoFocusEditor) return;
    editorRef.current?.focus();
  }, [draftKey, autoFocusEditor]);

  useEffect(() => {
    return () => cancelScheduledPreview();
  }, []);

  const canSubmit = !isBodyEmpty && !submitting;

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    void renderMermaid(el);
  }, [previewHtml]);

  async function submit() {
    const currentBody = bodyRef.current;
    if (currentBody.trim().length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(currentBody, tags);
      if (mode === "create") {
        setTags([]);
        updateBody("");
        if (editorRef.current) editorRef.current.value = "";
        renderPreviewNow("");
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
            defaultValue={bodyRef.current}
            onChange={(e) => {
              const nextBody = e.currentTarget.value;
              updateBody(nextBody);
              schedulePreview(nextBody);
            }}
            onKeyDown={(e) => {
              const isSubmit = (e.metaKey || e.ctrlKey) && e.key === "Enter";
              if (isSubmit) {
                e.preventDefault();
                void submit();
              }
              if (e.key === "Tab" && !e.shiftKey) {
                e.preventDefault();

                const el = e.currentTarget;
                const start = el.selectionStart ?? 0;
                const end = el.selectionEnd ?? 0;
                const current = el.value;
                const next = current.slice(0, start) + "\t" + current.slice(end);
                el.value = next;
                updateBody(next);
                schedulePreview(next);

                const nextPos = start + 1;
                requestAnimationFrame(() => {
                  editorRef.current?.focus();
                  editorRef.current?.setSelectionRange(nextPos, nextPos);
                });
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
                const next = setTaskCheckedOnLine(bodyRef.current, line0, t.checked);
                if (typeof next === "string") {
                  updateBody(next);
                  if (editorRef.current) editorRef.current.value = next;
                  // Checkbox toggles are deliberate; update preview immediately for correctness.
                  renderPreviewNow(next);
                }
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
