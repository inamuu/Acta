import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActaAiSettings,
  ActaEntry,
  ActaThemeId,
  KnowledgeIndexResult,
  KnowledgeSearchResultItem,
  KnowledgeSiteResult,
  SyncResult
} from "../shared/types";
import { AiConsole } from "./components/AiConsole";
import { CommentCard } from "./components/CommentCard";
import { Composer } from "./components/Composer";
import { SettingsModal } from "./components/SettingsModal";
import { TagSidebar } from "./components/TagSidebar";
import { installDragScroll } from "./lib/dragScroll";
import { setTaskStateOnLine, type TaskState } from "./lib/taskList";

type TagStat = { tag: string; count: number };
type DateFilterMode = "week" | "day" | "all";
type ActiveView = "journal" | "knowledge" | "ai";
type SyncIndicatorState = {
  kind: "idle" | "running" | "success" | "error";
  label: "" | "Syncing..." | "Sync Success" | "Sync Error";
  detail: string;
};

function normalizeQuery(s: string): string {
  return s.trim().toLowerCase();
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

function makeExcerpt(text: string, query: string, maxLen = 220): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;

  const firstTerm = String(query ?? "")
    .trim()
    .split(/\s+/g)
    .find(Boolean)
    ?.toLowerCase();
  const idx = firstTerm ? normalized.toLowerCase().indexOf(firstTerm) : -1;
  const start = idx > 40 ? idx - 40 : 0;
  const excerpt = normalized.slice(start, start + maxLen);
  return `${start > 0 ? "..." : ""}${excerpt}${start + maxLen < normalized.length ? "..." : ""}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateYYYYMMDD(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function lowerBound(list: string[], value: string): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function normalizeTheme(theme: string | undefined): ActaThemeId {
  switch (String(theme ?? "").toLowerCase()) {
    case "dracula":
      return "dracula";
    case "solarized-dark":
      return "solarized-dark";
    case "solarized-light":
      return "solarized-light";
    case "morokai":
      return "morokai";
    case "morokai-light":
      return "morokai-light";
    case "tokyo-night":
      return "tokyo-night";
    case "nord":
      return "nord";
    case "gruvbox-dark":
      return "gruvbox-dark";
    case "default":
    default:
      return "default";
  }
}

function buildEntryDomId(entryId: string): string {
  return `entry-${entryId}`;
}

function sortEntriesNewestFirst(list: ActaEntry[]): ActaEntry[] {
  return [...list].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = String(text ?? "");
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // Fallback for environments where async clipboard API is unavailable.
  }

  const el = document.createElement("textarea");
  el.value = value;
  el.setAttribute("readonly", "");
  el.style.position = "fixed";
  el.style.opacity = "0";
  el.style.pointerEvents = "none";
  el.style.left = "-10000px";
  document.body.appendChild(el);
  el.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(el);
  return copied;
}

export function App() {
  const api = window.acta;

  const [dataDir, setDataDir] = useState<string>("");
  const [entries, setEntries] = useState<ActaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<string>(() => formatDateYYYYMMDD(new Date()));
  const [dateFilterMode, setDateFilterMode] = useState<DateFilterMode>("week");
  const [appError, setAppError] = useState<string>("");
  const [editing, setEditing] = useState<ActaEntry | null>(null);
  const [draft, setDraft] = useState<{ key: string; body: string; tags: string[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("journal");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeExcludeTags, setKnowledgeExcludeTags] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResultItem[]>([]);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeIndexResult | null>(null);
  const [knowledgeSite, setKnowledgeSite] = useState<KnowledgeSiteResult | null>(null);
  const [aiSettings, setAiSettings] = useState<ActaAiSettings>({
    cliPath: "/opt/homebrew/bin/codex",
    instructionMarkdown: "",
    theme: "default"
  });
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncIndicator, setSyncIndicator] = useState<SyncIndicatorState>({
    kind: "idle",
    label: "",
    detail: ""
  });
  const [linkedTargetEntryId, setLinkedTargetEntryId] = useState<string>("");
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
  const knowledgeSearchRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const linkHighlightTimerRef = useRef<number | null>(null);

  function applySyncResult(result: SyncResult) {
    const detail = String(result.detail ?? "").trim();
    if (result.ok) {
      setSyncIndicator({
        kind: "success",
        label: "Sync Success",
        detail
      });
      return;
    }
    setSyncIndicator({
      kind: "error",
      label: "Sync Error",
      detail
    });
  }

  function applySyncError(err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    setSyncIndicator({
      kind: "error",
      label: "Sync Error",
      detail: msg || "同期に失敗しました"
    });
  }

  function queueBackupSync() {
    if (!api) return;
    syncQueueRef.current = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setSyncBusy(true);
        setSyncIndicator({
          kind: "running",
          label: "Syncing...",
          detail: ""
        });
        try {
          const res = await api.syncBackup();
          applySyncResult(res);
        } catch (err) {
          applySyncError(err);
        } finally {
          setSyncBusy(false);
        }
      });
  }

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
        const [dirRes, aiRes] = await Promise.allSettled([api.getDataDir(), api.getAiSettings()]);
        if (cancelled) return;

        if (dirRes.status === "fulfilled") {
          setDataDir(dirRes.value);
        } else {
          setDataDir("");
        }

        if (aiRes.status === "fulfilled") {
          setAiSettings({ ...aiRes.value, theme: normalizeTheme(aiRes.value.theme) });
        }

        setSyncBusy(true);
        setSyncIndicator({
          kind: "running",
          label: "Syncing...",
          detail: ""
        });
        try {
          const syncRes = await api.syncPull();
          if (cancelled) return;
          applySyncResult(syncRes);
        } catch (err) {
          if (cancelled) return;
          applySyncError(err);
        } finally {
          if (!cancelled) setSyncBusy(false);
        }

        try {
          const list = await api.listEntries();
          if (cancelled) return;
          setEntries(list);
          setAppError("");
        } catch (err) {
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
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
    const nextTheme = normalizeTheme(aiSettings.theme);
    document.documentElement.setAttribute("data-acta-theme", nextTheme);
  }, [aiSettings.theme]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "f" && activeView === "journal") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
      if ((e.ctrlKey || e.metaKey) && key === "f" && activeView === "knowledge") {
        e.preventDefault();
        knowledgeSearchRef.current?.focus();
        knowledgeSearchRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeView]);

  useEffect(() => {
    const cleanups: Array<() => void> = [];
    if (sidebarRef.current) cleanups.push(installDragScroll(sidebarRef.current, { axis: "y" }));
    if (scrollAreaRef.current) cleanups.push(installDragScroll(scrollAreaRef.current, { axis: "y" }));
    return () => {
      for (const fn of cleanups) fn();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (linkHighlightTimerRef.current !== null) {
        window.clearTimeout(linkHighlightTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // 日付フィルタを切り替えたら先頭に戻す（遡り操作の体験を安定させる）。
    scrollAreaRef.current?.scrollTo({ top: 0 });
  }, [dateFilter, dateFilterMode]);

  const availableDatesAsc = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e?.date) set.add(e.date);
    }
    const list = Array.from(set);
    list.sort(); // YYYY-MM-DD は文字列ソートで日付順になる
    return list;
  }, [entries]);

  const { prevAvailableDate, nextAvailableDate } = useMemo(() => {
    if (!dateFilter) return { prevAvailableDate: "", nextAvailableDate: "" };
    if (availableDatesAsc.length === 0) return { prevAvailableDate: "", nextAvailableDate: "" };

    const idx = availableDatesAsc.indexOf(dateFilter);
    if (idx >= 0) {
      return {
        prevAvailableDate: idx > 0 ? availableDatesAsc[idx - 1] : "",
        nextAvailableDate: idx < availableDatesAsc.length - 1 ? availableDatesAsc[idx + 1] : ""
      };
    }

    const insertAt = lowerBound(availableDatesAsc, dateFilter);
    return {
      prevAvailableDate: insertAt > 0 ? availableDatesAsc[insertAt - 1] : "",
      nextAvailableDate: insertAt < availableDatesAsc.length ? availableDatesAsc[insertAt] : ""
    };
  }, [availableDatesAsc, dateFilter]);

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
    const weekEndDate = dateFilter || formatDateYYYYMMDD(new Date());
    const weekStartDate = formatDateYYYYMMDD(addDays(new Date(`${weekEndDate}T00:00:00`), -6));

    return entries.filter((e) => {
      if (dateFilterMode === "day" && dateFilter && e.date !== dateFilter) return false;
      if (dateFilterMode === "week" && (e.date < weekStartDate || e.date > weekEndDate)) return false;

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
  }, [dateFilter, dateFilterMode, entries, query, selectedTags, untaggedOnly]);

  const visibleEntries = useMemo(() => {
    if (dateFilterMode !== "all") return filteredEntries;
    if (!limit || limit <= 0) return filteredEntries;
    return filteredEntries.slice(0, limit);
  }, [dateFilterMode, filteredEntries, limit]);

  const tagSuggestions = useMemo(() => tagStats.map((t) => t.tag), [tagStats]);
  const popularTagSuggestions = useMemo(() => {
    const copy = [...tagStats];
    copy.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.tag.localeCompare(b.tag, "ja");
    });
    return copy.slice(0, 10).map((t) => t.tag);
  }, [tagStats]);
  const assetBaseUrl = "acta-asset:///";

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

  function highlightLinkedEntry(entryId: string) {
    setLinkedTargetEntryId(entryId);
    if (linkHighlightTimerRef.current !== null) {
      window.clearTimeout(linkHighlightTimerRef.current);
      linkHighlightTimerRef.current = null;
    }
    linkHighlightTimerRef.current = window.setTimeout(() => {
      linkHighlightTimerRef.current = null;
      setLinkedTargetEntryId((current) => (current === entryId ? "" : current));
    }, 2200);
  }

  function scrollToEntryCard(entryId: string) {
    const domId = buildEntryDomId(entryId);
    const maxAttempts = 10;

    const run = (attempt: number) => {
      const el = document.getElementById(domId);
      if (!(el instanceof HTMLElement)) {
        if (attempt >= maxAttempts) {
          setAppError(`リンク先の投稿を表示できませんでした: ${entryId}`);
          return;
        }
        window.setTimeout(() => run(attempt + 1), 80);
        return;
      }

      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      highlightLinkedEntry(entryId);
    };

    // Wait until filter/view state updates are reflected in DOM.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => run(0));
    });
  }

  function openLinkedEntry(entryId: string) {
    const normalizedId = String(entryId ?? "").trim();
    if (!normalizedId) return;

    const target = entries.find((e) => e.id === normalizedId);
    if (!target) {
      setAppError(`リンク先の投稿が見つかりません: ${normalizedId}`);
      return;
    }

    setActiveView("journal");
    setEditing(null);
    setDraft(null);
    setQuery("");
    setDateFilter(target.date);
    clearTagFilter();
    setAppError("");
    scrollToEntryCard(target.id);
  }

  async function rebuildKnowledgeIndex() {
    setKnowledgeBusy(true);
    setKnowledgeStatus("インデックスを更新しています...");
    try {
      const res = await api.rebuildKnowledgeIndex();
      setKnowledgeIndex(res);
      setKnowledgeStatus(
        `更新完了: ${res.changedFiles}ファイル更新 / ${res.deletedFiles}ファイル削除 / ${res.totalEntries}件`
      );
      if (knowledgeQuery.trim()) {
        const searchRes = await api.searchKnowledgeIndex({
          query: knowledgeQuery,
          excludeTags: knowledgeExcludeTags.split(/[,、]/g),
          limit: 50
        });
        setKnowledgeResults(searchRes.items);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKnowledgeStatus(msg || "インデックス更新に失敗しました");
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function searchKnowledgeIndex(nextQuery = knowledgeQuery) {
    setKnowledgeBusy(true);
    setKnowledgeStatus("検索しています...");
    try {
      const res = await api.searchKnowledgeIndex({
        query: nextQuery,
        excludeTags: knowledgeExcludeTags.split(/[,、]/g),
        limit: 50
      });
      setKnowledgeResults(res.items);
      setKnowledgeStatus(`${res.items.length}件見つかりました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKnowledgeStatus(msg || "検索に失敗しました。先にインデックスを更新してください");
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function generateKnowledgeSite() {
    setKnowledgeBusy(true);
    setKnowledgeStatus("Wikiサイトを作成しています...");
    try {
      const res = await api.generateKnowledgeSite();
      setKnowledgeSite(res);
      setKnowledgeStatus(`Wiki作成完了: ${res.entryCount}件 / ${res.sitePath}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKnowledgeStatus(msg || "Wiki作成に失敗しました");
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function openKnowledgeSite() {
    try {
      const res = await api.openKnowledgeSite();
      if (!res.opened) setKnowledgeStatus(res.error || `${res.path} を開けませんでした`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKnowledgeStatus(msg || "Wikiを開けませんでした");
    }
  }

  async function copyEntryId(entry: ActaEntry) {
    const copied = await copyTextToClipboard(entry.id);
    if (!copied) {
      setAppError("投稿IDのコピーに失敗しました");
      return;
    }
    setAppError("");
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
            <div className="viewTabs">
              <button
                className={`viewTab ${activeView === "journal" ? "isActive" : ""}`}
                type="button"
                onClick={() => setActiveView("journal")}
              >
                記録
              </button>
              <button
                className={`viewTab ${activeView === "knowledge" ? "isActive" : ""}`}
                type="button"
                onClick={() => setActiveView("knowledge")}
              >
                検索
              </button>
              <button
                className={`viewTab ${activeView === "ai" ? "isActive" : ""}`}
                type="button"
                onClick={() => setActiveView("ai")}
              >
                AI対話
              </button>
            </div>
          </div>

          {activeView === "journal" ? (
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
          ) : activeView === "knowledge" ? (
            <div className="topbarCenter">
              <div className="aiTopHint">全投稿をSQLiteに索引化して、GUIとAIの両方で参照しやすくします。</div>
            </div>
          ) : (
            <div className="topbarCenter">
              <div className="aiTopHint">CLI の進捗と実行コマンドを表示しながら対話します。</div>
            </div>
          )}

          {activeView === "journal" ? (
            <div className="topbarRight">
              <div className="datePicker" title="日付で絞り込み">
                <div className="dateLabel">日付</div>

                <button
                  className="dateNavBtn"
                  type="button"
                  disabled={!prevAvailableDate}
                  title={prevAvailableDate ? `${prevAvailableDate} へ` : "前の日付がありません"}
                  onClick={() => {
                    if (!prevAvailableDate) return;
                    setDateFilter(prevAvailableDate);
                    setDateFilterMode("day");
                  }}
                >
                  ←
                </button>

                <input
                  className="dateInput"
                  type="date"
                  value={dateFilter}
                  onChange={(e) => {
                    setDateFilter(e.target.value);
                    setDateFilterMode(e.target.value ? "day" : "all");
                  }}
                />

                <button
                  className="dateNavBtn"
                  type="button"
                  disabled={!nextAvailableDate}
                  title={nextAvailableDate ? `${nextAvailableDate} へ` : "次の日付がありません"}
                  onClick={() => {
                    if (!nextAvailableDate) return;
                    setDateFilter(nextAvailableDate);
                    setDateFilterMode("day");
                  }}
                >
                  →
                </button>

                <button
                  className={`dateQuickBtn${dateFilterMode === "day" ? " isActive" : ""}`}
                  type="button"
                  title="今日"
                  onClick={() => {
                    setDateFilter(formatDateYYYYMMDD(new Date()));
                    setDateFilterMode("day");
                  }}
                >
                  今日
                </button>

                <button
                  className={`dateQuickBtn${dateFilterMode === "week" ? " isActive" : ""}`}
                  type="button"
                  title="直近1週間"
                  onClick={() => {
                    setDateFilter(formatDateYYYYMMDD(new Date()));
                    setDateFilterMode("week");
                  }}
                >
                  今週
                </button>

                {dateFilterMode !== "all" ? (
                  <button
                    className="dateClearBtn"
                    type="button"
                    title="クリア"
                    onClick={() => {
                      setDateFilter("");
                      setDateFilterMode("all");
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ) : activeView === "knowledge" ? (
            <div className="topbarRight" />
          ) : (
            <div className="topbarRight" />
          )}
        </header>

        {activeView === "journal" ? (
          <>
            <section className="composerArea">
              {appError ? <div className="appError">{appError}</div> : null}
              <Composer
                assetBaseUrl={assetBaseUrl}
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
                    await reload();
                  } else {
                    const entry = await api.addEntry({ body, tags });
                    setEntries((prev) => sortEntriesNewestFirst([entry, ...prev.filter((e) => e.id !== entry.id)]));
                    setDateFilter(entry.date);
                    setDateFilterMode("week");
                    setQuery("");
                    clearTagFilter();
                    setAppError("");
                  }
                  setDraft(null);
                  queueBackupSync();
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
                      assetBaseUrl={assetBaseUrl}
                      domId={buildEntryDomId(e.id)}
                      isLinkedTarget={linkedTargetEntryId === e.id}
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
                      onCopyId={(entry) => {
                        void copyEntryId(entry);
                      }}
                      onOpenLinkedEntry={(entryId) => {
                        openLinkedEntry(entryId);
                      }}
                      onToggleTask={async (entry, line0, nextState: TaskState) => {
                        const nextBody = setTaskStateOnLine(entry.body, line0, nextState);
                        if (!nextBody) return;
                        let updated = false;
                        try {
                          const res = await api.updateEntry({ id: entry.id, body: nextBody, tags: entry.tags });
                          if (!res?.updated) throw new Error("更新対象が見つかりませんでした");
                          updated = true;
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
                          if (updated) queueBackupSync();
                        }
                      }}
                      onDelete={async (entry) => {
                        const ok = window.confirm("この投稿を削除しますか？");
                        if (!ok) return;

                        let deleted = false;
                        try {
                          if (editing?.id === entry.id) setEditing(null);
                          const res = await api.deleteEntry({ id: entry.id });
                          if (!res?.deleted) {
                            setAppError("削除対象が見つかりませんでした");
                          } else {
                            deleted = true;
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
                        if (deleted) queueBackupSync();
                      }}
                    />
                  ))
                )}
              </div>
            </div>
          </>
        ) : null}

        {activeView === "knowledge" ? (
          <section className="knowledgeArea">
            <div className="knowledgeToolbar">
              <div className="knowledgeSearch">
                <input
                  ref={knowledgeSearchRef}
                  className="knowledgeSearchInput"
                  value={knowledgeQuery}
                  onChange={(e) => setKnowledgeQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void searchKnowledgeIndex();
                  }}
                  placeholder="SQLiteインデックスを検索 (Ctrl+F)"
                />
                <button
                  className="primaryActionBtn"
                  type="button"
                  disabled={knowledgeBusy}
                  onClick={() => void searchKnowledgeIndex()}
                >
                  検索
                </button>
              </div>

              <input
                className="knowledgeExcludeInput"
                value={knowledgeExcludeTags}
                onChange={(e) => setKnowledgeExcludeTags(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void searchKnowledgeIndex();
                }}
                placeholder="除外タグ (, 区切り)"
                title="指定したタグを含む投稿を検索結果から除外"
              />

              <div className="knowledgeActions">
                <button
                  className="ghostBtn"
                  type="button"
                  disabled={knowledgeBusy}
                  onClick={() => void rebuildKnowledgeIndex()}
                  title="変更された日次ファイルだけをSQLiteへ反映"
                >
                  インデックス更新
                </button>
                <button
                  className="ghostBtn"
                  type="button"
                  disabled={knowledgeBusy}
                  onClick={() => void generateKnowledgeSite()}
                  title="SQLiteインデックスから静的Wikiを作成"
                >
                  Wiki作成
                </button>
                <button className="ghostBtn" type="button" onClick={() => void openKnowledgeSite()}>
                  Wikiを開く
                </button>
              </div>
            </div>

            <div className="knowledgeStatus">
              {knowledgeStatus || "インデックス更新後、全投稿を対象に検索できます。"}
              {knowledgeIndex ? (
                <span>
                  {" "}
                  DB: {knowledgeIndex.dbPath} / State: {knowledgeIndex.statePath}
                </span>
              ) : null}
              {knowledgeSite ? <span> / Wiki: {knowledgeSite.sitePath}</span> : null}
            </div>

            <div className="knowledgeResults">
              {knowledgeResults.length === 0 ? (
                <div className="empty">検索結果はまだありません</div>
              ) : (
                knowledgeResults.map((item) => (
                  <article className="knowledgeResult" key={item.id}>
                    <div className="knowledgeResultHead">
                      <button
                        className="knowledgeResultTitle"
                        type="button"
                        onClick={() => openLinkedEntry(item.id)}
                        title="記録で開く"
                      >
                        {item.title || `${item.date} の記録`}
                      </button>
                      <span className="knowledgeScore">score {item.score}</span>
                    </div>
                    <div className="knowledgeResultMeta">
                      {item.created || item.date} / {item.id}
                    </div>
                    {item.tags.length > 0 ? (
                      <div className="commentTags">
                        {item.tags.map((tag) => (
                          <button
                            className="tagPill"
                            key={tag}
                            type="button"
                            onClick={() => {
                              setActiveView("journal");
                              clearTagFilter();
                              toggleTagFilter(tag);
                            }}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <p className="knowledgeExcerpt">{makeExcerpt(item.body, knowledgeQuery)}</p>
                    <div className="knowledgeSource">{item.sourceFile}</div>
                  </article>
                ))
              )}
            </div>
          </section>
        ) : null}

        <section className={`aiArea ${activeView === "ai" ? "" : "isHidden"}`}>
          <AiConsole settings={aiSettings} dataDir={dataDir} />
        </section>
      </main>

      {syncIndicator.label ? (
        <div
          className={`syncStatus ${
            syncIndicator.kind === "error" ? "isError" : syncIndicator.kind === "success" ? "isSuccess" : "isRunning"
          }`}
          title={syncIndicator.detail || syncIndicator.label}
        >
          {syncIndicator.label}
        </div>
      ) : null}

      <button
        className="settingsFab syncFab"
        type="button"
        onClick={() => queueBackupSync()}
        title="同期"
        disabled={syncBusy}
      >
        {syncBusy ? "同期中..." : "同期"}
      </button>

      <button className="settingsFab" type="button" onClick={() => setSettingsOpen(true)} title="設定">
        設定
      </button>

      {settingsOpen ? (
        <SettingsModal
          dataDir={dataDir}
          aiCliPath={aiSettings.cliPath}
          aiInstructionMarkdown={aiSettings.instructionMarkdown}
          aiTheme={normalizeTheme(aiSettings.theme)}
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
          onSaveAiSettings={async (payload) => {
            const saved = await api.saveAiSettings(payload);
            setAiSettings({ ...saved, theme: normalizeTheme(saved.theme) });
          }}
        />
      ) : null}
    </div>
  );
}
