import React, { useMemo, useRef, useState } from "react";

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
  popularSuggestions?: string[];
  onTabToNext?: () => void;
};

function TagInputInner({ tags, onChangeTags, suggestions, popularSuggestions, onTabToNext }: Props) {
  const [draft, setDraft] = useState("");
  const [isFocused, setIsFocused] = useState(false);
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

  const pickerItemsAll = useMemo(() => {
    const list = (suggestions || []).map((t) => normalizeTag(t)).filter(Boolean);
    const uniq = Array.from(new Set(list));
    uniq.sort((a, b) => a.localeCompare(b, "ja"));
    return uniq;
  }, [suggestions]);

  const popularItems = useMemo(() => {
    const list = (popularSuggestions || []).map((t) => normalizeTag(t)).filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of list) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  }, [popularSuggestions]);

  const pickerQuery = useMemo(() => normalizeTag(draft).toLocaleLowerCase(), [draft]);

  const pickerItems = useMemo(() => {
    if (!isFocused) return [];
    if (!pickerQuery) {
      const base = popularItems.length > 0 ? popularItems : pickerItemsAll;
      return base.filter((t) => !tags.includes(t)).slice(0, 10);
    }

    return pickerItemsAll
      .filter((t) => !tags.includes(t))
      .filter((t) => t.toLocaleLowerCase().includes(pickerQuery))
      .slice(0, 12);
  }, [isFocused, pickerItemsAll, pickerQuery, popularItems, tags]);

  const showPicker = isFocused && (pickerQuery.length > 0 || popularItems.length > 0);

  return (
    <div className="tagInputWrap" onClick={() => inputRef.current?.focus()}>
      <div className="tagInputLabel">タグ</div>

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
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            commitCurrent();
            setIsFocused(false);
          }}
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
          placeholder=""
        />
      </div>

      {showPicker ? (
        <div className="tagPickerList" aria-label="タグ候補">
          {pickerItems.length === 0 ? (
            pickerQuery ? <div className="tagPickerEmpty">該当するタグがありません</div> : null
          ) : (
            pickerItems.map((t) => (
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
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

TagInputInner.displayName = "TagInput";

export const TagInput = React.memo(TagInputInner);
