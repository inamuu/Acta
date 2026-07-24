import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActaAiSettings,
  ActaEntry,
  ActaProject,
  ActaThemeId,
  ProjectTask,
  ProjectTaskStatus,
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
type ActiveView = "todo" | "projects" | "journal" | "knowledge" | "ai";
type DraftPost = {
  key: string;
  body: string;
  tags: string[];
  source?: {
    id: string;
    date: string;
  };
};
type SyncIndicatorState = {
  kind: "idle" | "running" | "success" | "error";
  label: "" | "Syncing..." | "Sync Success" | "Sync Error";
  detail: string;
};

const BACKUP_SYNC_IDLE_DELAY_MS = 60_000;
const BACKUP_SYNC_MAX_DELAY_MS = 5 * 60_000;

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

function isImeComposingEvent(e: React.KeyboardEvent<HTMLInputElement>): boolean {
  const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
  return Boolean(e.isComposing || nativeEvent.isComposing || nativeEvent.keyCode === 229);
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

function getRecentCutoffMs(days = 7): number {
  const today = formatDateYYYYMMDD(new Date());
  return addDays(new Date(`${today}T00:00:00`), -(days - 1)).getTime();
}

function isRecentProjectTask(task: ProjectTask, days = 7): boolean {
  const cutoff = getRecentCutoffMs(days);
  const doneAtMs = Number(task.completedAtMs || task.updatedAtMs || task.createdAtMs || 0);
  return doneAtMs >= cutoff;
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
  const [draft, setDraft] = useState<DraftPost | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("todo");
  const [projects, setProjects] = useState<ActaProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTaskTitle, setNewProjectTaskTitle] = useState("");
  const [editingProjectKnowledge, setEditingProjectKnowledge] = useState<ActaEntry | null>(null);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [editingProjectTaskId, setEditingProjectTaskId] = useState("");
  const [projectTaskTitleDraft, setProjectTaskTitleDraft] = useState("");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectIssueUrlDraft, setProjectIssueUrlDraft] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [todoStatus, setTodoStatus] = useState("");
  const [todoWeekOffset, setTodoWeekOffset] = useState(0);
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
  const [githubSyncBusy, setGithubSyncBusy] = useState(false);
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
  const backupSyncTimerRef = useRef<number | null>(null);
  const backupSyncFirstQueuedAtRef = useRef<number | null>(null);
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

  function runQueuedBackupSync() {
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

  function queueBackupSync(options?: { immediate?: boolean }) {
    if (!api) return;

    if (backupSyncTimerRef.current !== null) {
      window.clearTimeout(backupSyncTimerRef.current);
      backupSyncTimerRef.current = null;
    }

    if (options?.immediate) {
      backupSyncFirstQueuedAtRef.current = null;
      runQueuedBackupSync();
      return;
    }

    const now = Date.now();
    const firstQueuedAt = backupSyncFirstQueuedAtRef.current ?? now;
    backupSyncFirstQueuedAtRef.current = firstQueuedAt;
    const remainingUntilMaxDelay = Math.max(0, BACKUP_SYNC_MAX_DELAY_MS - (now - firstQueuedAt));
    const delay = Math.min(BACKUP_SYNC_IDLE_DELAY_MS, remainingUntilMaxDelay);

    backupSyncTimerRef.current = window.setTimeout(() => {
      backupSyncTimerRef.current = null;
      backupSyncFirstQueuedAtRef.current = null;
      runQueuedBackupSync();
    }, delay);
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

  async function reloadProjects(nextSelectedId?: string) {
    if (!api) return;
    const list = await api.listProjects();
    setProjects(list);
    const preferredId = nextSelectedId || selectedProjectId;
    const filtered = list.filter((project) => Boolean(project.archivedAtMs) === showArchivedProjects);
    const selected = filtered.find((project) => project.id === preferredId) || filtered[0] || null;
    setSelectedProjectId(selected?.id ?? "");
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
          const [list, projectList] = await Promise.all([api.listEntries(), api.listProjects()]);
          if (cancelled) return;
          setEntries(list);
          setProjects(projectList);
          const firstProject = projectList[0] || null;
          setSelectedProjectId(firstProject?.id ?? "");
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
    setEditingProjectKnowledge(null);
    setEditingProjectTaskId("");
    setProjectTaskTitleDraft("");
    const selected = projects.find((project) => project.id === selectedProjectId);
    setProjectNameDraft(selected?.name ?? "");
    setProjectIssueUrlDraft(selected?.issueUrl ?? "");
  }, [projects, selectedProjectId]);

  useEffect(() => {
    const filtered = projects.filter((project) => Boolean(project.archivedAtMs) === showArchivedProjects);
    if (filtered.some((project) => project.id === selectedProjectId)) return;
    setSelectedProjectId(filtered[0]?.id ?? "");
  }, [projects, selectedProjectId, showArchivedProjects]);

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
      if (backupSyncTimerRef.current !== null) {
        window.clearTimeout(backupSyncTimerRef.current);
      }
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

  const todoWeekRange = useMemo(() => {
    const today = formatDateYYYYMMDD(new Date());
    const endDate = addDays(new Date(`${today}T00:00:00`), todoWeekOffset * 7);
    const startDate = addDays(endDate, -6);
    return {
      start: formatDateYYYYMMDD(startDate),
      end: formatDateYYYYMMDD(endDate)
    };
  }, [todoWeekOffset]);

  const todoEntries = useMemo(() => {
    return entries.filter(
      (entry) =>
        entry.date >= todoWeekRange.start &&
        entry.date <= todoWeekRange.end &&
        (entry.tags.includes("ToDo") || /^#\s*todo\b/im.test(entry.body))
    );
  }, [entries, todoWeekRange]);
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const visibleProjects = useMemo(
    () => projects.filter((project) => Boolean(project.archivedAtMs) === showArchivedProjects),
    [projects, showArchivedProjects]
  );
  const selectedProjectKnowledgeEntries = useMemo(
    () => (selectedProject ? sortEntriesNewestFirst(selectedProject.knowledgeEntries) : []),
    [selectedProject]
  );
  const activeProjectCount = useMemo(
    () => projects.filter((project) => !project.archivedAtMs).length,
    [projects]
  );
  const activeProjectTaskCount = useMemo(
    () =>
      projects.reduce(
        (count, project) =>
          project.archivedAtMs
            ? count
            : count + project.tasks.filter((task) => task.status === "InProgress" || task.status === "GitHub").length,
        0
      ),
    [projects]
  );

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

  async function createTodoFromProjects() {
    setTodoStatus("");
    try {
      const entry = await api.createTodoFromProjects();
      setTodoWeekOffset(0);
      await reload();
      queueBackupSync();
      setTodoStatus(`${entry.date} のToDoを作成しました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTodoStatus(msg || "ToDo作成に失敗しました");
    }
  }

  async function copyPreviousTodo() {
    setTodoStatus("");
    try {
      const entry = await api.copyPreviousTodo();
      setTodoWeekOffset(0);
      await reload();
      queueBackupSync();
      setTodoStatus(`${entry.date} に前回のToDoをコピーしました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTodoStatus(msg || "前回ToDoのコピーに失敗しました");
    }
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    setProjectStatus("");
    try {
      const project = await api.createProject({ name });
      setNewProjectName("");
      await reloadProjects(project.id);
      queueBackupSync();
      setProjectStatus(`${project.name} を作成しました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "プロジェクト作成に失敗しました");
    }
  }

  async function syncGitHubItems() {
    if (githubSyncBusy) return;
    setGithubSyncBusy(true);
    setProjectStatus("");
    try {
      const result = await api.syncGitHubItems();
      await reloadProjects(selectedProjectId);
      await reload();
      queueBackupSync();
      setProjectStatus(`GitHub同期: ${result.detail}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "GitHubのIssue・PR同期に失敗しました");
    } finally {
      setGithubSyncBusy(false);
    }
  }

  async function addProjectTask() {
    if (!selectedProject) return;
    const title = newProjectTaskTitle.trim();
    if (!title) return;
    setProjectStatus("");
    try {
      await api.addProjectTask({ projectId: selectedProject.id, title, status: "Backlog" });
      setNewProjectTaskTitle("");
      await reloadProjects(selectedProject.id);
      queueBackupSync();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "タスク追加に失敗しました");
    }
  }

  async function moveProjectTask(taskId: string, status: ProjectTaskStatus) {
    if (!selectedProject) return;
    const task = selectedProject.tasks.find((item) => item.id === taskId);
    if (task?.status === status) return;
    setProjectStatus("");
    try {
      await api.moveProjectTask({ projectId: selectedProject.id, taskId, status });
      await reloadProjects(selectedProject.id);
      await reload();
      queueBackupSync();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "タスク移動に失敗しました");
    }
  }

  async function reassignProjectTask(taskId: string, targetProjectId: string) {
    if (!selectedProject || targetProjectId === selectedProject.id) return;
    setProjectStatus("");
    try {
      await api.reassignProjectTask({
        sourceProjectId: selectedProject.id,
        targetProjectId,
        taskId
      });
      await reloadProjects(selectedProject.id);
      queueBackupSync();
      const target = projects.find((project) => project.id === targetProjectId);
      setProjectStatus(`${target?.name || "移動先"}へ移動しました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "タスクのプロジェクト移動に失敗しました");
    }
  }

  function dropProjectTask(status: ProjectTaskStatus) {
    const taskId = draggingTaskId.trim();
    setDraggingTaskId("");
    if (!taskId) return;
    void moveProjectTask(taskId, status);
  }

  function startProjectTaskEdit(taskId: string, title: string) {
    setEditingProjectTaskId(taskId);
    setProjectTaskTitleDraft(title);
  }

  async function renameProjectTask(taskId: string) {
    if (!selectedProject) return;
    const title = projectTaskTitleDraft.trim();
    const current = selectedProject.tasks.find((task) => task.id === taskId);
    if (!title || title === current?.title) {
      setEditingProjectTaskId("");
      setProjectTaskTitleDraft("");
      return;
    }
    setProjectStatus("");
    try {
      await api.renameProjectTask({ projectId: selectedProject.id, taskId, title });
      setEditingProjectTaskId("");
      setProjectTaskTitleDraft("");
      await reloadProjects(selectedProject.id);
      queueBackupSync();
      setProjectStatus("タスク名を変更しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "タスク名の変更に失敗しました");
    }
  }

  async function deleteProjectTask(taskId: string, title: string) {
    if (!selectedProject) return;
    const ok = window.confirm(`タスク「${title}」を削除しますか？`);
    if (!ok) return;
    setProjectStatus("");
    try {
      await api.deleteProjectTask({ projectId: selectedProject.id, taskId });
      if (editingProjectTaskId === taskId) {
        setEditingProjectTaskId("");
        setProjectTaskTitleDraft("");
      }
      await reloadProjects(selectedProject.id);
      queueBackupSync();
      setProjectStatus("タスクを削除しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "タスク削除に失敗しました");
    }
  }

  async function saveProjectKnowledge(body: string) {
    if (!selectedProject) return;
    setProjectStatus("");
    try {
      if (editingProjectKnowledge) {
        await api.updateProjectKnowledgeEntry({
          projectId: selectedProject.id,
          entryId: editingProjectKnowledge.id,
          body
        });
        setEditingProjectKnowledge(null);
      } else {
        await api.addProjectKnowledgeEntry({ projectId: selectedProject.id, body });
      }
      await reloadProjects(selectedProject.id);
      queueBackupSync();
      setProjectStatus("ナレッジを保存しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "ナレッジ保存に失敗しました");
    }
  }

  async function deleteProjectKnowledge(entry: ActaEntry) {
    if (!selectedProject) return;
    const ok = window.confirm("このナレッジ投稿を削除しますか？");
    if (!ok) return;
    setProjectStatus("");
    try {
      await api.deleteProjectKnowledgeEntry({ projectId: selectedProject.id, entryId: entry.id });
      if (editingProjectKnowledge?.id === entry.id) setEditingProjectKnowledge(null);
      await reloadProjects(selectedProject.id);
      queueBackupSync();
      setProjectStatus("ナレッジを削除しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "ナレッジ削除に失敗しました");
    }
  }

  async function setProjectArchived(archived: boolean) {
    if (!selectedProject) return;
    setProjectStatus("");
    try {
      await api.setProjectArchived({ projectId: selectedProject.id, archived });
      await reloadProjects(selectedProject.id);
      queueBackupSync();
      setProjectStatus(archived ? "プロジェクトをアーカイブしました" : "アーカイブを解除しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "アーカイブ状態の更新に失敗しました");
    }
  }

  async function renameSelectedProject() {
    if (!selectedProject) return;
    const trimmed = projectNameDraft.trim();
    if (!trimmed || trimmed === selectedProject.name) return;
    setProjectStatus("");
    try {
      const project = await api.renameProject({ projectId: selectedProject.id, name: trimmed });
      setActiveView("projects");
      setEditing(null);
      setDraft(null);
      setProjectNameDraft(project.name);
      setProjectIssueUrlDraft(project.issueUrl || "");
      await reload();
      await reloadProjects(project.id);
      queueBackupSync();
      setProjectStatus("プロジェクト名を変更しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "プロジェクト名の変更に失敗しました");
    }
  }

  async function deleteSelectedProject() {
    if (!selectedProject) return;
    const ok = window.confirm(`プロジェクト「${selectedProject.name}」を削除しますか？\nタスクとナレッジも削除されます。`);
    if (!ok) return;
    setProjectStatus("");
    try {
      const res = await api.deleteProject({ projectId: selectedProject.id });
      if (!res?.deleted) throw new Error("削除対象が見つかりませんでした");
      setEditingProjectKnowledge(null);
      await reloadProjects();
      queueBackupSync();
      setProjectStatus("プロジェクトを削除しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "プロジェクト削除に失敗しました");
    }
  }

  async function editProjectIssueUrl() {
    if (!selectedProject) return;
    const issueUrl = projectIssueUrlDraft.trim();
    if (issueUrl === (selectedProject.issueUrl || "")) return;
    setProjectStatus("");
    try {
      const project = await api.setProjectIssueUrl({ projectId: selectedProject.id, issueUrl });
      await reloadProjects(project.id);
      queueBackupSync();
      setProjectStatus(project.issueUrl ? "issueリンクを保存しました" : "issueリンクを解除しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "issueリンクの保存に失敗しました");
    }
  }

  async function appendProjectTasksToTodo() {
    if (!selectedProject) return;
    setProjectStatus("");
    try {
      const entry = await api.appendProjectInProgressToTodayTodo({ projectId: selectedProject.id });
      await reload();
      queueBackupSync();
      setProjectStatus(`${entry.date} のToDoにInProgress / GitHubを追記しました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "ToDoへの追記に失敗しました");
    }
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
          activeView={activeView}
          selectedTags={selectedTags}
          untaggedOnly={untaggedOnly}
          totalCount={entries.length}
          todoCount={todoEntries.length}
          activeProjectCount={activeProjectCount}
          activeProjectTaskCount={activeProjectTaskCount}
          tagStats={tagStats}
          untaggedCount={untaggedCount}
          selectedProjectName={selectedProject?.name ?? ""}
          onChangeView={(view) => setActiveView(view)}
          onToggleTag={toggleTagFilter}
          onSelectAll={clearTagFilter}
          onToggleUntagged={toggleUntaggedFilter}
        />
      </aside>

      <main className="main">
        {activeView === "journal" ? (
          <header className="topbar topbarJournal">
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
          </header>
        ) : null}

        {activeView === "todo" ? (
          <section className="todoArea">
            <div className="todoToolbar">
              <button className="primaryActionBtn" type="button" onClick={() => void createTodoFromProjects()}>
                新規ToDo
              </button>
              <button className="ghostBtn" type="button" onClick={() => void copyPreviousTodo()}>
                昨日のToDoコピー
              </button>
              <div className="todoWeekNav">
                <button className="ghostBtn" type="button" onClick={() => setTodoWeekOffset((value) => value - 1)}>
                  前週
                </button>
                <span className="todoWeekLabel">
                  {todoWeekRange.start} - {todoWeekRange.end}
                </span>
                <button
                  className="ghostBtn"
                  type="button"
                  disabled={todoWeekOffset >= 0}
                  onClick={() => setTodoWeekOffset((value) => Math.min(0, value + 1))}
                >
                  次週
                </button>
                <button
                  className="ghostBtn"
                  type="button"
                  disabled={todoWeekOffset === 0}
                  onClick={() => setTodoWeekOffset(0)}
                >
                  今週
                </button>
              </div>
              <div className="knowledgeStatus">
                {todoStatus || "新規ToDoは全プロジェクトのInProgress / GitHubから作成します。"}
              </div>
            </div>
            <div className="commentList">
              {loading ? (
                <div className="empty">読み込み中...</div>
              ) : todoEntries.length === 0 ? (
                <div className="empty">ToDoはまだありません</div>
              ) : (
                todoEntries.map((e) => (
                  <CommentCard
                    key={e.id}
                    entry={e}
                    assetBaseUrl={assetBaseUrl}
                    domId={buildEntryDomId(e.id)}
                    isLinkedTarget={linkedTargetEntryId === e.id}
                    onEdit={(entry) => {
                      setActiveView("journal");
                      setEditing(entry);
                      setDraft(null);
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
                      const res = await api.updateEntry({ id: entry.id, body: nextBody, tags: entry.tags });
                      if (!res?.updated) throw new Error("更新対象が見つかりませんでした");
                      await reload();
                      queueBackupSync();
                    }}
                    onDelete={async (entry) => {
                      const ok = window.confirm("このToDoを削除しますか？");
                      if (!ok) return;

                      let deleted = false;
                      try {
                        const res = await api.deleteEntry({ id: entry.id });
                        if (!res?.deleted) {
                          setTodoStatus("削除対象が見つかりませんでした");
                        } else {
                          deleted = true;
                          setTodoStatus("ToDoを削除しました");
                        }
                        await reload();
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        setTodoStatus(msg || "削除に失敗しました");
                      }
                      if (deleted) queueBackupSync();
                    }}
                  />
                ))
              )}
            </div>
          </section>
        ) : null}

        {activeView === "projects" ? (
          <section className="projectsArea">
            <aside className="projectList">
              <div className="projectCreate">
                <input
                  className="projectInput"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (isImeComposingEvent(e)) return;
                    if (e.key === "Enter") void createProject();
                  }}
                  placeholder="新規プロジェクト名"
                />
                <button className="primaryActionBtn" type="button" onClick={() => void createProject()}>
                  作成
                </button>
                <button
                  className="ghostBtn"
                  type="button"
                  disabled={githubSyncBusy}
                  onClick={() => void syncGitHubItems()}
                  title="自分が作成したGitHub Issue・PRを同期"
                >
                  {githubSyncBusy ? "同期中..." : "GitHub同期"}
                </button>
              </div>
              <div className="projectArchiveToggle">
                <button
                  className={`viewTab ${!showArchivedProjects ? "isActive" : ""}`}
                  type="button"
                  onClick={() => setShowArchivedProjects(false)}
                >
                  Active
                </button>
                <button
                  className={`viewTab ${showArchivedProjects ? "isActive" : ""}`}
                  type="button"
                  onClick={() => setShowArchivedProjects(true)}
                >
                  Archive
                </button>
              </div>
              <div className="projectNav">
                {visibleProjects.length === 0 ? (
                  <div className="empty">
                    {showArchivedProjects ? "アーカイブ済みプロジェクトはありません" : "プロジェクトはまだありません"}
                  </div>
                ) : (
                  visibleProjects.map((project) => (
                    <button
                      className={`projectNavItem ${selectedProjectId === project.id ? "isActive" : ""}`}
                      key={project.id}
                      type="button"
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <span>{project.name}</span>
                      <small>
                        {project.archivedAtMs
                          ? "archived"
                          : `${
                              project.tasks.filter((task) => task.status === "InProgress" || task.status === "GitHub")
                                .length
                            } active`}
                      </small>
                    </button>
                  ))
                )}
              </div>
            </aside>
            <div className="projectDetail">
              {selectedProject ? (
                <>
                  <div className="projectHeader">
                    <div>
                      <h2>
                        {selectedProject.name}
                        {selectedProject.archivedAtMs ? <span className="projectArchivedBadge">Archived</span> : null}
                      </h2>
                      <div className="knowledgeStatus">{projectStatus || selectedProject.sourceDir}</div>
                      <div className="projectInlineEditors">
                        <label className="projectInlineField">
                          <span>プロジェクト名</span>
                          <input
                            className="projectInlineInput"
                            value={projectNameDraft}
                            onChange={(e) => setProjectNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (isImeComposingEvent(e)) return;
                              if (e.key === "Enter") void renameSelectedProject();
                            }}
                          />
                        </label>
                        <button
                          className="ghostBtn"
                          type="button"
                          disabled={!projectNameDraft.trim() || projectNameDraft.trim() === selectedProject.name}
                          onClick={() => void renameSelectedProject()}
                        >
                          名前を保存
                        </button>
                        <label className="projectInlineField isWide">
                          <span>issueリンク</span>
                          <input
                            className="projectInlineInput"
                            value={projectIssueUrlDraft}
                            onChange={(e) => setProjectIssueUrlDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (isImeComposingEvent(e)) return;
                              if (e.key === "Enter") void editProjectIssueUrl();
                            }}
                            placeholder="https://..."
                          />
                        </label>
                        <button
                          className="ghostBtn"
                          type="button"
                          disabled={projectIssueUrlDraft.trim() === (selectedProject.issueUrl || "")}
                          onClick={() => void editProjectIssueUrl()}
                        >
                          リンクを保存
                        </button>
                      </div>
                    </div>
                    <div className="projectHeaderActions">
                      {selectedProject.issueUrl ? (
                        <a
                          className="ghostLinkBtn"
                          href={selectedProject.issueUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={selectedProject.issueUrl}
                        >
                          Issueを開く
                        </a>
                      ) : null}
                      <button
                        className="ghostBtn"
                        type="button"
                        disabled={Boolean(selectedProject.archivedAtMs)}
                        onClick={() => void appendProjectTasksToTodo()}
                      >
                        InProgress / GitHubをToDoへ追記
                      </button>
                      <button
                        className={selectedProject.archivedAtMs ? "ghostBtn" : "dangerGhostBtn"}
                        type="button"
                        onClick={() => void setProjectArchived(!selectedProject.archivedAtMs)}
                      >
                        {selectedProject.archivedAtMs ? "アーカイブ解除" : "アーカイブ"}
                      </button>
                      <button className="dangerGhostBtn" type="button" onClick={() => void deleteSelectedProject()}>
                        削除
                      </button>
                    </div>
                  </div>
                  <div className="projectTaskCreate">
                    <input
                      className="projectInput"
                      value={newProjectTaskTitle}
                      onChange={(e) => setNewProjectTaskTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (isImeComposingEvent(e)) return;
                        if (e.key === "Enter") void addProjectTask();
                      }}
                      placeholder="Backlogへタスク追加"
                    />
                    <button className="primaryActionBtn" type="button" onClick={() => void addProjectTask()}>
                      追加
                    </button>
                  </div>
                  <div className="kanbanBoard">
                    {(["Backlog", "InProgress", "GitHub", "Done"] as const).map((status) => {
                      const visibleTasks = selectedProject.tasks.filter(
                        (task) => task.status === status && (status !== "Done" || isRecentProjectTask(task))
                      );
                      return (
                        <section
                          className={`kanbanColumn ${draggingTaskId ? "isDropReady" : ""}`}
                          key={status}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            dropProjectTask(status);
                          }}
                        >
                          <h3>{status}</h3>
                          {visibleTasks.length === 0 ? (
                            <div className="kanbanEmpty">空</div>
                          ) : (
                            visibleTasks.map((task) => (
                              <div
                                className={`kanbanCard ${draggingTaskId === task.id ? "isDragging" : ""}`}
                                key={task.id}
                                draggable={editingProjectTaskId !== task.id}
                                onDragStart={(e) => {
                                  setDraggingTaskId(task.id);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", task.id);
                                }}
                                onDragEnd={() => setDraggingTaskId("")}
                              >
                                {editingProjectTaskId === task.id ? (
                                  <div className="kanbanEdit">
                                    <input
                                      className="kanbanEditInput"
                                      value={projectTaskTitleDraft}
                                      autoFocus
                                      onChange={(e) => setProjectTaskTitleDraft(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (isImeComposingEvent(e)) return;
                                        if (e.key === "Enter") void renameProjectTask(task.id);
                                        if (e.key === "Escape") {
                                          setEditingProjectTaskId("");
                                          setProjectTaskTitleDraft("");
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      onDragStart={(e) => e.preventDefault()}
                                    />
                                    <div className="kanbanEditActions">
                                      <button
                                        className="ghostBtn"
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void renameProjectTask(task.id);
                                        }}
                                      >
                                        保存
                                      </button>
                                      <button
                                        className="ghostBtn"
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setEditingProjectTaskId("");
                                          setProjectTaskTitleDraft("");
                                        }}
                                      >
                                        キャンセル
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div>{task.title}</div>
                                    {task.source === "github" ? (
                                      <div className="kanbanSourceMeta">
                                        <span>{task.sourceType === "PullRequest" ? "PR" : task.sourceType === "Issue" ? "Issue" : "Task"}</span>
                                        {task.sourceUrl ? (
                                          <a href={task.sourceUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                            GitHubで開く
                                          </a>
                                        ) : null}
                                        <select
                                          className="kanbanProjectSelect"
                                          value={selectedProject.id}
                                          aria-label="Actaプロジェクト"
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) => {
                                            e.stopPropagation();
                                            void reassignProjectTask(task.id, e.target.value);
                                          }}
                                        >
                                          {projects
                                            .filter((project) => !project.archivedAtMs)
                                            .map((project) => (
                                              <option key={project.id} value={project.id}>
                                                {project.name}
                                              </option>
                                            ))}
                                        </select>
                                      </div>
                                    ) : null}
                                    <div className="kanbanCardActions">
                                      {task.source !== "github" ? (
                                        <>
                                          <button
                                            className="ghostBtn"
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startProjectTaskEdit(task.id, task.title);
                                            }}
                                          >
                                            編集
                                          </button>
                                          <button
                                            className="dangerGhostBtn"
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void deleteProjectTask(task.id, task.title);
                                            }}
                                          >
                                            削除
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
                                  </>
                                )}
                              </div>
                            ))
                          )}
                        </section>
                      );
                    })}
                  </div>
                  <div className="projectKnowledge">
                    <h3>ナレッジ</h3>
                    <Composer
                      assetBaseUrl={assetBaseUrl}
                      tagSuggestions={[]}
                      popularTagSuggestions={[]}
                      mode={editingProjectKnowledge ? "edit" : "create"}
                      draftKey={editingProjectKnowledge?.id ?? `project:${selectedProject.id}`}
                      initialBody={editingProjectKnowledge?.body ?? ""}
                      initialTags={[]}
                      autoFocusEditor={Boolean(editingProjectKnowledge)}
                      onCancel={() => setEditingProjectKnowledge(null)}
                      onSubmit={async (body) => {
                        await saveProjectKnowledge(body);
                      }}
                    />
                    <div className="projectKnowledgeList">
                      {selectedProjectKnowledgeEntries.length === 0 ? (
                        <div className="empty">ナレッジ投稿はまだありません</div>
                      ) : (
                        selectedProjectKnowledgeEntries.map((entry) => (
                          <CommentCard
                            key={entry.id}
                            entry={entry}
                            assetBaseUrl={assetBaseUrl}
                            onEdit={(item) => setEditingProjectKnowledge(item)}
                            onCopyId={(item) => {
                              void copyEntryId(item);
                            }}
                            onDelete={(item) => void deleteProjectKnowledge(item)}
                          />
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty">左側でプロジェクトを作成してください</div>
              )}
            </div>
          </section>
        ) : null}

        {activeView === "journal" ? (
          <>
            <section className="composerArea">
              {appError ? <div className="appError">{appError}</div> : null}
              <Composer
                assetBaseUrl={assetBaseUrl}
                tagSuggestions={tagSuggestions}
                popularTagSuggestions={popularTagSuggestions}
                mode={editing ? "edit" : draft?.source ? "copy" : "create"}
                draftKey={editing?.id ?? draft?.key ?? "create"}
                initialBody={editing?.body ?? draft?.body ?? ""}
                initialTags={editing?.tags ?? draft?.tags ?? []}
                source={editing ? { id: editing.id, date: editing.date } : draft?.source}
                autoFocusEditor={Boolean(editing || draft)}
                onCancel={() => {
                  setEditing(null);
                  setDraft(null);
                }}
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
                        setDraft({
                          key: `copy:${entry.id}:${Date.now()}`,
                          body: entry.body,
                          tags: entry.tags,
                          source: { id: entry.id, date: entry.date }
                        });
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
        onClick={() => queueBackupSync({ immediate: true })}
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
