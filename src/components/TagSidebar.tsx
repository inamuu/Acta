import React, { useMemo, useState } from "react";

type TagStat = {
  tag: string;
  count: number;
};

type Props = {
  selectedTag: string | null;
  totalCount: number;
  tagStats: TagStat[];
  untaggedCount: number;
  onSelectTag: (tag: string | null) => void;
};

export function TagSidebar({ selectedTag, totalCount, tagStats, untaggedCount, onSelectTag }: Props) {
  const [tagQuery, setTagQuery] = useState("");

  const visibleTagStats = useMemo(() => {
    const q = tagQuery.trim().toLocaleLowerCase();
    if (!q) return tagStats;
    return tagStats.filter((t) => t.tag.toLocaleLowerCase().includes(q));
  }, [tagQuery, tagStats]);

  return (
    <nav className="tagSidebar" aria-label="タグ">
      <div className="tagSidebarTitle">Tags</div>

      <div className="tagSearch" role="search" aria-label="タグ検索">
        <input
          className="tagSearchInput"
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
          placeholder="タグ検索"
          onKeyDown={(e) => {
            if (e.key === "Escape") setTagQuery("");
          }}
        />
        {tagQuery ? (
          <button className="tagSearchClear" type="button" onClick={() => setTagQuery("")} title="クリア">
            ×
          </button>
        ) : null}
      </div>

      <button
        className={`tagItem ${selectedTag === null ? "isSelected" : ""}`}
        onClick={() => onSelectTag(null)}
        type="button"
      >
        <span className="tagName">すべて</span>
        <span className="tagCount">{totalCount}</span>
      </button>

      {untaggedCount > 0 ? (
        <button
          className={`tagItem ${selectedTag === "__UNTAGGED__" ? "isSelected" : ""}`}
          onClick={() => onSelectTag("__UNTAGGED__")}
          type="button"
        >
          <span className="tagName">タグなし</span>
          <span className="tagCount">{untaggedCount}</span>
        </button>
      ) : null}

      <div className="tagDivider" />

      {visibleTagStats.length === 0 ? (
        <div className="tagEmpty">まだタグがありません</div>
      ) : (
        visibleTagStats.map((t) => (
          <button
            key={t.tag}
            className={`tagItem ${selectedTag === t.tag ? "isSelected" : ""}`}
            onClick={() => onSelectTag(t.tag)}
            title={t.tag}
            type="button"
          >
            <span className="tagName">{t.tag}</span>
            <span className="tagCount">{t.count}</span>
          </button>
        ))
      )}
    </nav>
  );
}
