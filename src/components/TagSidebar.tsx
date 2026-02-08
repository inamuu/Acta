import React from "react";

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
  return (
    <nav className="tagSidebar" aria-label="タグ">
      <div className="tagSidebarTitle">Tags</div>

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

      {tagStats.length === 0 ? (
        <div className="tagEmpty">まだタグがありません</div>
      ) : (
        tagStats.map((t) => (
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
