import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActaSettings,
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
import { CommentCard } from "./components/CommentCard";
import { Composer } from "./components/Composer";
import { SettingsModal } from "./components/SettingsModal";
import { TagSidebar } from "./components/TagSidebar";
import { installDragScroll } from "./lib/dragScroll";
import { setTaskStateOnLine, summarizeTaskStates, type TaskState } from "./lib/taskList";

type TagStat = { tag: string; count: number };
type DateFilterMode = "week" | "day" | "all";
type ActiveView = "workspace" | "journal" | "knowledge";

const TODO_RAIL_STORAGE_KEY = "acta.todoRailOpen";
const PROJECT_TODO_HEIGHT_STORAGE_KEY = "acta.projectTodoHeight";
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

function makeEntryTitle(text: string): string {
  const firstLine = String(text ?? "")
    .split(/\r?\n/g)
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, "").trim())
    .find(Boolean);
  return firstLine || "無題のナレッジ";
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

function isTodoEntry(entry: ActaEntry): boolean {
  return entry.tags.includes("ToDo") || /^#\s*todo\b/im.test(entry.body);
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
  const [activeView, setActiveView] = useState<ActiveView>("workspace");
  const [projects, setProjects] = useState<ActaProject[]>([]);
  const [dragProjectId, setDragProjectId] = useState("");
  const [dropTargetProjectId, setDropTargetProjectId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectTaskTitle, setNewProjectTaskTitle] = useState("");
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [editingProjectTaskId, setEditingProjectTaskId] = useState("");
  const [projectTaskTitleDraft, setProjectTaskTitleDraft] = useState("");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectIssueUrlDraft, setProjectIssueUrlDraft] = useState("");
  const [projectStatus, setProjectStatus] = useState("");
  const [projectMetaOpen, setProjectMetaOpen] = useState(false);
  const [projectTodoBusy, setProjectTodoBusy] = useState(false);
  const [todoStatus, setTodoStatus] = useState("");
  const [todoBusy, setTodoBusy] = useState(false);
  const [todoWeekOffset, setTodoWeekOffset] = useState(0);
  // ToDoレールの開閉。狭いウィンドウでカンバンを広く使えるように閉じられる。
  const [todoRailOpen, setTodoRailOpen] = useState<boolean>(
    () => window.localStorage.getItem(TODO_RAIL_STORAGE_KEY) !== "closed"
  );
  const [projectTodoHeight, setProjectTodoHeight] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem(PROJECT_TODO_HEIGHT_STORAGE_KEY));
    return Number.isFinite(stored) && stored >= 260 && stored <= 600 ? stored : 340;
  });
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeExcludeTags, setKnowledgeExcludeTags] = useState("");
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeSearchResultItem[]>([]);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeStatus, setKnowledgeStatus] = useState("");
  const [knowledgeIndex, setKnowledgeIndex] = useState<KnowledgeIndexResult | null>(null);
  const [knowledgeSite, setKnowledgeSite] = useState<KnowledgeSiteResult | null>(null);
  const [settings, setSettings] = useState<ActaSettings>({ theme: "default" });
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
  const todoRailRef = useRef<HTMLDivElement>(null);
  const workspaceAreaRef = useRef<HTMLElement>(null);
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

  // 追加直後に一覧へ差し込み、再読込を待たずに表示する。
  function mergeEntry(entry: ActaEntry | null | undefined) {
    if (!entry?.id) return;
    setEntries((prev) => sortEntriesNewestFirst([entry, ...prev.filter((e) => e.id !== entry.id)]));
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
        const [dirRes, settingsRes] = await Promise.allSettled([api.getDataDir(), api.getSettings()]);
        if (cancelled) return;

        if (dirRes.status === "fulfilled") {
          setDataDir(dirRes.value);
        } else {
          setDataDir("");
        }

        if (settingsRes.status === "fulfilled") {
          setSettings({ theme: normalizeTheme(settingsRes.value.theme) });
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

      if (cancelled) return;
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
        if (syncRes.ok) {
          const [list, projectList] = await Promise.all([api.listEntries(), api.listProjects()]);
          if (cancelled) return;
          setEntries(list);
          setProjects(projectList);
          setSelectedProjectId((current) =>
            projectList.some((project) => project.id === current) ? current : projectList[0]?.id ?? ""
          );
        }
      } catch (err) {
        if (cancelled) return;
        applySyncError(err);
      } finally {
        if (!cancelled) setSyncBusy(false);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [api]);

  // データフォルダが外部（CLI/git）から更新されたら黙って読み直す。
  const refreshFromDiskRef = useRef<() => void>(() => {});
  refreshFromDiskRef.current = () => {
    if (!api || loading) return;
    void (async () => {
      try {
        const [list, projectList] = await Promise.all([api.listEntries(), api.listProjects()]);
        setEntries(list);
        setProjects(projectList);
      } catch {
        // 監視由来の再読込は失敗しても既存表示を保つ。
      }
    })();
  };

  useEffect(() => {
    if (!api?.onDataChanged) return;
    return api.onDataChanged(() => refreshFromDiskRef.current());
  }, [api]);

  useEffect(() => {
    try {
      localStorage.setItem("acta:limit", String(limit));
    } catch {
      // ignore
    }
  }, [limit]);

  useEffect(() => {
    window.localStorage.setItem(TODO_RAIL_STORAGE_KEY, todoRailOpen ? "open" : "closed");
  }, [todoRailOpen]);

  useEffect(() => {
    window.localStorage.setItem(PROJECT_TODO_HEIGHT_STORAGE_KEY, String(projectTodoHeight));
  }, [projectTodoHeight]);

  useEffect(() => {
    const nextTheme = normalizeTheme(settings.theme);
    document.documentElement.setAttribute("data-acta-theme", nextTheme);
  }, [settings.theme]);

  useEffect(() => {
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
    if (!todoStatus) return;
    const timer = window.setTimeout(() => setTodoStatus(""), 6000);
    return () => window.clearTimeout(timer);
  }, [todoStatus]);

  useEffect(() => {
    if (!projectStatus) return;
    const timer = window.setTimeout(() => setProjectStatus(""), 6000);
    return () => window.clearTimeout(timer);
  }, [projectStatus]);

  useEffect(() => {
    const VIEW_ORDER: ActiveView[] = ["workspace", "journal", "knowledge"];

    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && /^[1-4]$/.test(key)) {
        const next = VIEW_ORDER[Number(key) - 1];
        if (next) {
          e.preventDefault();
          setActiveView(next);
        }
        return;
      }
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
    if (todoRailRef.current) cleanups.push(installDragScroll(todoRailRef.current, { axis: "y" }));
    return () => {
      for (const fn of cleanups) fn();
    };
    // ビュー切り替えで対象要素が入れ替わるため再インストールする。
  }, [activeView, todoRailOpen]);

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
      (entry) => entry.date >= todoWeekRange.start && entry.date <= todoWeekRange.end && isTodoEntry(entry)
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
            : count + project.tasks.filter((task) => task.status === "InProgress").length,
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
    setEditing(target);
    setDraft(null);
    setQuery("");
    setDateFilter("");
    setDateFilterMode("all");
    clearTagFilter();
    setAppError("");
  }

  async function deleteEditingEntry(entry: ActaEntry) {
    const ok = window.confirm(`「${makeEntryTitle(entry.body)}」を削除しますか？`);
    if (!ok) return;
    try {
      const res = await api.deleteEntry({ id: entry.id });
      if (!res?.deleted) throw new Error("削除対象が見つかりませんでした");
      setEditing(null);
      setDraft(null);
      setAppError("");
      await reload();
      queueBackupSync();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAppError(msg || "削除に失敗しました");
    }
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

  /** サイドの一覧をドラッグ&ドロップで並べ替える。並び順は設定に保存し、ToDo追記の順序にも使われる。 */
  async function reorderProjects(dragId: string, targetId: string) {
    if (!dragId || !targetId || dragId === targetId) return;

    const from = projects.findIndex((project) => project.id === dragId);
    const to = projects.findIndex((project) => project.id === targetId);
    if (from < 0 || to < 0) return;

    const next = [...projects];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setProjects(next);

    try {
      await api.setProjectOrder({ projectIds: next.map((project) => project.id) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "並び順の保存に失敗しました");
      await reload();
    }
  }

  /** 投稿本文をMarkdownのままクリップボードへ。 */
  async function copyEntryMarkdown(entry: ActaEntry, notify?: (message: string) => void) {
    const markdown = String(entry.body ?? "").trim();
    const copied = await copyTextToClipboard(markdown);
    if (!copied) {
      const message = "Markdownのコピーに失敗しました";
      if (notify) notify(message);
      else setAppError(message);
      return;
    }
    if (notify) notify("Markdownをコピーしました");
    else setAppError("");
  }

  async function createTodoFromProjects() {
    if (todoBusy) return;
    const today = formatDateYYYYMMDD(new Date());
    if (entries.some((entry) => entry.date === today && isTodoEntry(entry))) {
      const ok = window.confirm("今日のToDoはすでにあります。もう1件作成しますか？");
      if (!ok) return;
    }

    setTodoStatus("");
    setTodoBusy(true);
    try {
      const entry = await api.createTodoFromProjects();
      setTodoWeekOffset(0);
      mergeEntry(entry);
      await reload();
      queueBackupSync();
      setTodoStatus(`${entry.date} のToDoを作成しました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTodoStatus(msg || "ToDo作成に失敗しました");
    } finally {
      setTodoBusy(false);
    }
  }

  async function copyPreviousTodo() {
    if (todoBusy) return;
    setTodoStatus("");
    setTodoBusy(true);
    try {
      const entry = await api.copyPreviousTodo();
      setTodoWeekOffset(0);
      mergeEntry(entry);
      await reload();
      queueBackupSync();
      setTodoStatus(`${entry.date} に前回のToDoをコピーしました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTodoStatus(msg || "前回ToDoのコピーに失敗しました");
    } finally {
      setTodoBusy(false);
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
      // 削除はToDo本文にも反映されるので再読み込みする。
      await reload();
      queueBackupSync();
      setProjectStatus("タスクを削除しました");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProjectStatus(msg || "タスク削除に失敗しました");
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
      setActiveView("workspace");
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
    const ok = window.confirm(`プロジェクト「${selectedProject.name}」を削除しますか？\n関連データも削除されます。`);
    if (!ok) return;
    setProjectStatus("");
    try {
      const res = await api.deleteProject({ projectId: selectedProject.id });
      if (!res?.deleted) throw new Error("削除対象が見つかりませんでした");
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

  async function appendActiveProjectTasksToTodo() {
    setProjectStatus("");
    setProjectTodoBusy(true);
    try {
      const entry = await api.appendActiveProjectsInProgressToTodayTodo();
      setTodoWeekOffset(0);
      mergeEntry(entry);
      await reload();
      queueBackupSync();
      // 同一画面のToDoレールへ即反映されるので画面遷移は不要。
      setTodoRailOpen(true);
      setTodoStatus(`${entry.date} のToDoにActiveプロジェクトのInProgressを追記しました`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTodoStatus(msg || "ToDoへの追記に失敗しました");
    } finally {
      setProjectTodoBusy(false);
    }
  }

  function clampProjectTodoHeight(nextHeight: number): number {
    const containerHeight = workspaceAreaRef.current?.getBoundingClientRect().height ?? 720;
    const maxHeight = Math.max(260, containerHeight - 220);
    return Math.round(Math.min(maxHeight, Math.max(260, nextHeight)));
  }

  function beginProjectTodoResize(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const container = workspaceAreaRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const resize = (clientY: number) => setProjectTodoHeight(clampProjectTodoHeight(rect.bottom - clientY));
    const onPointerMove = (event: PointerEvent) => resize(event.clientY);
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("isResizingProjectTodo");
    };

    document.body.classList.add("isResizingProjectTodo");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    resize(e.clientY);
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
    <div
      className={`shell${activeView === "workspace" ? " isWide" : ""}${
        activeView === "journal" ? " isJournal" : ""
      }`}
    >
      <header className="appHeader" title="ドラッグしてウィンドウを移動">
        <nav className="appNav" aria-label="機能切り替え">
          {(
            [
              { view: "workspace", icon: "▦", label: "プロジェクト", count: activeProjectTaskCount, hint: "⌘1" },
              { view: "journal", icon: "◷", label: "ナレッジ", count: entries.length, hint: "⌘2" },
              { view: "knowledge", icon: "⌕", label: "検索", count: null, hint: "⌘3" }
            ] as const
          ).map((item) => (
            <button
              key={item.view}
              className={`appNavItem ${activeView === item.view ? "isActive" : ""}`}
              type="button"
              title={item.hint}
              onClick={() => setActiveView(item.view)}
            >
              <span className="appNavIcon">{item.icon}</span>
              <span className="appNavText">{item.label}</span>
              {item.count === null ? null : <span className="appNavCount">{item.count}</span>}
            </button>
          ))}
        </nav>
      </header>

      {activeView === "workspace" ? null : (
      <aside className={`sidebar dragScroll${activeView === "journal" ? " journalListSidebar" : ""}`} ref={sidebarRef}>
        {activeView === "journal" ? (
          <div className="journalListPanel">
            <div className="journalListHeader">
              <div>
                <div className="journalListEyebrow">KNOWLEDGE</div>
                <h2>ナレッジ一覧</h2>
              </div>
              <button
                className="journalNewButton"
                type="button"
                onClick={() => {
                  setEditing(null);
                  setDraft({ key: `new:${Date.now()}`, body: "", tags: [] });
                  setAppError("");
                }}
              >
                ＋ 新規
              </button>
            </div>

            <div className="journalListSearch">
              <input
                ref={searchRef}
                className="journalListSearchInput"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ナレッジを検索 (⌘F)"
              />
              {query ? (
                <button type="button" aria-label="検索をクリア" onClick={() => setQuery("")}>
                  ×
                </button>
              ) : null}
            </div>

            <div className="journalListFilters" role="group" aria-label="表示期間">
              <button
                className={dateFilterMode === "day" ? "isActive" : ""}
                type="button"
                onClick={() => {
                  setDateFilter(formatDateYYYYMMDD(new Date()));
                  setDateFilterMode("day");
                }}
              >
                今日
              </button>
              <button
                className={dateFilterMode === "week" ? "isActive" : ""}
                type="button"
                onClick={() => {
                  setDateFilter(formatDateYYYYMMDD(new Date()));
                  setDateFilterMode("week");
                }}
              >
                1週間
              </button>
              <button
                className={dateFilterMode === "all" ? "isActive" : ""}
                type="button"
                onClick={() => {
                  setDateFilter("");
                  setDateFilterMode("all");
                }}
              >
                すべて
              </button>
            </div>

            <div className="journalListCount">{filteredEntries.length}件</div>
            <div className="journalEntryList">
              {loading ? (
                <div className="journalListEmpty">読み込み中...</div>
              ) : filteredEntries.length === 0 ? (
                <div className="journalListEmpty">該当するナレッジがありません</div>
              ) : (
                filteredEntries.map((entry) => (
                  <button
                    className={`journalEntryItem${editing?.id === entry.id ? " isActive" : ""}`}
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setEditing(entry);
                      setDraft(null);
                      setAppError("");
                    }}
                  >
                    <span className="journalEntryItemHead">
                      <strong>{makeEntryTitle(entry.body)}</strong>
                      <time>{entry.date}</time>
                    </span>
                    <span className="journalEntryExcerpt">{makeExcerpt(entry.body, query, 96)}</span>
                    {entry.tags.length > 0 ? (
                      <span className="journalEntryTags">
                        {entry.tags.slice(0, 3).map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <TagSidebar
            selectedTags={selectedTags}
            untaggedOnly={untaggedOnly}
            totalCount={entries.length}
            activeProjectCount={activeProjectCount}
            activeProjectTaskCount={activeProjectTaskCount}
            tagStats={tagStats}
            untaggedCount={untaggedCount}
            selectedProjectName={selectedProject?.name ?? ""}
            onToggleTag={toggleTagFilter}
            onSelectAll={clearTagFilter}
            onToggleUntagged={toggleUntaggedFilter}
          />
        )}
      </aside>
      )}

      <main className={`main${activeView === "journal" ? " journalMain" : ""}`}>
        {activeView === "workspace" ? (
          <section
            className={`workspaceArea${todoRailOpen ? "" : " isRailCollapsed"}`}
            ref={workspaceAreaRef}
            style={{ "--projectTodoHeight": `${projectTodoHeight}px` } as React.CSSProperties}
          >
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
                        className={`projectNavItem ${selectedProjectId === project.id ? "isActive" : ""} ${
                          dragProjectId === project.id ? "isDragging" : ""
                        } ${dropTargetProjectId === project.id ? "isDropTarget" : ""}`}
                        key={project.id}
                        type="button"
                        draggable
                        title="ドラッグで並べ替え"
                        onClick={() => setSelectedProjectId(project.id)}
                        onDragStart={(e) => {
                          setDragProjectId(project.id);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", project.id);
                        }}
                        onDragOver={(e) => {
                          if (!dragProjectId || dragProjectId === project.id) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          setDropTargetProjectId(project.id);
                        }}
                        onDragLeave={() => {
                          setDropTargetProjectId((current) => (current === project.id ? "" : current));
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const dragId = dragProjectId || e.dataTransfer.getData("text/plain");
                          setDragProjectId("");
                          setDropTargetProjectId("");
                          void reorderProjects(dragId, project.id);
                        }}
                        onDragEnd={() => {
                          setDragProjectId("");
                          setDropTargetProjectId("");
                        }}
                      >
                        <span>{project.name}</span>
                        <small>
                          {project.archivedAtMs
                            ? "archived"
                            : `${
                                project.tasks.filter((task) => task.status === "InProgress").length
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
                        <div className="projectPath" title={selectedProject.sourceDir}>
                          {selectedProject.sourceDir}
                        </div>
                        {projectMetaOpen ? (
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
                        ) : null}
                      </div>
                      <div className="projectHeaderActions">
                        <button
                          className={`ghostBtn${projectMetaOpen ? " isActive" : ""}`}
                          type="button"
                          title="プロジェクト名・issueリンクを編集"
                          onClick={() => setProjectMetaOpen((value) => !value)}
                        >
                          {projectMetaOpen ? "設定を閉じる" : "設定"}
                        </button>
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
                      <button
                        className="primaryActionBtn"
                        type="button"
                        disabled={!newProjectTaskTitle.trim()}
                        onClick={() => void addProjectTask()}
                      >
                        追加
                      </button>
                    </div>
                    {projectStatus ? <div className="inlineToast">{projectStatus}</div> : null}
                    <div className="kanbanBoard">
                      {(["Backlog", "InProgress", "Done"] as const).map((status) => {
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
                            <h3>
                              <span>{status}</span>
                              <span className="kanbanCount">{visibleTasks.length}</span>
                            </h3>
                            {visibleTasks.length === 0 ? (
                              <div className="kanbanEmpty">タスクなし</div>
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
                  </>
                ) : (
                  <div className="empty">左側でプロジェクトを作成してください</div>
                )}
              </div>
            </section>

            {todoRailOpen ? (
              <div
                className="projectTodoResizeHandle"
                role="separator"
                aria-label="プロジェクト一覧とToDoの高さを変更"
                aria-orientation="horizontal"
                aria-valuenow={projectTodoHeight}
                tabIndex={0}
                onPointerDown={beginProjectTodoResize}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  const direction = e.key === "ArrowUp" ? 1 : -1;
                  setProjectTodoHeight((height) => clampProjectTodoHeight(height + direction * 20));
                }}
              >
                <span aria-hidden="true" />
              </div>
            ) : null}

            {todoRailOpen ? (
              <aside className="todoRail">
                <div className="todoRailHead">
                  <div className="todoRailTitle">
                    <span className="todoRailMark" aria-hidden="true">
                      ✓
                    </span>
                    <span className="todoRailName">ToDo</span>
                    <span className="todoRailBadge">{todoEntries.length}</span>
                  </div>
                  <button
                    className="railToggleBtn"
                    type="button"
                    title="ToDoを閉じる"
                    aria-label="ToDoを閉じる"
                    onClick={() => setTodoRailOpen(false)}
                  >
                    ›
                  </button>
                </div>
                <div className="todoRailTools">
                  <button
                    className="primaryActionBtn"
                    type="button"
                    disabled={todoBusy}
                    title="全プロジェクトのInProgressから今日のToDoを作成"
                    onClick={() => void createTodoFromProjects()}
                  >
                    {todoBusy ? "作成中..." : "新規ToDo"}
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    disabled={todoBusy}
                    title="直近のToDoをそのまま今日へコピー"
                    onClick={() => void copyPreviousTodo()}
                  >
                    前回をコピー
                  </button>
                  <button
                    className="ghostBtn"
                    type="button"
                    disabled={projectTodoBusy}
                    title="Activeプロジェクト全体のInProgressを最新のToDoへ追記"
                    onClick={() => void appendActiveProjectTasksToTodo()}
                  >
                    {projectTodoBusy ? "追記中..." : "追記"}
                  </button>

                  <div className="segmented todoWeekNav" role="group" aria-label="表示する週">
                    <button
                      className="segmentedBtn"
                      type="button"
                      aria-label="前週"
                      onClick={() => setTodoWeekOffset((value) => value - 1)}
                    >
                      ‹
                    </button>
                    <span className="todoWeekLabel">
                      {todoWeekRange.start} 〜 {todoWeekRange.end}
                    </span>
                    <button
                      className="segmentedBtn"
                      type="button"
                      aria-label="次週"
                      disabled={todoWeekOffset >= 0}
                      onClick={() => setTodoWeekOffset((value) => Math.min(0, value + 1))}
                    >
                      ›
                    </button>
                    <button
                      className="segmentedBtn isText"
                      type="button"
                      disabled={todoWeekOffset === 0}
                      onClick={() => setTodoWeekOffset(0)}
                    >
                      今週
                    </button>
                  </div>
                </div>
                {todoStatus ? <div className="inlineToast">{todoStatus}</div> : null}
                <div className="todoRailBody dragScroll" ref={todoRailRef}>
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
                        taskSummary={summarizeTaskStates(e.body)}
                        onEdit={(entry) => {
                          setActiveView("journal");
                          setEditing(entry);
                          setDraft(null);
                        }}
                        onCopyId={(entry) => {
                          void copyEntryId(entry);
                        }}
                        onCopyMarkdown={(entry) => {
                          void copyEntryMarkdown(entry, setTodoStatus);
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
                </div>
              </aside>
            ) : (
              <button
                className="todoRailHandle"
                type="button"
                title="ToDoを開く"
                onClick={() => setTodoRailOpen(true)}
              >
                <span className="todoRailMark" aria-hidden="true">
                  ✓
                </span>
                <span className="todoRailHandleText">ToDo</span>
                <span className="todoRailBadge">{todoEntries.length}</span>
              </button>
            )}
          </section>
        ) : null}

        {activeView === "journal" ? (
            <section className="composerArea journalComposerArea">
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
                onDelete={editing ? () => deleteEditingEntry(editing) : undefined}
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
                        title="ナレッジで開く"
                      >
                        {item.title || `${item.date} のナレッジ`}
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
          theme={normalizeTheme(settings.theme)}
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
          onSaveSettings={async (payload) => {
            const saved = await api.saveSettings(payload);
            setSettings({ theme: normalizeTheme(saved.theme) });
          }}
        />
      ) : null}
    </div>
  );
}
