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

export type AiReadOutputResult = {
  chunk: string;
  alive: boolean;
  busy: boolean;
  exitCode: number | null;
  error?: string;
};

export type AiStopSessionPayload = {
  sessionId: string;
};
