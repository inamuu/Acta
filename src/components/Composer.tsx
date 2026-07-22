import React, { useEffect, useRef, useState } from "react";
import { markdownToHtml } from "../lib/markdown";
import { renderMermaid } from "../lib/mermaid";
import { hydrateTaskCheckboxStates, nextTaskState, setTaskStateOnLine, taskStateFromInput } from "../lib/taskList";
import { TagInput } from "./TagInput";

const PREVIEW_DEBOUNCE_MS = 320;
const PREVIEW_DEBOUNCE_LARGE_DOC_MS = 520;
const PREVIEW_LARGE_DOC_THRESHOLD = 6000;
const PREVIEW_IDLE_TIMEOUT_MS = 320;
const MERMAID_RENDER_DEBOUNCE_MS = 1200;
const EMPTY_PREVIEW_SOURCE = " ";
const ENTRY_LINK_LABEL_PLACEHOLDER = "リンク先";
const ENTRY_HASH_PREFIX = "#post:";

type IdleDeadline = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadline) => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function decodeUriSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractEntryId(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";

  const hashMatch = /#post:([^\s)]+)/i.exec(raw);
  if (hashMatch?.[1]) return decodeUriSafe(hashMatch[1]).trim();

  const uriMatch = /acta:\/\/post\/([^\s)]+)/i.exec(raw);
  if (uriMatch?.[1]) return decodeUriSafe(uriMatch[1]).trim();

  if (/\s/.test(raw)) return "";
  return raw;
}

