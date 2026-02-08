import React, { useRef, useState } from "react";

function normalizeTag(raw: string): string {
  return String(raw ?? "")
    .replace(/^[#＃]/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitBySeparators(raw: string): string[] {
  return raw.split(/[,、]/g);
}

type Props = {
  tags: string[];
  onChangeTags: (tags: string[]) => void;
  suggestions?: string[];
  onTabToNext?: () => void;
};

export function TagInput({ tags, onChangeTags, suggestions, onTabToNext }: Props) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTagToList(list: string[], raw: string): string[] {
    const t = normalizeTag(raw);
    if (!t) return list;
    if (list.includes(t)) return list;
    return [...list, t];
  }

  function commitFromDraft(value: string) {
    const parts = splitBySeparators(value);
    if (parts.length === 1) return false;

    let next = tags;
    for (let i = 0; i < parts.length - 1; i += 1) next = addTagToList(next, parts[i]);
    if (next !== tags) onChangeTags(next);
    setDraft(parts[parts.length - 1] ?? "");
    return true;
  }

  function commitCurrent() {
    const t = normalizeTag(draft);
    if (t) onChangeTags(addTagToList(tags, t));
    setDraft("");
  }

  const q = normalizeTag(draft).toLowerCase();
  const visibleSuggestions = (suggestions || [])
    .filter((t) => !tags.includes(t))
    .filter((t) => (q ? t.toLowerCase().includes(q) : true))
    .slice(0, 18);

  return (
    <div className="tagInputWrap" onClick={() => inputRef.current?.focus()}>
      <div className="tagInputLabel">タグ（`,` / `、` で区切り）</div>

      <div className="tagChips">
        {tags.map((t) => (
          <span className="tagChip" key={t}>
            <span className="tagChipText">{t}</span>
            <button
              className="tagChipRemove"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChangeTags(tags.filter((x) => x !== t));
              }}
              aria-label={`${t} を削除`}
              title="削除"
              type="button"
            >
              ×
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          className="tagInput"
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (!commitFromDraft(v)) setDraft(v);
          }}
          onBlur={() => commitCurrent()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitCurrent();
              return;
            }
            if (e.key === "Tab" && !e.shiftKey) {
              e.preventDefault();
              commitCurrent();
              onTabToNext?.();
              return;
            }
            if (e.key === "Backspace" && draft.length === 0 && tags.length > 0) {
              onChangeTags(tags.slice(0, -1));
              return;
            }
          }}
          placeholder={tags.length === 0 ? "例: 日記, 仕事、メモ" : ""}
        />
      </div>

      {visibleSuggestions.length > 0 ? (
        <div className="tagSuggestions" aria-label="既存タグ候補">
          {visibleSuggestions.map((t) => (
            <button
              key={t}
              type="button"
              className="tagSuggestionPill"
              onMouseDown={(e) => {
                // Keep focus on the input (avoid triggering input blur commit).
                e.preventDefault();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChangeTags(addTagToList(tags, t));
                setDraft("");
                inputRef.current?.focus();
              }}
              title="クリックで追加"
            >
              {t}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
