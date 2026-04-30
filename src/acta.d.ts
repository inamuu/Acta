import type {
  ActaEntry,
  ActaAiSettings,
  AddEntryPayload,
  AiReadOutputPayload,
  AiReadOutputResult,
  AiSendInputPayload,
  AiStartSessionPayload,
  AiStartSessionResult,
  AiStopSessionPayload,
  ChooseDataDirResult,
  DeleteEntryPayload,
  DeleteEntryResult,
  SaveAiSettingsPayload,
  SaveImagePayload,
  SaveImageResult,
  SyncResult,
  UpdateEntryPayload,
  UpdateEntryResult
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
      syncPull: () => Promise<SyncResult>;
      syncBackup: () => Promise<SyncResult>;
      aiStartSession: (payload: AiStartSessionPayload) => Promise<AiStartSessionResult>;
      aiSendInput: (payload: AiSendInputPayload) => Promise<{ sent: boolean }>;
      aiReadOutput: (payload: AiReadOutputPayload) => Promise<AiReadOutputResult>;
      aiStopSession: (payload: AiStopSessionPayload) => Promise<{ stopped: boolean }>;
    };
  }
}

export {};
