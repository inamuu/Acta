import React, { useMemo } from "react";
import type { ActaEntry } from "../../shared/types";
import { markdownToHtml } from "../lib/markdown";

type Props = {
  entry: ActaEntry;
  onClickTag?: (tag: string) => void;
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

export function CommentCard({ entry, onClickTag }: Props) {
  const html = useMemo(() => markdownToHtml(entry.body), [entry.body]);
  const when = formatWhen(entry.createdAtMs);

  return (
    <article className="commentCard">
      <div className="commentHeader">
        <div className="avatar" aria-hidden="true">
          A
        </div>
        <div className="commentHeaderMain">
          <div className="commentHeaderLine1">
            <span className="commentAuthor">Acta</span>
            <span className="commentMeta">
              <span className="commentDate">{entry.date}</span>
              {when ? <span className="commentWhen">{when}</span> : null}
            </span>
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
        <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </article>
  );
}

