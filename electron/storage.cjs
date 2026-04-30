const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app } = require("electron");

const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const POSTS_DIR = "posts";
const IMAGES_DIR = "images";
const SETTINGS_FILE = "acta-settings.json";
const DATA_DIR_SETTINGS_FILE = "settings.json";
const SYNC_SUCCESS = "Sync Success";
const SYNC_ERROR = "Sync Error";
const DEFAULT_AI_CLI_PATH = "/opt/homebrew/bin/codex";
const DEFAULT_THEME = "default";
const ALLOWED_THEMES = new Set([
  "default",
  "dracula",
  "solarized-dark",
  "solarized-light",
  "morokai",
  "morokai-light",
  "tokyo-night",
  "nord",
  "gruvbox-dark"
]);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatTime(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateTime(d) {
  return `${formatDate(d)} ${formatTime(d)}`;
}

function getDateParts(d) {
  return {
    yyyy: String(d.getFullYear()),
    mm: pad2(d.getMonth() + 1),
    dd: pad2(d.getDate())
  };
}

function normalizeNewlines(s) {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseCreatedToMs(created) {
  const s = String(created ?? "").trim();
  if (!s) return 0;

  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const d = Number(m1[3]);
    return new Date(y, mo - 1, d).getTime();
  }

  const m2 = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
  if (m2) {
    const y = Number(m2[1]);
    const mo = Number(m2[2]);
    const d = Number(m2[3]);
    const hh = Number(m2[4]);
    const mm = Number(m2[5]);
    return new Date(y, mo - 1, d, hh, mm).getTime();
  }

  return 0;
}

function normalizeTag(raw) {
  const t = String(raw ?? "")
    .replace(/^[#＃]/, "")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

function parseTags(raw) {
  const input = String(raw ?? "");
  if (!input.trim()) return [];
  const parts = input.split(/[,、]/g).map(normalizeTag).filter(Boolean);
  return Array.from(new Set(parts));
}

function getDefaultDataDir() {
  // Keep files user-visible.
  return path.join(app.getPath("documents"), "Acta");
}

function getSettingsPath() {
  return path.join(app.getPath("userData"), SETTINGS_FILE);
}

let cachedSettings = null;

function loadSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = fs.readFileSync(getSettingsPath(), "utf8");
    const parsed = safeJsonParse(raw);
    cachedSettings = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cachedSettings = {};
  }
  return cachedSettings;
}

function saveSettings(next) {
  cachedSettings = next && typeof next === "object" ? next : {};
  fs.mkdirSync(path.dirname(getSettingsPath()), { recursive: true });
  fs.writeFileSync(getSettingsPath(), JSON.stringify(cachedSettings, null, 2), "utf8");

  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, DATA_DIR_SETTINGS_FILE), JSON.stringify(cachedSettings, null, 2), "utf8");
}

function getDataDir() {
  const s = loadSettings();
  const dir = typeof s.dataDir === "string" ? s.dataDir.trim() : "";
  return dir ? dir : getDefaultDataDir();
}

function buildDefaultAiInstruction(dataDir) {
  const dir = String(dataDir ?? "").trim() || getDefaultDataDir();
  return [
    `<data>${dir}</data> の中身を読み込んでください。`,
    "例えば、今日から一週間分のサマリーを作成してと言われたら、今日の日付から一週間分の内容を読み込んでサマリーを作成して、他のファイルと同じように今の日時でファイルを作成、またはすでにファイルがあれば追記するようにしてください。",
    "作成してと言われたファイルはすべて、上記 data に保存するようにしてください。"
  ].join("\n");
}

function normalizeTheme(raw) {
  const t = String(raw ?? "").trim().toLowerCase();
  return ALLOWED_THEMES.has(t) ? t : DEFAULT_THEME;
}

function getAiSettings() {
  const s = loadSettings();
  const cliPath = typeof s.aiCliPath === "string" ? s.aiCliPath.trim() : "";
  const instructionMarkdown =
    typeof s.aiInstructionMarkdown === "string" && s.aiInstructionMarkdown.trim().length > 0
      ? s.aiInstructionMarkdown
      : buildDefaultAiInstruction(getDataDir());
  const theme = normalizeTheme(s.theme);

  return {
    cliPath: cliPath || DEFAULT_AI_CLI_PATH,
    instructionMarkdown,
    theme
  };
}

