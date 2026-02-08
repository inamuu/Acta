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
  const [appError, setAppError] = useState<string>("");
  const [limit, setLimit] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("acta:limit");
      const n = raw ? Number(raw) : 20;
      const ok = [0, 10, 20, 50, 100].includes(n);
      return ok ? n : 20;
    } catch {
      return 20;
    }
  });

  const searchRef = useRef<HTMLInputElement>(null);

  async function reload() {
    if (!api) return;
    try {
      const list = await api.listEntries();
      setEntries(list);
      setAppError("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setEntries([]);
      setAppError(msg || "読み込みに失敗しました");
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!api) return;
      setLoading(true);
      setAppError("");
      try {
        const [dirRes, listRes] = await Promise.allSettled([api.getDataDir(), api.listEntries()]);
        if (cancelled) return;

        if (dirRes.status === "fulfilled") {
          setDataDir(dirRes.value);
        } else {
          setDataDir("");
        }

        if (listRes.status === "fulfilled") {
          setEntries(listRes.value);
        } else {
          const msg = listRes.reason instanceof Error ? listRes.reason.message : String(listRes.reason);
          setEntries([]);
          setAppError(msg || "起動に失敗しました");
        }
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
    try {
      localStorage.setItem("acta:limit", String(limit));
    } catch {
      // ignore
    }
  }, [limit]);

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

  const visibleEntries = useMemo(() => {
    if (!limit || limit <= 0) return filteredEntries;
    return filteredEntries.slice(0, limit);
  }, [filteredEntries, limit]);

  const tagSuggestions = useMemo(() => tagStats.map((t) => t.tag), [tagStats]);

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
          </div>

          <div className="topbarCenter">
            <div className="topbarControls">
              <div className="search">
                <input
                  ref={searchRef}
                  className="searchInput"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="検索 (Ctrl+F)"
                />
                {query ? (
                  <button
                    className="searchClear"
                    type="button"
                    onClick={() => setQuery("")}
                    title="クリア"
                  >
                    ×
                  </button>
                ) : null}
              </div>

              <div className="limitPicker" title="表示件数">
                <div className="limitLabel">表示</div>
                <select
                  className="limitSelect"
                  value={String(limit)}
                  onChange={(e) => setLimit(Number(e.target.value))}
                >
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="0">すべて</option>
                </select>
              </div>
            </div>
          </div>

          <div className="topbarRight" title={dataDir}>
            <div className="dataDirHeader">
              <div className="dataDirLabel">保存先</div>
              <button
                className="ghostBtn"
                type="button"
                onClick={async () => {
                  try {
                    const res = await api.chooseDataDir();
                    if (!res || res.canceled) return;
                    setDataDir(res.dataDir);
                    setSelectedTag(null);
                    setAppError("");
                    await reload();
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    setAppError(msg || "保存先の変更に失敗しました");
                  }
                }}
                title="保存先を変更"
              >
                変更
              </button>
            </div>
            <div className="dataDirValue">{dataDir || "..."}</div>
          </div>
        </header>

        <section className="composerArea">
          {appError ? <div className="appError">{appError}</div> : null}
          <Composer
            tagSuggestions={tagSuggestions}
            onSubmit={async (body, tags) => {
              await api.addEntry({ body, tags });
              await reload();
            }}
          />
        </section>

        <div className="scrollArea">
          <div className="commentList">
            {loading ? (
              <div className="empty">読み込み中...</div>
            ) : filteredEntries.length === 0 ? (
              <div className="empty">該当するコメントがありません</div>
            ) : (
              visibleEntries.map((e) => (
                <CommentCard
                  key={e.id}
                  entry={e}
                  onClickTag={(t) => setSelectedTag(t)}
                  onDelete={async (entry) => {
                    const ok = window.confirm("この投稿を削除しますか？");
                    if (!ok) return;

                    try {
                      const res = await api.deleteEntry({ id: entry.id });
                      if (!res?.deleted) {
                        setAppError("削除対象が見つかりませんでした");
                      } else {
                        setAppError("");
                      }
                      await reload();
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      if (msg.includes("No handler registered")) {
                        setAppError("アプリを再起動してください（更新が反映されていない可能性があります）");
                      } else {
                        setAppError(msg || "削除に失敗しました");
                      }
                    }
                  }}
                />
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