function escapeLinkLabel(label: string): string {
  return String(label ?? "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function escapeImageAlt(label: string): string {
  return escapeLinkLabel(label || "image");
}

function getClipboardImageItem(items: DataTransferItemList): DataTransferItem | null {
  for (const item of Array.from(items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item;
  }
  return null;
}

function isImeComposingEvent(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
  const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
  return Boolean(e.isComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229);
}

type Props = {
  onSubmit: (body: string, tags: string[]) => Promise<void>;
  assetBaseUrl?: string;
  tagSuggestions?: string[];
  popularTagSuggestions?: string[];
  mode?: "create" | "copy" | "edit";
  draftKey?: string;
  initialBody?: string;
  initialTags?: string[];
  source?: {
    id: string;
    date: string;
  };
  onCancel?: () => void;
  autoFocusEditor?: boolean;
};

type ComposerLayout = "write" | "split" | "preview";

export function Composer({
  onSubmit,
  assetBaseUrl,
  tagSuggestions,
  popularTagSuggestions,
  mode = "create",
  draftKey,
  initialBody,
  initialTags,
  source,
  onCancel,
  autoFocusEditor
}: Props) {
  const initialBodyValue = typeof initialBody === "string" ? initialBody : "";
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [isBodyEmpty, setIsBodyEmpty] = useState(() => initialBodyValue.trim().length === 0);
  const [error, setError] = useState<string>("");
  const [layout, setLayout] = useState<ComposerLayout>("split");
  const [previewHtml, setPreviewHtml] = useState<string>(() =>
    markdownToHtml(initialBodyValue || EMPTY_PREVIEW_SOURCE, { assetBaseUrl })
  );
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<string>(initialBodyValue);
  const isBodyEmptyRef = useRef(initialBodyValue.trim().length === 0);
  const previewTimerRef = useRef<number | null>(null);
  const previewIdleRef = useRef<number | null>(null);
  const mermaidTimerRef = useRef<number | null>(null);
  const lastPreviewBodyRef = useRef<string>(initialBodyValue);
  const isComposingRef = useRef(false);

  function updateBody(nextBody: string) {
    bodyRef.current = nextBody;

    const nextIsEmpty = nextBody.trim().length === 0;
    if (isBodyEmptyRef.current !== nextIsEmpty) {
      isBodyEmptyRef.current = nextIsEmpty;
      setIsBodyEmpty(nextIsEmpty);
    }
  }

  function cancelScheduledPreview() {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    const idleWindow = window as IdleWindow;
    if (previewIdleRef.current !== null && typeof idleWindow.cancelIdleCallback === "function") {
      idleWindow.cancelIdleCallback(previewIdleRef.current);
    } else if (previewIdleRef.current !== null) {
      window.clearTimeout(previewIdleRef.current);
    }
    previewIdleRef.current = null;
  }

  function cancelScheduledMermaid() {
    if (mermaidTimerRef.current === null) return;
    window.clearTimeout(mermaidTimerRef.current);
    mermaidTimerRef.current = null;
  }

  function commitPreview(nextBody: string) {
    if (lastPreviewBodyRef.current === nextBody) return;
    lastPreviewBodyRef.current = nextBody;
    setPreviewHtml(markdownToHtml(nextBody || EMPTY_PREVIEW_SOURCE, { assetBaseUrl }));
  }

  function renderPreviewNow(nextBody: string) {
    cancelScheduledPreview();
    commitPreview(nextBody);
  }

  function schedulePreviewCommit(nextBody: string) {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      previewIdleRef.current = idleWindow.requestIdleCallback(
        () => {
          previewIdleRef.current = null;
          commitPreview(nextBody);
        },
        { timeout: PREVIEW_IDLE_TIMEOUT_MS }
      );
      return;
    }

    previewIdleRef.current = window.setTimeout(() => {
      previewIdleRef.current = null;
      commitPreview(nextBody);
    }, 0);
  }

  function schedulePreview(nextBody: string) {
    cancelScheduledPreview();
    const delay =
      nextBody.length >= PREVIEW_LARGE_DOC_THRESHOLD ? PREVIEW_DEBOUNCE_LARGE_DOC_MS : PREVIEW_DEBOUNCE_MS;
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      schedulePreviewCommit(nextBody);
    }, delay);
  }

  function scheduleMermaidRender() {
    cancelScheduledMermaid();
    mermaidTimerRef.current = window.setTimeout(() => {
      mermaidTimerRef.current = null;
      const el = previewRef.current;
      if (!el) return;
      if (!el.querySelector(".mermaid")) return;
      void renderMermaid(el);
    }, MERMAID_RENDER_DEBOUNCE_MS);
  }

  useEffect(() => {
    const nextBody = typeof initialBody === "string" ? initialBody : "";
    setTags(Array.isArray(initialTags) ? initialTags : []);
    updateBody(nextBody);
    isComposingRef.current = false;
    if (editorRef.current) editorRef.current.value = nextBody;
    renderPreviewNow(nextBody);
    setError("");
  }, [draftKey, initialBody, initialTags]);

  useEffect(() => {
    if (!autoFocusEditor) return;
    editorRef.current?.focus();
  }, [draftKey, autoFocusEditor]);

  useEffect(() => {
    setPreviewHtml(markdownToHtml(bodyRef.current || EMPTY_PREVIEW_SOURCE, { assetBaseUrl }));
  }, [assetBaseUrl]);

  useEffect(() => {
    return () => {
      cancelScheduledPreview();
      cancelScheduledMermaid();
    };
  }, []);

  const canSubmit = !isBodyEmpty && !submitting;
  const modeLabel =
    mode === "edit" ? "既存投稿を編集中" : mode === "copy" ? "コピーから新規投稿" : "新規投稿";
  const submitLabel = mode === "edit" ? "更新" : mode === "copy" ? "コピーを追加" : "追加";
  const sourceLabel = source ? `${source.date} / ${source.id}` : "";
  const sourcePrefix = mode === "edit" ? "対象投稿" : "コピー元";

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    hydrateTaskCheckboxStates(el);
    if (!el.querySelector(".mermaid")) {
      cancelScheduledMermaid();
      return;
    }
    scheduleMermaidRender();
  }, [previewHtml]);

  async function submit() {
    const currentBody = bodyRef.current;
    if (currentBody.trim().length === 0 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(currentBody, tags);
      if (mode === "create" || mode === "copy") {
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

  async function pasteEntryLinkFromClipboard() {
    const editor = editorRef.current;
    if (!editor) return;

    let clipboardText = "";
    try {
      clipboardText = await navigator.clipboard.readText();
    } catch {
      setError("クリップボードの読み取りに失敗しました");
      return;
    }

    const entryId = extractEntryId(clipboardText);
    if (!entryId) {
      setError("クリップボードに投稿IDが見つかりません");
      return;
    }

    const current = editor.value;
    const start = editor.selectionStart ?? current.length;
    const end = editor.selectionEnd ?? start;
    const hasSelection = end > start;
    const selectedLabel = hasSelection ? current.slice(start, end) : ENTRY_LINK_LABEL_PLACEHOLDER;
    const safeLabel = escapeLinkLabel(selectedLabel);
    const href = `${ENTRY_HASH_PREFIX}${encodeURIComponent(entryId)}`;
    const snippet = `[${safeLabel}](${href})`;
    const next = current.slice(0, start) + snippet + current.slice(end);

    editor.value = next;
    updateBody(next);
    schedulePreview(next);
    setError("");

    const linkEnd = start + snippet.length;
    const labelStart = start + 1;
    const labelEnd = labelStart + safeLabel.length;

    requestAnimationFrame(() => {
      editor.focus();
      if (hasSelection) {
        editor.setSelectionRange(linkEnd, linkEnd);
      } else {
        editor.setSelectionRange(labelStart, labelEnd);
      }
    });
  }

  async function savePastedImage(file: File) {
    const api = window.acta;
    const editor = editorRef.current;
    if (!api?.saveImage || !editor) return;

    const current = editor.value;
    const start = editor.selectionStart ?? current.length;
    const end = editor.selectionEnd ?? start;

    const res = await api.saveImage({
      bytes: await file.arrayBuffer(),
      mimeType: file.type || "image/png",
      name: file.name || undefined
    });

    const alt = escapeImageAlt(file.name ? file.name.replace(/\.[^.]+$/, "") : "image");
    const snippet = `![${alt}](${res.markdownPath})`;
    const prefix = start > 0 && current[start - 1] !== "\n" ? "\n" : "";
    const suffix = current[end] && current[end] !== "\n" ? "\n" : "";
    const insert = `${prefix}${snippet}${suffix}`;
    const next = current.slice(0, start) + insert + current.slice(end);

    editor.value = next;
    updateBody(next);
    schedulePreview(next);
    setError("");

    const nextPos = start + insert.length;
    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(nextPos, nextPos);
    });
  }

  return (
    <div className="composer">
      <div className="composerHeader">
        <div className={`composerMode composerMode-${mode}`}>
          <div className="composerModeIndicator" aria-hidden="true" />
          <div className="composerModeCopy">
            <div className="composerModeTitle">{modeLabel}</div>
            {sourceLabel ? (
              <div className="composerModeMeta">
                {sourcePrefix}: {sourceLabel}
              </div>
            ) : null}
          </div>
        </div>

        <div className="composerLayoutSwitch" role="group" aria-label="エディタの表示方法">
          <button
            className={`composerLayoutButton${layout === "write" ? " isActive" : ""}`}
            type="button"
            aria-pressed={layout === "write"}
            title="入力欄だけを表示"
            onClick={() => setLayout("write")}
          >
            入力
          </button>
          <button
            className={`composerLayoutButton${layout === "split" ? " isActive" : ""}`}
            type="button"
            aria-pressed={layout === "split"}
            title="入力とプレビューを並べて表示"
            onClick={() => setLayout("split")}
          >
            分割
          </button>
          <button
            className={`composerLayoutButton${layout === "preview" ? " isActive" : ""}`}
            type="button"
            aria-pressed={layout === "preview"}
            title="プレビューだけを表示"
            onClick={() => setLayout("preview")}
          >
            表示
          </button>
        </div>
      </div>

      {error ? <div className="composerError">{error}</div> : null}

      <TagInput
        tags={tags}
        onChangeTags={setTags}
        suggestions={tagSuggestions}
        popularSuggestions={popularTagSuggestions}
        onTabToNext={() => editorRef.current?.focus()}
      />

      <div className={`composerWorkspace composerWorkspace-${layout}`}>
        <div className="composerGrid">
        <div className="pane paneWrite">
          <div className="paneTitle">
            <span className="paneTitleDot" aria-hidden="true" />
            <span>入力</span>
            <span className="paneTitleMeta">Markdown</span>
          </div>
          <textarea
            ref={editorRef}
            className="editor"
            defaultValue={bodyRef.current}
            onCompositionStart={() => {
              isComposingRef.current = true;
              cancelScheduledPreview();
            }}
            onCompositionEnd={(e) => {
              isComposingRef.current = false;
              const nextBody = e.currentTarget.value;
              updateBody(nextBody);
              schedulePreview(nextBody);
            }}
            onChange={(e) => {
              const nextBody = e.currentTarget.value;
              updateBody(nextBody);
              if (isComposingRef.current) return;
              schedulePreview(nextBody);
            }}
            onPaste={(e) => {
              const item = getClipboardImageItem(e.clipboardData.items);
              if (!item) return;

              const file = item.getAsFile();
              if (!file) return;

              e.preventDefault();
              setError("");
              void savePastedImage(file).catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                setError(msg || "画像の保存に失敗しました");
              });
            }}
            onKeyDown={(e) => {
              const isSubmit = (e.metaKey || e.ctrlKey) && e.key === "Enter";
              if (isSubmit) {
                e.preventDefault();
                void submit();
              }
              if (isImeComposingEvent(e)) return;
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
            placeholder="今日の記録をMarkdownで入力..."
            spellCheck={false}
          />
        </div>

        <div className="pane panePreview">
          <div className="paneTitle">
            <span className="paneTitleDot" aria-hidden="true" />
            <span>プレビュー</span>
            <span className="paneTitleMeta">自動更新</span>
          </div>
          <div className="previewWrap">
            <div
              ref={previewRef}
              className="preview md"
              onClick={(e) => {
                const t = e.target;
                if (!(t instanceof HTMLInputElement)) return;
                if (t.type !== "checkbox") return;
                e.preventDefault();
                const line0 = Number(t.dataset.taskLine);
                if (!Number.isFinite(line0)) return;
                const nextState = nextTaskState(taskStateFromInput(t));
                const next = setTaskStateOnLine(bodyRef.current, line0, nextState);
                if (typeof next === "string") {
                  updateBody(next);
                  if (editorRef.current) editorRef.current.value = next;
                  // Checkbox toggles are deliberate; update preview immediately for correctness.
                  renderPreviewNow(next);
                }
              }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />

          </div>
        </div>
        </div>

        <div className="composerFooter">
          <div className="composerFooterHint">
            <span className="composerSaveState" aria-hidden="true" />
            Markdown
            <span className="composerShortcut">⌘ ↵</span>
          </div>

          <div className="previewActions">
              {mode === "edit" || mode === "copy" ? (
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
                className="composerLinkButton"
                type="button"
                title="クリップボードの投稿IDをリンクとして挿入"
                onClick={() => void pasteEntryLinkFromClipboard()}
              >
                投稿リンクを挿入
              </button>

              <button
                className="primaryBtn"
                type="button"
                title="⌘/Ctrl+Enter でも保存できます"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {submitting ? "保存中..." : submitLabel}
              </button>
            </div>
        </div>
      </div>
    </div>
  );
}
