import type {
  ActaEntry,
  AddEntryPayload,
  ChooseDataDirResult,
  DeleteEntryPayload,
  DeleteEntryResult
} from "../shared/types";

declare global {
  interface Window {
    acta?: {
      getDataDir: () => Promise<string>;
      listEntries: () => Promise<ActaEntry[]>;
      addEntry: (payload: AddEntryPayload) => Promise<ActaEntry>;
      chooseDataDir: () => Promise<ChooseDataDirResult>;
      deleteEntry: (payload: DeleteEntryPayload) => Promise<DeleteEntryResult>;
    };
  }
}

export {};
