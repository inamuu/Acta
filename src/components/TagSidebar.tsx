import React, { useMemo, useState } from "react";

type TagStat = {
  tag: string;
  count: number;
};

type TagGroup = {
  group: string;
  tags: TagStat[];
};

type Props = {
  activeView: "todo" | "projects" | "journal" | "knowledge" | "ai";
  selectedTags: string[];
  untaggedOnly: boolean;
  totalCount: number;
  todoCount: number;
  activeProjectCount: number;
  activeProjectTaskCount: number;
  tagStats: TagStat[];
  untaggedCount: number;
  selectedProjectName: string;
  onChangeView: (view: "todo" | "projects" | "journal" | "knowledge" | "ai") => void;
  onToggleTag: (tag: string) => void;
  onSelectAll: () => void;
  onToggleUntagged: () => void;
};

function groupKey(tag: string): string {
  const chars = Array.from(tag);
  if (chars.length <= 3) return tag;
  return chars.slice(0, 3).join("");
}

export function TagSidebar({
  activeView,
  selectedTags,
  untaggedOnly,
  totalCount,
  todoCount,
  activeProjectCount,
  activeProjectTaskCount,
  tagStats,
  untaggedCount,
  selectedProjectName,
  onChangeView,
  onToggleTag,
  onSelectAll,
  onToggleUntagged
}: Props) {
  const [tagQuery, setTagQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);

  const visibleTagStats = useMemo(() => {
    const q = tagQuery.trim().toLocaleLowerCase();
    if (!q) return tagStats;
    return tagStats.filter((t) => t.tag.toLocaleLowerCase().includes(q));
  }, [tagQuery, tagStats]);

  const { groupedKeys, groupTagCountByKey } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of tagStats) {
      const k = groupKey(t.tag);
      counts.set(k, (counts.get(k) || 0) + 1);
    }

    const grouped = new Set<string>();
    for (const [k, n] of counts) {
      if (n >= 2) grouped.add(k);
    }

    return { groupedKeys: grouped, groupTagCountByKey: counts };
  }, [tagStats]);

  const { groups, singles } = useMemo((): { groups: TagGroup[]; singles: TagStat[] } => {
    const map = new Map<string, TagStat[]>();
    const singles: TagStat[] = [];

    for (const t of visibleTagStats) {
      const k = groupKey(t.tag);
      if (!groupedKeys.has(k)) {
        singles.push(t);
        continue;
      }
      const list = map.get(k);
      if (list) list.push(t);
      else map.set(k, [t]);
    }

    const groups: TagGroup[] = Array.from(map.entries()).map(([k, list]) => ({ group: k, tags: list }));
    groups.sort((a, b) => a.group.localeCompare(b.group, "ja"));

    return { groups, singles };
  }, [groupedKeys, visibleTagStats]);

  return (
    <nav className="tagSidebar" aria-label="メニュー">
      <div className="sideBrand" data-no-drag-scroll title="ドラッグしてウィンドウを移動">
        <div className="sideBrandName">Acta</div>
        <div className="sideBrandSub">{selectedProjectName || "今日の作業"}</div>
      </div>

      <div className="sideNav">
        <button
          className={`sideNavItem ${activeView === "todo" ? "isActive" : ""}`}
          type="button"
          onClick={() => onChangeView("todo")}
          title="⌘1"
        >
          <span className="sideNavIcon">✓</span>
          <span className="sideNavText">ToDo</span>
          <span className="tagCount">{todoCount}</span>
        </button>
        <button
          className={`sideNavItem ${activeView === "projects" ? "isActive" : ""}`}
          type="button"
          onClick={() => onChangeView("projects")}
          title="⌘2"
        >
          <span className="sideNavIcon">▦</span>
          <span className="sideNavText">プロジェクト</span>
          <span className="tagCount">{activeProjectTaskCount}</span>
        </button>
        <button
          className={`sideNavItem ${activeView === "journal" ? "isActive" : ""}`}
          type="button"
          onClick={() => onChangeView("journal")}
          title="⌘3"
        >
          <span className="sideNavIcon">◷</span>
          <span className="sideNavText">ナレッジ</span>
          <span className="tagCount">{totalCount}</span>
        </button>
        <button
          className={`sideNavItem ${activeView === "knowledge" ? "isActive" : ""}`}
          type="button"
          onClick={() => onChangeView("knowledge")}
          title="⌘4"
        >
          <span className="sideNavIcon">⌕</span>
          <span className="sideNavText">検索</span>
        </button>
        <button
          className={`sideNavItem ${activeView === "ai" ? "isActive" : ""}`}
          type="button"
          onClick={() => onChangeView("ai")}
          title="⌘5"
        >
          <span className="sideNavIcon">✦</span>
          <span className="sideNavText">AI対話</span>
        </button>
      </div>

      <div className="sideStats">
        <div className="sideStat">
          <span>Active Projects</span>
          <strong>{activeProjectCount}</strong>
        </div>
        <div className="sideStat">
          <span>Active Tasks</span>
          <strong>{activeProjectTaskCount}</strong>
        </div>
      </div>

      <button
        className={`tagGroupHeader ${filtersOpen ? "isOpen" : ""}`}
        type="button"
        onClick={() => setFiltersOpen((v) => !v)}
      >
        <span className="tagGroupName">ナレッジフィルター</span>
        <span className="tagCount">{selectedTags.length + (untaggedOnly ? 1 : 0)}</span>
      </button>

      {filtersOpen ? (
        <>
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
            className={`tagItem ${selectedTags.length === 0 && !untaggedOnly ? "isSelected" : ""}`}
            onClick={() => onSelectAll()}
            type="button"
          >
            <span className="tagName">すべて</span>
            <span className="tagCount">{totalCount}</span>
          </button>

          {untaggedCount > 0 ? (
            <button
              className={`tagItem ${untaggedOnly ? "isSelected" : ""}`}
              onClick={() => onToggleUntagged()}
              type="button"
            >
              <span className="tagName">タグなし</span>
              <span className="tagCount">{untaggedCount}</span>
            </button>
          ) : null}

          <div className="tagDivider" />

          {tagStats.length === 0 ? (
            <div className="tagEmpty">まだタグがありません</div>
          ) : visibleTagStats.length === 0 ? (
            <div className="tagEmpty">該当するタグがありません</div>
          ) : (
            <>
              {groups.map((g) => {
                const isCollapsed = Boolean(collapsed[g.group]);
                const isActive = g.tags.some((t) => selectedTags.includes(t.tag));
                const totalTagsInGroup = groupTagCountByKey.get(g.group) ?? g.tags.length;
                return (
                  <div className="tagGroup" key={g.group}>
                    <button
                      className={`tagGroupHeader ${isCollapsed ? "" : "isOpen"} ${isActive ? "isActive" : ""}`}
                      type="button"
                      onClick={() => setCollapsed((m) => ({ ...m, [g.group]: !m[g.group] }))}
                      title={isCollapsed ? "展開" : "折りたたむ"}
                    >
                      <span className="tagGroupName">{g.group}</span>
                      <span className="tagCount">{totalTagsInGroup}</span>
                    </button>

                    {isCollapsed
                      ? null
                      : g.tags.map((t) => (
                          <button
                            key={t.tag}
                            className={`tagItem ${selectedTags.includes(t.tag) ? "isSelected" : ""}`}
                            onClick={() => onToggleTag(t.tag)}
                            title={t.tag}
                            type="button"
                          >
                            <span className="tagName">{t.tag}</span>
                            <span className="tagCount">{t.count}</span>
                          </button>
                        ))}
                  </div>
                );
              })}

              {singles.map((t) => (
                <button
                  key={t.tag}
                  className={`tagItem ${selectedTags.includes(t.tag) ? "isSelected" : ""}`}
                  onClick={() => onToggleTag(t.tag)}
                  title={t.tag}
                  type="button"
                >
                  <span className="tagName">{t.tag}</span>
                  <span className="tagCount">{t.count}</span>
                </button>
              ))}
            </>
          )}
        </>
      ) : null}
    </nav>
  );
}
