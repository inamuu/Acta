export type ActaEntry = {
  id: string;
  date: string; // YYYY-MM-DD (from file name)
  created: string; // human readable (may be date-only for the first entry of a day)
  createdAtMs: number; // stable sort key
  tags: string[];
  body: string;
  sourceFile: string;
};

export type AddEntryPayload = {
  body: string;
  tags: string[];
};

export type SaveImagePayload = {
  bytes: ArrayBuffer;
  mimeType: string;
  name?: string;
};

export type SaveImageResult = {
  filePath: string;
  markdownPath: string;
};

export type ChooseDataDirResult = {
  canceled: boolean;
  dataDir: string;
};

export type DeleteEntryPayload = {
  id: string;
};

export type DeleteEntryResult = {
  deleted: boolean;
};

export type UpdateEntryPayload = {
  id: string;
  body: string;
  tags: string[];
};

export type UpdateEntryResult = {
  updated: boolean;
};

export type ProjectTaskStatus = "Backlog" | "InProgress" | "Done";

export type ProjectTask = {
  id: string;
  title: string;
  status: ProjectTaskStatus;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number;
  source?: "local" | "github";
  sourceUrl?: string;
  sourceType?: "Issue" | "PullRequest";
  repository?: string;
  sourceState?: "open" | "closed";
  /** 親タスクのID（同じプロジェクトのタスク）。ToDoでは親の下に字下げして表示する */
  parentId?: string;
};

export type ActaProject = {
  id: string;
  name: string;
  dirName: string;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number;
  issueUrl: string;
  /** 紐づける GitHub Project (v2) のURL。同期時、このGitHub Projectに属するIssue・PRを自動でこのプロジェクトへ割り当てる */
  githubProjectUrl: string;
  tasks: ProjectTask[];
  knowledgeEntries: ActaEntry[];
  sourceDir: string;
};

export type CreateProjectPayload = {
  name: string;
};

export type SaveProjectPayload = {
  id: string;
  tasks: ProjectTask[];
};

export type AddProjectTaskPayload = {
  projectId: string;
  title: string;
  status?: ProjectTaskStatus;
};

export type MoveProjectTaskPayload = {
  projectId: string;
  taskId: string;
  status: ProjectTaskStatus;
};

export type ReassignProjectTaskPayload = {
  sourceProjectId: string;
  targetProjectId: string;
  taskId: string;
};

export type RenameProjectTaskPayload = {
  projectId: string;
  taskId: string;
  title: string;
};

export type SetProjectTaskParentPayload = {
  projectId: string;
  taskId: string;
  /** 空文字なら親を外す */
  parentId: string;
};

export type DeleteProjectTaskPayload = {
  projectId: string;
  taskId: string;
};

export type AddProjectKnowledgePayload = {
  projectId: string;
  body: string;
};

export type UpdateProjectKnowledgePayload = {
  projectId: string;
  entryId: string;
  body: string;
};

export type DeleteProjectKnowledgePayload = {
  projectId: string;
  entryId: string;
};

export type SetProjectArchivedPayload = {
  projectId: string;
  archived: boolean;
};

export type RenameProjectPayload = {
  projectId: string;
  name: string;
};

export type DeleteProjectPayload = {
  projectId: string;
};

export type DeleteProjectResult = {
  deleted: boolean;
};

export type SetProjectIssueUrlPayload = {
  projectId: string;
  issueUrl: string;
};

export type SetProjectGitHubProjectUrlPayload = {
  projectId: string;
  githubProjectUrl: string;
};

export type KnowledgeIndexResult = {
  ok: boolean;
  dbPath: string;
  statePath: string;
  indexedAtMs: number;
  scannedFiles: number;
  changedFiles: number;
  deletedFiles: number;
  indexedEntries: number;
  totalEntries: number;
  detail: string;
};

export type KnowledgeSearchPayload = {
  query: string;
  excludeTags?: string[];
  limit?: number;
};

export type KnowledgeSearchResultItem = {
  id: string;
  title: string;
  date: string;
  created: string;
  createdAtMs: number;
  tags: string[];
  body: string;
  sourceFile: string;
  score: number;
};

export type KnowledgeSearchResult = {
  query: string;
  items: KnowledgeSearchResultItem[];
};

export type KnowledgeSiteResult = {
  ok: boolean;
  sitePath: string;
  entryCount: number;
  generatedAtMs: number;
};

export type SyncResult = {
  ok: boolean;
  label: "Sync Success" | "Sync Error" | "Sync Disabled";
  detail: string;
  command: string;
  /** 保存先が git 管理でないなど、同期そのものが無効なとき true。 */
  disabled?: boolean;
};

export const ACTA_THEME_IDS = [
  "default",
  "dracula",
  "solarized-dark",
  "solarized-light",
  "morokai",
  "morokai-light",
  "tokyo-night",
  "nord",
  "gruvbox-dark",
  "github-light",
  "gruvbox-light",
  "catppuccin-latte",
  "tokyo-night-day"
] as const;

export type ActaThemeId = (typeof ACTA_THEME_IDS)[number];

export type ActaSettings = {
  theme: ActaThemeId;
};

export type GitHubSyncResult = {
  ok: boolean;
  fetchedItems: number;
  importedTasks: number;
  updatedTasks: number;
  /** 同期で更新したプロジェクト数 */
  changedProjects: number;
  detail: string;
  syncedAtMs: number;
};

/**
 * 自分と Issue・PR の関係。GitHub タブの絞り込みに使う。
 * 将来 Gitify の機能（通知）を取り込む場合は mention / comment などをここに足す想定。
 */
export type GitHubItemRelation = "author" | "assignee" | "review_requested";

export type GitHubItem = {
  /** GraphQL のノードID。プロジェクトに割り当てたタスクの id と同じ */
  id: string;
  number: number;
  title: string;
  url: string;
  repository: string;
  type: "Issue" | "PullRequest";
  isDraft: boolean;
  author: string;
  labels: string[];
  relations: GitHubItemRelation[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type GitHubItemsResult = {
  items: GitHubItem[];
  /** 最後に同期した時刻。未同期なら 0 */
  syncedAtMs: number;
};

export type AssignGitHubItemPayload = {
  itemId: string;
  /** 割り当て先のプロジェクトID。空ならプロジェクトから外す */
  projectId: string;
};

export type SaveSettingsPayload = ActaSettings;
