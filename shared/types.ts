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

export type SyncResult = {
  ok: boolean;
  label: "Sync Success" | "Sync Error";
  detail: string;
  command: string;
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
  "gruvbox-dark"
] as const;

export type ActaThemeId = (typeof ACTA_THEME_IDS)[number];

export type ActaAiSettings = {
  cliPath: string;
  instructionMarkdown: string;
  theme: ActaThemeId;
};

export type SaveAiSettingsPayload = ActaAiSettings;

export type AiStartSessionPayload = {
  cliPath: string;
};

export type AiStartSessionResult = {
  sessionId: string;
};

export type AiSendInputPayload = {
  sessionId: string;
  input: string;
};

export type AiReadOutputPayload = {
  sessionId: string;
};

export type AiSessionPhase = "idle" | "thinking" | "tool" | "done" | "error";

export type AiConsoleUpdate =
  | {
      id: string;
      kind: "assistant";
      text: string;
      createdAtMs: number;
    }
  | {
      id: string;
      kind: "status";
      label: string;
      detail?: string;
      tone: "neutral" | "active" | "done" | "error";
      createdAtMs: number;
    }
  | {
      id: string;
      kind: "command";
      status: "started" | "completed";
      command: string;
      exitCode?: number | null;
      output?: string;
      createdAtMs: number;
    }
  | {
      id: string;
      kind: "error";
      text: string;
      createdAtMs: number;
    };

export type AiReadOutputResult = {
  updates: AiConsoleUpdate[];
  alive: boolean;
  busy: boolean;
  exitCode: number | null;
  phase: AiSessionPhase;
  phaseLabel: string;
  activeCommand?: string;
  turnStartedAtMs: number | null;
  lastTurnDurationMs: number | null;
  error?: string;
};

export type AiStopSessionPayload = {
  sessionId: string;
};
