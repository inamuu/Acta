import React, { useEffect, useMemo, useRef } from "react";
import type { ActaEntry } from "../../shared/types";
import { markdownToHtml } from "../lib/markdown";
import { renderMermaid } from "../lib/mermaid";
import { hydrateTaskCheckboxStates, nextTaskState, taskStateFromInput, type TaskState } from "../lib/taskList";

type Props = {
  entry: ActaEntry;
  onClickTag?: (tag: string) => void;
  onEdit?: (entry: ActaEntry) => void;
  onCopy?: (entry: ActaEntry) => void;
  onCopyId?: (entry: ActaEntry) => void;
  onDelete?: (entry: ActaEntry) => void;
  onOpenLinkedEntry?: (entryId: string) => void;
  onToggleTask?: (entry: ActaEntry, line0: number, nextState: TaskState) => void | Promise<void>;
  domId?: string;
  isLinkedTarget?: boolean;
};

function decodeUriSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseLinkedEntryId(rawHref: string): string {
  const href = String(rawHref ?? "").trim();
  if (!href) return "";

  const lowerHref = href.toLowerCase();
  if (lowerHref.startsWith("#post:")) {
    return decodeUriSafe(href.slice("#post:".length)).trim();
  }
  if (lowerHref.startsWith("acta://post/")) {
    return decodeUriSafe(href.slice("acta://post/".length)).trim();
  }
  return "";
}

function formatWhen(ms: number): string {
  if (!ms) return "";
  try {
    return new Date(ms).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

export function CommentCard({
  entry,
  onClickTag,
  onEdit,
  onCopy,
  onCopyId,
  onDelete,
  onOpenLinkedEntry,
  onToggleTask,
  domId,
  isLinkedTarget
}: Props) {
  const html = useMemo(() => markdownToHtml(entry.body), [entry.body]);
  const when = formatWhen(entry.createdAtMs);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cardClassName = isLinkedTarget ? "commentCard isLinkedTarget" : "commentCard";

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    hydrateTaskCheckboxStates(el);
    void renderMermaid(el);
  }, [html]);

  return (
    <article id={domId} className={cardClassName}>
      <div className="commentHeader">
        <div className="commentHeaderMain">
          <div className="commentHeaderLine1">
            <div className="commentHeaderRight">
              <span className="commentMeta">
                <span className="commentDate">{entry.date}</span>
                {when ? <span className="commentWhen">{when}</span> : null}
              </span>
              <button className="ghostBtn" type="button" onClick={() => onEdit?.(entry)} title="編集">
                編集
              </button>
              <button
                className="ghostBtn"
                type="button"
                onClick={() => onCopy?.(entry)}
                title="入力欄にコピー"
              >
                コピー
              </button>
              <button
                className="ghostBtn"
                type="button"
                onClick={() => onCopyId?.(entry)}
                title="投稿IDをコピー（リンクは [任意の文](#post:ID) 形式）"
              >
                IDコピー
              </button>
              <button
                className="dangerGhostBtn"
                type="button"
                onClick={() => onDelete?.(entry)}
                title="削除"
              >
                削除
              </button>
            </div>
          </div>

          {entry.tags.length > 0 ? (
            <div className="commentTags">
              {entry.tags.map((t) => (
                <button
                  className="tagPill"
                  key={t}
                  type="button"
                  onClick={() => onClickTag?.(t)}
                  title={`${t} でフィルター`}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="commentBody">
        <div
          ref={bodyRef}
          className="md"
          onClick={(e) => {
            const t = e.target;
            if (t instanceof HTMLInputElement && t.type === "checkbox") {
              e.preventDefault();
              const line0 = Number(t.dataset.taskLine);
              if (!Number.isFinite(line0)) return;
              const nextState = nextTaskState(taskStateFromInput(t));
              t.dataset.taskState = nextState;
              if (bodyRef.current) hydrateTaskCheckboxStates(bodyRef.current);
              void onToggleTask?.(entry, line0, nextState);
              return;
            }

            if (!(t instanceof Element)) return;
            const link = t.closest("a[href]");
            if (!(link instanceof HTMLAnchorElement)) return;

            const linkedEntryId = parseLinkedEntryId(link.getAttribute("href") ?? "");
            if (!linkedEntryId) return;
            e.preventDefault();
            onOpenLinkedEntry?.(linkedEntryId);
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </article>
  );
}
