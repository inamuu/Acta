import React, { useMemo, useState } from "react";
import type { ActaProject, GitHubItem, GitHubItemRelation } from "../../shared/types";
import { SourceTypeBadge } from "./SourceTypeBadge";

/**
 * GitHub タブ。自分に関係する Open な Issue・PR を一覧し、Acta のプロジェクトへ割り当てる。
 *
 * タブは配列で定義しているので、将来 Gitify の機能（通知の受信箱など）を取り込むときは
 * GITHUB_TABS に "notifications" を足し、同じリスト表示（リポジトリごとのグループ）を使い回す想定。
 */
type GitHubTabId = "pulls" | "issues";
type RelationFilter = "all" | GitHubItemRelation;

const GITHUB_TABS: Array<{ id: GitHubTabId; label: string; type: GitHubItem["type"] }> = [
  { id: "pulls", label: "Pull Requests", type: "PullRequest" },
  { id: "issues", label: "Issues", type: "Issue" }
];

const RELATION_LABELS: Record<GitHubItemRelation, string> = {
  author: "作成",
  assignee: "アサイン",
  review_requested: "レビュー依頼"
};

type Props = {
  items: GitHubItem[];
  /** 新着として「NEW」を付ける項目 */
  newItemIds: Set<string>;
  syncedAtMs: number;
  syncBusy: boolean;
  status: string;
  projects: ActaProject[];
  autoSyncMinutes: number;
  onSync: () => void;
  onAssign: (itemId: string, projectId: string) => void;
};

