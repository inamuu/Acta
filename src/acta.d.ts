import type {
  ActaEntry,
  ActaSettings,
  ActaProject,
  AddEntryPayload,
  AddProjectKnowledgePayload,
  AddProjectTaskPayload,
  ChooseDataDirResult,
  CreateProjectPayload,
  DeleteProjectKnowledgePayload,
  DeleteEntryPayload,
  DeleteEntryResult,
  DeleteProjectPayload,
  DeleteProjectResult,
  DeleteProjectTaskPayload,
  KnowledgeIndexResult,
  KnowledgeSearchPayload,
  KnowledgeSearchResult,
  KnowledgeSiteResult,
  GitHubSyncResult,
  MoveProjectTaskPayload,
  ReassignProjectTaskPayload,
  RenameProjectPayload,
  RenameProjectTaskPayload,
  SaveSettingsPayload,
  SaveImagePayload,
  SaveImageResult,
  SaveProjectPayload,
  SetProjectArchivedPayload,
  SetProjectIssueUrlPayload,
  SyncResult,
  UpdateEntryPayload,
  UpdateEntryResult,
  UpdateProjectKnowledgePayload
} from "../shared/types";

declare global {
  interface Window {
    acta?: {
      getDataDir: () => Promise<string>;
      getSettings: () => Promise<ActaSettings>;
      saveSettings: (payload: SaveSettingsPayload) => Promise<ActaSettings>;
      listEntries: () => Promise<ActaEntry[]>;
      addEntry: (payload: AddEntryPayload) => Promise<ActaEntry>;
      saveImage: (payload: SaveImagePayload) => Promise<SaveImageResult>;
      chooseDataDir: () => Promise<ChooseDataDirResult>;
      deleteEntry: (payload: DeleteEntryPayload) => Promise<DeleteEntryResult>;
      updateEntry: (payload: UpdateEntryPayload) => Promise<UpdateEntryResult>;
      listProjects: () => Promise<ActaProject[]>;
      setProjectOrder: (payload: { projectIds: string[] }) => Promise<string[]>;
      createProject: (payload: CreateProjectPayload) => Promise<ActaProject>;
      saveProject: (payload: SaveProjectPayload) => Promise<ActaProject>;
      addProjectTask: (payload: AddProjectTaskPayload) => Promise<ActaProject>;
      moveProjectTask: (payload: MoveProjectTaskPayload) => Promise<ActaProject>;
      reassignProjectTask: (payload: ReassignProjectTaskPayload) => Promise<ActaProject>;
      renameProjectTask: (payload: RenameProjectTaskPayload) => Promise<ActaProject>;
      deleteProjectTask: (payload: DeleteProjectTaskPayload) => Promise<ActaProject>;
      setProjectArchived: (payload: SetProjectArchivedPayload) => Promise<ActaProject>;
      renameProject: (payload: RenameProjectPayload) => Promise<ActaProject>;
      deleteProject: (payload: DeleteProjectPayload) => Promise<DeleteProjectResult>;
      setProjectIssueUrl: (payload: SetProjectIssueUrlPayload) => Promise<ActaProject>;
      addProjectKnowledgeEntry: (payload: AddProjectKnowledgePayload) => Promise<ActaProject>;
      updateProjectKnowledgeEntry: (payload: UpdateProjectKnowledgePayload) => Promise<ActaProject>;
      deleteProjectKnowledgeEntry: (payload: DeleteProjectKnowledgePayload) => Promise<ActaProject>;
      appendProjectInProgressToTodayTodo: (payload: { projectId: string }) => Promise<ActaEntry>;
      appendActiveProjectsInProgressToTodayTodo: () => Promise<ActaEntry>;
      createTodoFromProjects: () => Promise<ActaEntry>;
      syncGitHubItems: () => Promise<GitHubSyncResult>;
      copyPreviousTodo: () => Promise<ActaEntry>;
      rebuildKnowledgeIndex: () => Promise<KnowledgeIndexResult>;
      searchKnowledgeIndex: (payload: KnowledgeSearchPayload) => Promise<KnowledgeSearchResult>;
      generateKnowledgeSite: () => Promise<KnowledgeSiteResult>;
      openKnowledgeSite: () => Promise<{ opened: boolean; path: string; error?: string }>;
      syncPull: () => Promise<SyncResult>;
      syncBackup: () => Promise<SyncResult>;
      /** 未保存の変更があるかをメインプロセスへ通知する。ウィンドウを閉じるときの確認に使う。 */
      setUnsavedChanges?: (dirty: boolean) => void;
      onDataChanged?: (listener: () => void) => () => void;
    };
  }
}

export {};
