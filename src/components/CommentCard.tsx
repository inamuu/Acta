import React, { useEffect, useMemo, useRef } from "react";
import type { ActaEntry } from "../../shared/types";
import { markdownToHtml } from "../lib/markdown";
import { renderMermaid } from "../lib/mermaid";

type Props = {
  entry: ActaEntry;
  onClickTag?: (tag: string) => void;
  onEdit?: (entry: ActaEntry) => void;
  onCopy?: (entry: ActaEntry) => void;
  onDelete?: (entry: ActaEntry) => void;
  onToggleTask?: (entry: ActaEntry, line0: number, checked: boolean) => void | Promise<void>;
};

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

export function CommentCard({ entry, onClickTag, onEdit, onCopy, onDelete, onToggleTask }: Props) {
  const html = useMemo(() => markdownToHtml(entry.body), [entry.body]);
  const when = formatWhen(entry.createdAtMs);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    void renderMermaid(el);
  }, [html]);

  return (
    <article className="commentCard">
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
            if (!(t instanceof HTMLInputElement)) return;
            if (t.type !== "checkbox") return;
            const line0 = Number(t.dataset.taskLine);
            if (!Number.isFinite(line0)) return;
            void onToggleTask?.(entry, line0, t.checked);
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </article>
  );
}