function setAiSettings(payload) {
  const cliPath = String(payload?.cliPath ?? "").trim() || DEFAULT_AI_CLI_PATH;
  const instructionMarkdown = String(payload?.instructionMarkdown ?? "").trim() || buildDefaultAiInstruction(getDataDir());
  const theme = normalizeTheme(payload?.theme);

  const s = loadSettings();
  saveSettings({
    ...s,
    aiCliPath: cliPath,
    aiInstructionMarkdown: instructionMarkdown,
    theme
  });

  return getAiSettings();
}

async function setDataDir(dir) {
  const nextDir = String(dir ?? "").trim();
  if (!nextDir) throw new Error("保存先が不正です");

  await fs.promises.mkdir(nextDir, { recursive: true });

  const s = loadSettings();
  saveSettings({ ...s, dataDir: nextDir });
  return getDataDir();
}

async function ensureDataDir() {
  await fs.promises.mkdir(getDataDir(), { recursive: true });
}

function getPostFilePath(date) {
  const [yyyy, mm, dd] = String(date ?? "").split("-");
  return path.join(getDataDir(), POSTS_DIR, yyyy, mm, dd, `${date}.md`);
}

function getDateFromFilePath(filePath) {
  const name = path.basename(String(filePath ?? ""));
  return DATE_FILE_RE.test(name) ? name.slice(0, 10) : "";
}

function isCanonicalPostFilePath(filePath) {
  const date = getDateFromFilePath(filePath);
  if (!date) return false;
  return path.resolve(filePath) === path.resolve(getPostFilePath(date));
}

function getRelativeDataPath(filePath) {
  return path.relative(getDataDir(), filePath).split(path.sep).join("/");
}

async function collectDateFiles(dir = getDataDir()) {
  let names = [];
  try {
    names = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out = [];
  for (const entry of names) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectDateFiles(p)));
      continue;
    }
    if (entry.isFile() && DATE_FILE_RE.test(entry.name)) {
      out.push(p);
    }
  }
  out.sort();
  return out;
}

async function migrateDateFilesToPostDirs() {
  const files = await collectDateFiles();

  for (const sourcePath of files) {
    const date = getDateFromFilePath(sourcePath);
    if (!date) continue;
    if (isCanonicalPostFilePath(sourcePath)) continue;

    const targetPath = getPostFilePath(date);
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    const sourceText = await fs.promises.readFile(sourcePath, "utf8");
    const targetExists = await fileExists(targetPath);

    if (!targetExists) {
      await fs.promises.rename(sourcePath, targetPath);
      continue;
    }

    const targetText = await fs.promises.readFile(targetPath, "utf8");
    const separator = targetText.endsWith("\n") ? "" : "\n";
    await fs.promises.writeFile(targetPath, `${targetText}${separator}${sourceText.trimStart()}`, "utf8");
    await fs.promises.unlink(sourcePath);
  }
}

