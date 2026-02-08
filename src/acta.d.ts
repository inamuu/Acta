import type { ActaEntry, AddEntryPayload, ChooseDataDirResult } from "../shared/types";

declare global {
  interface Window {
    acta?: {
      getDataDir: () => Promise<string>;
      listEntries: () => Promise<ActaEntry[]>;
      addEntry: (payload: AddEntryPayload) => Promise<ActaEntry>;
      chooseDataDir: () => Promise<ChooseDataDirResult>;
    };
  }
}

export {};
