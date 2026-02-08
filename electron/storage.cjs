const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { app } = require("electron");

const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const SETTINGS_FILE = "acta-settings.json";

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
}

function getDataDir() {
  const s = loadSettings();
  const dir = typeof s.dataDir === "string" ? s.dataDir.trim() : "";
  return dir ? dir : getDefaultDataDir();
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

async function fileExists(p) {
  try {
    await fs.promises.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
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

async function listEntries() {
  await ensureDataDir();

  let names = [];
  try {
    names = await fs.promises.readdir(getDataDir());
  } catch {
    return [];
  }

  const files = names.filter((n) => DATE_FILE_RE.test(n)).sort();
  const entries = [];

  for (const file of files) {
    const date = file.slice(0, 10);
    const p = path.join(getDataDir(), file);
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
  const filePath = path.join(getDataDir(), `${date}.md`);
  const exists = await fileExists(filePath);

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

module.exports = {
  getDataDir,
  setDataDir,
  listEntries,
  addEntry
};