function formatRelative(ms: number, now: number): string {
  if (!ms) return "";
  const diffMin = Math.max(0, Math.round((now - ms) / 60000));
  if (diffMin < 1) return "たった今";
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay}日前`;
  return new Date(ms).toLocaleDateString("ja-JP");
}

function formatClock(ms: number): string {
  if (!ms) return "未同期";
  return new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

export function GitHubView({ items, newItemIds, syncedAtMs, syncBusy, status, projects, autoSyncMinutes, onSync, onAssign }: Props) {
  const [tab, setTab] = useState<GitHubTabId>("pulls");
  const [relation, setRelation] = useState<RelationFilter>("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const now = Date.now();

  // Issue・PR がどのプロジェクトに割り当て済みか（タスクIDは GitHub のノードID）
  const projectByItemId = useMemo(() => {
    const map = new Map<string, ActaProject>();
    for (const project of projects) {
      for (const task of project.tasks) {
        if (task.source === "github") map.set(task.id, project);
      }
    }
    return map;
  }, [projects]);

  const activeProjects = useMemo(() => projects.filter((project) => !project.archivedAtMs), [projects]);
  const activeTab = GITHUB_TABS.find((candidate) => candidate.id === tab) ?? GITHUB_TABS[0];
  const relationOptions: RelationFilter[] =
    activeTab.type === "PullRequest" ? ["all", "author", "assignee", "review_requested"] : ["all", "author", "assignee"];

  const countByTab = useMemo(() => {
    const counts = new Map<GitHubTabId, number>();
    for (const candidate of GITHUB_TABS) {
      counts.set(candidate.id, items.filter((item) => item.type === candidate.type).length);
    }
    return counts;
  }, [items]);

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = items.filter((item) => {
      if (item.type !== activeTab.type) return false;
      if (relation !== "all" && !item.relations.includes(relation)) return false;
      if (unassignedOnly && projectByItemId.has(item.id)) return false;
      if (!needle) return true;
      return `${item.title} ${item.repository} #${item.number} ${item.labels.join(" ")}`.toLocaleLowerCase().includes(needle);
    });
    const byRepo = new Map<string, GitHubItem[]>();
    for (const item of filtered) {
      const list = byRepo.get(item.repository) || [];
      list.push(item);
      byRepo.set(item.repository, list);
    }
    // リポジトリは名前順、その中は番号順で並べる（同期のたびに並びが変わらないように）
    return Array.from(byRepo.entries())
      .map(([repository, list]) => ({
        repository,
        items: list.sort((a, b) => a.number - b.number)
      }))
      .sort((a, b) => a.repository.localeCompare(b.repository));
  }, [activeTab.type, items, projectByItemId, query, relation, unassignedOnly]);

  const visibleCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <section className="githubArea">
      <div className="githubToolbar">
        <div className="githubTabs" role="tablist" aria-label="GitHubの種別">
          {GITHUB_TABS.map((candidate) => (
            <button
              key={candidate.id}
              className={`githubTab ${tab === candidate.id ? "isActive" : ""}`}
              type="button"
              role="tab"
              aria-selected={tab === candidate.id}
              onClick={() => {
                setTab(candidate.id);
                if (candidate.type === "Issue" && relation === "review_requested") setRelation("all");
              }}
            >
              <SourceTypeBadge sourceType={candidate.type} />
              <span>{candidate.label}</span>
              <span className="githubTabCount">{countByTab.get(candidate.id) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="githubSyncBox">
          <span className="githubSyncedAt" title={`起動中は${autoSyncMinutes}分ごとに自動で同期します`}>
            最終同期 {formatClock(syncedAtMs)}・{autoSyncMinutes}分ごとに自動同期
          </span>
          <button className="ghostBtn" type="button" disabled={syncBusy} onClick={onSync}>
            {syncBusy ? "同期中..." : "今すぐ同期"}
          </button>
        </div>
      </div>

      <div className="githubFilters">
        <div className="githubRelationFilter" role="group" aria-label="自分との関係">
          {relationOptions.map((option) => (
            <button
              key={option}
              className={`githubChip ${relation === option ? "isActive" : ""}`}
              type="button"
              onClick={() => setRelation(option)}
            >
              {option === "all" ? "すべて" : RELATION_LABELS[option]}
            </button>
          ))}
        </div>
        <label className="githubCheck">
          <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
          プロジェクト未割当のみ
        </label>
        <input
          className="githubSearchInput"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="タイトル・リポジトリ・ラベルで絞り込み"
        />
      </div>

      {status ? <div className="githubStatus">{status}</div> : null}

      {visibleCount === 0 ? (
        <div className="empty">
          {syncedAtMs ? "該当する項目はありません" : "まだ同期していません。「今すぐ同期」を押してください"}
        </div>
      ) : (
        <div className="githubGroups">
          {groups.map((group) => (
            <div className="githubGroup" key={group.repository}>
              <div className="githubGroupHeader">
                <span className="githubRepoName">{group.repository || "(不明なリポジトリ)"}</span>
                <span className="githubGroupCount">{group.items.length}</span>
              </div>
              <ul className="githubItemList">
                {group.items.map((item) => {
                  const assigned = projectByItemId.get(item.id);
                  return (
                    <li className={`githubItem ${newItemIds.has(item.id) ? "isNew" : ""}`} key={item.id}>
                      <div className="githubItemMain">
                        <a className="githubItemTitle" href={item.url} target="_blank" rel="noreferrer" title="GitHubで開く">
                          {item.title}
                        </a>
                        <div className="githubItemMeta">
                          {newItemIds.has(item.id) ? <span className="githubPill isNew">NEW</span> : null}
                          <span className="githubItemNumber">#{item.number}</span>
                          {item.isDraft ? <span className="githubPill isDraft">Draft</span> : null}
                          {item.relations.map((r) => (
                            <span key={r} className={`githubPill relation-${r}`}>
                              {RELATION_LABELS[r]}
                            </span>
                          ))}
                          {item.labels.map((label) => (
                            <span key={label} className="githubPill isLabel">
                              {label}
                            </span>
                          ))}
                          {item.author && !item.relations.includes("author") ? (
                            <span className="githubItemAuthor">by {item.author}</span>
                          ) : null}
                          <span className="githubItemUpdated">{formatRelative(item.updatedAtMs, now)}更新</span>
                        </div>
                      </div>
                      <select
                        className={`githubProjectSelect ${assigned ? "isAssigned" : ""}`}
                        value={assigned?.id ?? ""}
                        aria-label="Actaプロジェクト"
                        title="Actaプロジェクトへ割り当て"
                        onChange={(e) => onAssign(item.id, e.target.value)}
                      >
                        <option value="">プロジェクト未割当</option>
                        {activeProjects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
