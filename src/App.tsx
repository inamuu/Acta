import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ActaEntry } from "../shared/types";
import { CommentCard } from "./components/CommentCard";
import { Composer } from "./components/Composer";
import { SettingsModal } from "./components/SettingsModal";
import { TagSidebar } from "./components/TagSidebar";
import { installDragScroll } from "./lib/dragScroll";
import { setTaskCheckedOnLine } from "./lib/taskList";

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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [appError, setAppError] = useState<string>("");
  const [editing, setEditing] = useState<ActaEntry | null>(null);
  const [draft, setDraft] = useState<{ key: string; body: string; tags: string[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const sidebarRef = useRef<HTMLElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  async function reload(opts?: { keepError?: boolean }) {
    if (!api) return;
    try {
      const list = await api.listEntries();
      setEntries(list);
      if (!opts?.keepError) setAppError("");
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

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    if (sidebarRef.current) cleanups.push(installDragScroll(sidebarRef.current, { axis: "y" }));
    if (scrollAreaRef.current) cleanups.push(installDragScroll(scrollAreaRef.current, { axis: "y" }));
    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  const { tagStats, untaggedCount } = useMemo(() => {
    const map = new Map<string, number>();
    let untagged = 0;
    for (const e of entries) {
      if (!e.tags || e.tags.length === 0) untagged += 1;
      for (const t of e.tags || []) map.set(t, (map.get(t) || 0) + 1);
    }
    const stats: TagStat[] = Array.from(map.entries()).map(([tag, count]) => ({ tag, count }));
    // 使う場面が多いので、タグ一覧は名前順で固定。
    stats.sort((a, b) => a.tag.localeCompare(b.tag, "ja"));
    return { tagStats: stats, untaggedCount: untagged };
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const q = normalizeQuery(query);
    return entries.filter((e) => {
      if (untaggedOnly) {
        if (e.tags.length !== 0) return false;
      } else if (selectedTags.length > 0) {
        for (const t of selectedTags) {
          if (!e.tags.includes(t)) return false;
        }
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
  }, [entries, query, selectedTags, untaggedOnly]);

  const visibleEntries = useMemo(() => {
    if (!limit || limit <= 0) return filteredEntries;
    return filteredEntries.slice(0, limit);
  }, [filteredEntries, limit]);

  const tagSuggestions = useMemo(() => tagStats.map((t) => t.tag), [tagStats]);
  const popularTagSuggestions = useMemo(() => {
    const copy = [...tagStats];
    copy.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, "ja");
    });
    return copy.slice(0, 10).map((t) => t.tag);
  }, [tagStats]);

  function clearTagFilter() {
    setSelectedTags([]);
    setUntaggedOnly(false);
  }

  function toggleUntaggedFilter() {
    setSelectedTags([]);
    setUntaggedOnly((v) => !v);
  }

  function toggleTagFilter(tag: string) {
    setUntaggedOnly(false);
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  }

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
      <aside className="sidebar dragScroll" ref={sidebarRef}>
        <TagSidebar
          selectedTags={selectedTags}
          untaggedOnly={untaggedOnly}
          totalCount={entries.length}
          tagStats={tagStats}
          untaggedCount={untaggedCount}
          onToggleTag={toggleTagFilter}
          onSelectAll={clearTagFilter}
          onToggleUntagged={toggleUntaggedFilter}
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
        </header>

        <section className="composerArea">
          {appError ? <div className="appError">{appError}</div> : null}
          <Composer
            tagSuggestions={tagSuggestions}
            popularTagSuggestions={popularTagSuggestions}
            mode={editing ? "edit" : "create"}
            draftKey={editing?.id ?? draft?.key ?? "create"}
            initialBody={editing?.body ?? draft?.body ?? ""}
            initialTags={editing?.tags ?? draft?.tags ?? []}
            autoFocusEditor={Boolean(editing || draft)}
            onCancel={() => setEditing(null)}
            onSubmit={async (body, tags) => {
              if (editing) {
                const res = await api.updateEntry({ id: editing.id, body, tags });
                if (!res?.updated) throw new Error("更新対象が見つかりませんでした");
                setEditing(null);
              } else {
                await api.addEntry({ body, tags });
              }
              setDraft(null);
              await reload();
            }}
          />
        </section>

        <div className="scrollArea dragScroll" ref={scrollAreaRef}>
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
                  onClickTag={(t) => toggleTagFilter(t)}
                  onEdit={(entry) => {
                    setEditing(entry);
                    setDraft(null);
                    setAppError("");
                  }}
                  onCopy={(entry) => {
                    setEditing(null);
                    setDraft({ key: `copy:${entry.id}:${Date.now()}`, body: entry.body, tags: entry.tags });
                    setAppError("");
                  }}
                  onToggleTask={async (entry, line0, checked) => {
                    const nextBody = setTaskCheckedOnLine(entry.body, line0, checked);
                    if (!nextBody) return;
                    try {
                      const res = await api.updateEntry({ id: entry.id, body: nextBody, tags: entry.tags });
                      if (!res?.updated) throw new Error("更新対象が見つかりませんでした");
                      setAppError("");
                    } catch (err) {
                      const msg = err instanceof Error ? err.message : String(err);
                      if (msg.includes("No handler registered")) {
                        setAppError("アプリを再起動してください（更新が反映されていない可能性があります）");
                      } else {
                        setAppError(msg || "更新に失敗しました");
                      }
                    } finally {
                      await reload({ keepError: true });
                    }
                  }}
                  onDelete={async (entry) => {
                    const ok = window.confirm("この投稿を削除しますか？");
                    if (!ok) return;

                    try {
                      if (editing?.id === entry.id) setEditing(null);
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

      <button className="settingsFab" type="button" onClick={() => setSettingsOpen(true)} title="設定">
        設定
      </button>

              {settingsOpen ? (
        <SettingsModal
          dataDir={dataDir}
          onClose={() => setSettingsOpen(false)}
          onChooseDataDir={async () => {
            try {
              const res = await api.chooseDataDir();
              if (!res || res.canceled) return;
              setDataDir(res.dataDir);
              clearTagFilter();
              setEditing(null);
              setDraft(null);
              setAppError("");
              setSettingsOpen(false);
              await reload();
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              setAppError(msg || "保存先の変更に失敗しました");
            }
          }}
        />
      ) : null}
    </div>
  );
}
