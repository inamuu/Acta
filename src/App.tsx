import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ActaEntry } from "../shared/types";
import { CommentCard } from "./components/CommentCard";
import { Composer } from "./components/Composer";
import { TagSidebar } from "./components/TagSidebar";

type TagStat = { tag: string; count: number };

function normalizeQuery(s: string): string {
  return s.trim().toLowerCase();
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

export function App() {
  const api = window.acta;

  const [dataDir, setDataDir] = useState<string>("");
  const [entries, setEntries] = useState<ActaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);

  async function reload() {
    if (!api) return;
    const list = await api.listEntries();
    setEntries(list);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!api) return;
      setLoading(true);
      try {
        const [dir, list] = await Promise.all([api.getDataDir(), api.listEntries()]);
        if (cancelled) return;
        setDataDir(dir);
        setEntries(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const { tagStats, untaggedCount } = useMemo(() => {
    const map = new Map<string, number>();
    let untagged = 0;
    for (const e of entries) {
      if (!e.tags || e.tags.length === 0) untagged += 1;
      for (const t of e.tags || []) map.set(t, (map.get(t) || 0) + 1);
    }
    const stats: TagStat[] = Array.from(map.entries()).map(([tag, count]) => ({ tag, count }));
    stats.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "ja"));
    return { tagStats: stats, untaggedCount: untagged };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = normalizeQuery(query);
    return entries.filter((e) => {
      if (selectedTag === "__UNTAGGED__") {
        if (e.tags.length !== 0) return false;
      } else if (selectedTag) {
        if (!e.tags.includes(selectedTag)) return false;
      }

      if (!q) return true;
      const tagText = e.tags.join(" ");
      return (
        includesLoose(e.body, q) ||
        includesLoose(tagText, q) ||
        includesLoose(e.date, q) ||
        includesLoose(e.created, q)
      );
    });
  }, [entries, query, selectedTag]);

  if (!api) {
    return (
      <div className="noApi">
        <div className="noApiCard">
          <div className="noApiTitle">Electronで起動してください</div>
          <div className="noApiBody">
            `npm run dev` で起動すると、保存機能（ファイル書き込み）が有効になります。
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <TagSidebar
          selectedTag={selectedTag}
          totalCount={entries.length}
          tagStats={tagStats}
          untaggedCount={untaggedCount}
          onSelectTag={setSelectedTag}
        />
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbarLeft">
            <div className="appTitle">Acta</div>
            <div className="appSubTitle">GitHub issue風 Markdown ログ</div>
          </div>

          <div className="topbarCenter">
            <div className="search">
              <input
                ref={searchRef}
                className="searchInput"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="検索 (Ctrl+F)"
              />
              {query ? (
                <button className="searchClear" type="button" onClick={() => setQuery("")} title="クリア">
                  ×
                </button>
              ) : null}
            </div>
          </div>

          <div className="topbarRight" title={dataDir}>
            <div className="dataDirLabel">保存先</div>
            <div className="dataDirValue">{dataDir || "..."}</div>
          </div>
        </header>

        <div className="scrollArea">
          <div className="commentList">
            {loading ? (
              <div className="empty">読み込み中...</div>
            ) : filteredEntries.length === 0 ? (
              <div className="empty">該当するコメントがありません</div>
            ) : (
              filteredEntries.map((e) => (
                <CommentCard key={e.id} entry={e} onClickTag={(t) => setSelectedTag(t)} />
              ))
            )}
          </div>
        </div>

        <footer className="composerArea">
          <Composer
            onSubmit={async (body, tags) => {
              await api.addEntry({ body, tags });
              await reload();
            }}
          />
        </footer>
      </main>
    </div>
  );
}
