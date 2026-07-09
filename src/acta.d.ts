import type {
  ActaEntry,
  ActaAiSettings,
  ActaProject,
  AddEntryPayload,
  AddProjectKnowledgePayload,
  AddProjectTaskPayload,
  AiReadOutputPayload,
  AiReadOutputResult,
  AiChooseArticleFilesResult,
  AiSendInputPayload,
  AiStartSessionPayload,
  AiStartSessionResult,
  AiStopSessionPayload,
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
  MoveProjectTaskPayload,
  RenameProjectPayload,
  RenameProjectTaskPayload,
  SaveAiSettingsPayload,
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
      getAiSettings: () => Promise<ActaAiSettings>;
      saveAiSettings: (payload: SaveAiSettingsPayload) => Promise<ActaAiSettings>;
      listEntries: () => Promise<ActaEntry[]>;
      addEntry: (payload: AddEntryPayload) => Promise<ActaEntry>;
      saveImage: (payload: SaveImagePayload) => Promise<SaveImageResult>;
      chooseDataDir: () => Promise<ChooseDataDirResult>;
      deleteEntry: (payload: DeleteEntryPayload) => Promise<DeleteEntryResult>;
      updateEntry: (payload: UpdateEntryPayload) => Promise<UpdateEntryResult>;
      listProjects: () => Promise<ActaProject[]>;
      createProject: (payload: CreateProjectPayload) => Promise<ActaProject>;
      saveProject: (payload: SaveProjectPayload) => Promise<ActaProject>;
      addProjectTask: (payload: AddProjectTaskPayload) => Promise<ActaProject>;
      moveProjectTask: (payload: MoveProjectTaskPayload) => Promise<ActaProject>;
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
      createTodoFromProjects: () => Promise<ActaEntry>;
      copyPreviousTodo: () => Promise<ActaEntry>;
      rebuildKnowledgeIndex: () => Promise<KnowledgeIndexResult>;
      searchKnowledgeIndex: (payload: KnowledgeSearchPayload) => Promise<KnowledgeSearchResult>;
      generateKnowledgeSite: () => Promise<KnowledgeSiteResult>;
      openKnowledgeSite: () => Promise<{ opened: boolean; path: string; error?: string }>;
      syncPull: () => Promise<SyncResult>;
      syncBackup: () => Promise<SyncResult>;
      chooseAiArticleFiles: () => Promise<AiChooseArticleFilesResult>;
      aiStartSession: (payload: AiStartSessionPayload) => Promise<AiStartSessionResult>;
      aiSendInput: (payload: AiSendInputPayload) => Promise<{ sent: boolean }>;
      aiReadOutput: (payload: AiReadOutputPayload) => Promise<AiReadOutputResult>;
      aiStopSession: (payload: AiStopSessionPayload) => Promise<{ stopped: boolean }>;
    };
  }
}

export {};