async function fileExists(p) {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildSyncResult(ok, detail, command) {
  return {
    ok: Boolean(ok),
    label: ok ? SYNC_SUCCESS : SYNC_ERROR,
    detail: String(detail ?? ""),
    command: String(command ?? "")
  };
}

function runGitCommand(args) {
  return new Promise((resolve) => {
    const dataDir = getDataDir();
    let done = false;
    let stdout = "";
    let stderr = "";

    const child = spawn("git", args, {
      cwd: dataDir,
      stdio: ["ignore", "pipe", "pipe"]
    });

    function finish(result) {
      if (done) return;
      done = true;
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });

    child.on("error", (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      finish({ code: 1, stdout: stdout.trim(), stderr: msg || stderr.trim() });
    });
    child.on("close", (code) => {
      finish({
        code: typeof code === "number" ? code : 1,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
  });
}

async function syncPull() {
  await ensureDataDir();
  const res = await runGitCommand(["pull"]);
  if (res.code !== 0) {
    return buildSyncResult(false, res.stderr || res.stdout || "git pull に失敗しました", "git pull");
  }
  return buildSyncResult(true, res.stdout || "git pull 完了", "git pull");
}

async function syncBackup() {
  await ensureDataDir();

  const addRes = await runGitCommand(["add", "."]);
  if (addRes.code !== 0) {
    return buildSyncResult(false, addRes.stderr || addRes.stdout || "git add に失敗しました", "git add .");
  }

  const statusRes = await runGitCommand(["status", "--porcelain"]);
  if (statusRes.code !== 0) {
    return buildSyncResult(
      false,
      statusRes.stderr || statusRes.stdout || "git status に失敗しました",
      "git status --porcelain"
    );
  }

  if (statusRes.stdout.trim()) {
    const commitRes = await runGitCommand(["commit", "-m", "backup"]);
    if (commitRes.code !== 0) {
      return buildSyncResult(
        false,
        commitRes.stderr || commitRes.stdout || "git commit に失敗しました",
        'git commit -m "backup"'
      );
    }
  }

  const pushRes = await runGitCommand(["push", "-u", "origin", "main"]);
  if (pushRes.code !== 0) {
    return buildSyncResult(false, pushRes.stderr || pushRes.stdout || "git push に失敗しました", "git push -u origin main");
  }

  return buildSyncResult(true, pushRes.stdout || "git push 完了", "git push -u origin main");
}

function parseEntriesFromText(text, date, sourceFile) {
  const entries = [];
  const t = normalizeNewlines(text);

  const re = /<!--\s*acta:comment\s*\n([\s\S]*?)-->\n([\s\S]*?)\n<!--\s*\/acta:comment\s*-->/g;
  let match;
  while ((match = re.exec(t)) !== null) {
    const metaBlock = match[1] ?? "";
    const body = (match[2] ?? "").trimEnd();

    const meta = {};
    for (const line of metaBlock.split("\n")) {
      const m = /^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      meta[m[1]] = m[2];
    }

    const id = meta.id || `${path.basename(sourceFile)}:${match.index}`;
    const created = meta.created || date;
    const createdAtMs = Number(meta.created_ms) || parseCreatedToMs(created) || 0;
    const tags = parseTags(meta.tags || "");

    entries.push({
      id,
      date,
      created,
      createdAtMs,
      tags,
      body,
      sourceFile
    });
  }

  return entries;
}

function removeEntryFromText(text, id) {
  const t = normalizeNewlines(text);
  const re = /<!--\s*acta:comment\s*\n([\s\S]*?)-->\n([\s\S]*?)\n<!--\s*\/acta:comment\s*-->\n*/g;

  let changed = false;
  let out = "";
  let last = 0;

  let match;
  while ((match = re.exec(t)) !== null) {
    const full = match[0] ?? "";
    const metaBlock = match[1] ?? "";

    const meta = {};
    for (const line of metaBlock.split("\n")) {
      const m = /^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      meta[m[1]] = m[2];
    }

    const matchId = String(meta.id ?? "");

    out += t.slice(last, match.index);
    if (matchId === id) {
      changed = true;
      // omit this block
    } else {
      out += full;
    }
    last = re.lastIndex;
  }

  out += t.slice(last);
  return { changed, nextText: out };
}

function updateEntryInText(text, id, nextBody, nextTags) {
  const t = normalizeNewlines(text);
  const re = /<!--\s*acta:comment\s*\n([\s\S]*?)-->\n([\s\S]*?)\n<!--\s*\/acta:comment\s*-->\n*/g;

  let changed = false;
  let out = "";
  let last = 0;

  let match;
  while ((match = re.exec(t)) !== null) {
    const full = match[0] ?? "";
    const metaBlock = match[1] ?? "";

    const meta = {};
    for (const line of metaBlock.split("\n")) {
      const m = /^\s*([a-zA-Z0-9_]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      meta[m[1]] = m[2];
    }

    const matchId = String(meta.id ?? "");

    out += t.slice(last, match.index);
    if (matchId === id) {
      changed = true;
      const created = meta.created || "";
      const createdAtMs = Number(meta.created_ms) || parseCreatedToMs(created) || 0;
      out += formatEntryBlock({
        id,
        created: created || "",
        createdAtMs,
        tags: Array.isArray(nextTags) ? nextTags : [],
        body: nextBody
      });
    } else {
      out += full;
    }
    last = re.lastIndex;
  }

  out += t.slice(last);
  return { changed, nextText: out };
}

async function listEntries() {
  await ensureDataDir();
  await migrateDateFilesToPostDirs();

  const files = await collectDateFiles();
  const entries = [];

  for (const p of files) {
    const date = path.basename(p).slice(0, 10);
    let text = "";
    try {
      text = await fs.promises.readFile(p, "utf8");
    } catch {
      continue;
    }
    entries.push(...parseEntriesFromText(text, date, p));
  }

  entries.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return entries;
}

function formatEntryBlock({ id, created, createdAtMs, tags, body }) {
  const tagLine = (tags || []).map(normalizeTag).filter(Boolean).join(", ");
  const cleanBody = normalizeNewlines(String(body ?? "")).trimEnd();

  return (
    `<!-- acta:comment\n` +
    `id: ${id}\n` +
    `created: ${created}\n` +
    `created_ms: ${createdAtMs}\n` +
    `tags: ${tagLine}\n` +
    `-->\n` +
    `${cleanBody}\n` +
    `<!-- /acta:comment -->\n\n`
  );
}

async function addEntry(payload) {
  const body = String(payload?.body ?? "").trim();
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const cleanTags = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));

  if (!body) {
    throw new Error("本文が空です");
  }

  await ensureDataDir();

  const now = new Date();
  const date = formatDate(now);
  const filePath = getPostFilePath(date);
  const exists = await fileExists(filePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  if (!exists) {
    await fs.promises.writeFile(filePath, `# ${date}\n\n`, "utf8");
  }

  const id = crypto.randomUUID();
  const createdAtMs = Date.now();

  // Spec: if the date file already exists, include date+time in the record.
  // If it's the first entry of the day, the date is already in the file name/header.
  const created = exists ? formatDateTime(now) : date;

  const entry = {
    id,
    date,
    created,
    createdAtMs,
    tags: cleanTags,
    body,
    sourceFile: filePath
  };

  await fs.promises.appendFile(filePath, formatEntryBlock(entry), "utf8");
  return entry;
}

function imageExtensionFromMime(mimeType, name) {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/svg+xml") return ".svg";

  const ext = path.extname(String(name ?? "")).toLowerCase();
  if (/^\.(jpe?g|png|gif|webp|svg)$/.test(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  return ".png";
}

async function saveImage(payload) {
  const mimeType = String(payload?.mimeType ?? "").trim().toLowerCase();
  if (!mimeType.startsWith("image/")) throw new Error("画像データではありません");

  const bytes = payload?.bytes;
  const buffer = Buffer.isBuffer(bytes)
    ? bytes
    : bytes instanceof ArrayBuffer
      ? Buffer.from(bytes)
      : ArrayBuffer.isView(bytes)
        ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : null;
  if (!buffer || buffer.length === 0) throw new Error("画像データが空です");

  await ensureDataDir();

  const now = new Date();
  const { yyyy, mm, dd } = getDateParts(now);
  const dir = path.join(getDataDir(), IMAGES_DIR, yyyy, mm, dd);
  await fs.promises.mkdir(dir, { recursive: true });

  const ext = imageExtensionFromMime(mimeType, payload?.name);
  const filePath = path.join(dir, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  await fs.promises.writeFile(filePath, buffer);

  return {
    filePath,
    markdownPath: getRelativeDataPath(filePath)
  };
}

async function deleteEntry(payload) {
  const id = String(payload?.id ?? "").trim();
  if (!id) throw new Error("id が不正です");

  await ensureDataDir();

  const files = await collectDateFiles();

  for (const p of files) {
    let text = "";
    try {
      text = await fs.promises.readFile(p, "utf8");
    } catch {
      continue;
    }

    const { changed, nextText } = removeEntryFromText(text, id);
    if (!changed) continue;

    await fs.promises.writeFile(p, nextText, "utf8");
    return { deleted: true };
  }

  return { deleted: false };
}

async function updateEntry(payload) {
  const id = String(payload?.id ?? "").trim();
  const body = String(payload?.body ?? "").trim();
  const tags = Array.isArray(payload?.tags) ? payload.tags : [];
  const cleanTags = Array.from(new Set(tags.map(normalizeTag).filter(Boolean)));

  if (!id) throw new Error("id が不正です");
  if (!body) throw new Error("本文が空です");

  await ensureDataDir();

  const files = await collectDateFiles();

  for (const p of files) {
    let text = "";
    try {
      text = await fs.promises.readFile(p, "utf8");
    } catch {
      continue;
    }

    const { changed, nextText } = updateEntryInText(text, id, body, cleanTags);
    if (!changed) continue;

    await fs.promises.writeFile(p, nextText, "utf8");
    return { updated: true };
  }

  return { updated: false };
}

module.exports = {
  getDataDir,
  setDataDir,
  getAiSettings,
  setAiSettings,
  listEntries,
  addEntry,
  saveImage,
  deleteEntry,
  updateEntry,
  syncPull,
  syncBackup
};
