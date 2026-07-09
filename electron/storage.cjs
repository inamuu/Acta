const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app } = require("electron");

const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.md$/;
const POSTS_DIR = "posts";
const IMAGES_DIR = "images";
const PROJECTS_DIR = "projects";
const PROJECT_FILE = "project.json";
const PROJECT_KNOWLEDGE_FILE = "knowledge.md";
const PROJECT_TASK_STATUSES = new Set(["Inbox", "InProgress", "Waiting", "Done"]);
const TODO_TAG = "ToDo";
const SETTINGS_FILE = "acta-settings.json";
const DATA_DIR_SETTINGS_FILE = "settings.json";
const KNOWLEDGE_DB_FILE = "knowledge-index.sqlite";
const KNOWLEDGE_STATE_FILE = "knowledge-index-state.json";
const KNOWLEDGE_SITE_DIR = "wiki";
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

function sqlQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function escapeLike(value) {
  return String(value ?? "").replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function splitSearchTerms(query) {
  return String(query ?? "")
    .trim()
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
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

function getKnowledgeDbPath() {
  return path.join(getDataDir(), KNOWLEDGE_DB_FILE);
}

function getKnowledgeStatePath() {
  return path.join(getDataDir(), KNOWLEDGE_STATE_FILE);
}

function getKnowledgeSiteDir() {
  return path.join(getDataDir(), KNOWLEDGE_SITE_DIR);
}

function getKnowledgeSitePath() {
  return path.join(getKnowledgeSiteDir(), "index.html");
}

function getProjectsDir() {
  return path.join(getDataDir(), PROJECTS_DIR);
}

function slugifyProjectName(name) {
  const base = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^0-9a-z_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || `project-${Date.now()}`;
}

function normalizeProjectTaskStatus(raw) {
  const value = String(raw ?? "").trim();
  return PROJECT_TASK_STATUSES.has(value) ? value : "Inbox";
}

function normalizeProjectTask(task) {
  const now = Date.now();
  const id = String(task?.id ?? "").trim() || crypto.randomUUID();
  const title = String(task?.title ?? "").trim();
  return {
    id,
    title,
    status: normalizeProjectTaskStatus(task?.status),
    createdAtMs: Number(task?.createdAtMs) || now,
    updatedAtMs: Number(task?.updatedAtMs) || now
  };
}

function parseProjectKnowledgeEntries(text, sourceFile) {
  return parseEntriesFromText(String(text ?? ""), "project", sourceFile).map((entry) => {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(entry.created ?? ""));
    return m ? { ...entry, date: m[1] } : entry;
  });
}

function normalizeProject(parsed, dirName, sourceDir, knowledgeText) {
  const now = Date.now();
  const name = String(parsed?.name ?? "").trim() || dirName;
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks.map(normalizeProjectTask).filter((task) => task.title) : [];
  const knowledgePath = path.join(sourceDir, PROJECT_KNOWLEDGE_FILE);
  return {
    id: String(parsed?.id ?? "").trim() || dirName,
    name,
    dirName,
    createdAtMs: Number(parsed?.createdAtMs) || now,
    updatedAtMs: Number(parsed?.updatedAtMs) || now,
    archivedAtMs: Number(parsed?.archivedAtMs) || 0,
    issueUrl: String(parsed?.issueUrl ?? "").trim(),
    tasks,
    knowledgeEntries: parseProjectKnowledgeEntries(knowledgeText, knowledgePath),
    sourceDir
  };
}

async function ensureUniqueProjectDirName(name) {
  const projectsDir = getProjectsDir();
  const slug = slugifyProjectName(name);
  let candidate = slug;
  let i = 2;
  while (await fileExists(path.join(projectsDir, candidate))) {
    candidate = `${slug}-${i}`;
    i += 1;
  }
  return candidate;
}

function buildDefaultAiInstruction(dataDir) {
  const dir = String(dataDir ?? "").trim() || getDefaultDataDir();
  return [
    `<data>${dir}</data> の中身を読み込んでください。`,
    "検索や調査を求められた場合は、必要に応じて data 直下の knowledge-index.sqlite を SQLite で検索してください。Wiki 形式で俯瞰したい場合は wiki/index.html も参照できます。",
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

function runSqlite(dbPath, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [dbPath], {
      cwd: getDataDir(),
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk ?? "");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk ?? "");
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `sqlite3 exited with code ${code}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

async function runSqliteJson(dbPath, sql) {
  const out = await runSqlite(dbPath, `.mode json\n${sql}\n`);
  const text = String(out ?? "").trim();
  if (!text) return [];
  const parsed = safeJsonParse(text);
  return Array.isArray(parsed) ? parsed : [];
}

async function initKnowledgeDb(dbPath) {
  await fs.promises.mkdir(path.dirname(dbPath), { recursive: true });
  await runSqlite(
    dbPath,
    [
      "PRAGMA journal_mode=WAL;",
      "PRAGMA synchronous=NORMAL;",
      "CREATE TABLE IF NOT EXISTS entries (",
      "  id TEXT PRIMARY KEY,",
      "  date TEXT NOT NULL,",
      "  created TEXT NOT NULL,",
      "  created_at_ms INTEGER NOT NULL,",
      "  tags TEXT NOT NULL,",
      "  body TEXT NOT NULL,",
      "  source_file TEXT NOT NULL,",
      "  source_rel TEXT NOT NULL",
      ");",
      "CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);",
      "CREATE INDEX IF NOT EXISTS idx_entries_created_at_ms ON entries(created_at_ms);",
      "CREATE INDEX IF NOT EXISTS idx_entries_source_rel ON entries(source_rel);",
      "CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(id UNINDEXED, body, tags, tokenize='trigram');"
    ].join("\n")
  );
}

async function loadKnowledgeState() {
  const statePath = getKnowledgeStatePath();
  const raw = await readTextFileIfExists(statePath);
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return { version: 1, files: {} };
  const files = parsed.files && typeof parsed.files === "object" ? parsed.files : {};
  return { version: 1, files };
}

async function readTextFileIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function getFileStateForStat(stat) {
  return {
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs)
  };
}

function fileStateEquals(a, b) {
  return Boolean(a && b && Number(a.size) === Number(b.size) && Number(a.mtimeMs) === Number(b.mtimeMs));
}

function buildEntryInsertSql(entry) {
  const tagsText = (entry.tags || []).join(", ");
  return [
    "INSERT OR REPLACE INTO entries (id, date, created, created_at_ms, tags, body, source_file, source_rel) VALUES (",
    [
      sqlQuote(entry.id),
      sqlQuote(entry.date),
      sqlQuote(entry.created),
      Number(entry.createdAtMs || 0),
      sqlQuote(tagsText),
      sqlQuote(entry.body),
      sqlQuote(entry.sourceFile),
      sqlQuote(getRelativeDataPath(entry.sourceFile))
    ].join(", "),
    ");",
    `INSERT INTO entries_fts (id, body, tags) VALUES (${sqlQuote(entry.id)}, ${sqlQuote(entry.body)}, ${sqlQuote(tagsText)});`
  ].join("");
}

async function rebuildKnowledgeIndex() {
  await ensureDataDir();
  await migrateDateFilesToPostDirs();

  const dbPath = getKnowledgeDbPath();
  const statePath = getKnowledgeStatePath();
  await initKnowledgeDb(dbPath);

  const state = await loadKnowledgeState();
  const files = await collectDateFiles();
  const nextFiles = {};
  const fileSet = new Set();
  const changed = [];

  for (const p of files) {
    const rel = getRelativeDataPath(p);
    fileSet.add(rel);
    const stat = await fs.promises.stat(p);
    const nextState = getFileStateForStat(stat);
    nextFiles[rel] = nextState;
    if (!fileStateEquals(state.files[rel], nextState)) {
      changed.push(p);
    }
  }

  const deletedRels = Object.keys(state.files || {}).filter((rel) => !fileSet.has(rel));
  let indexedEntries = 0;
  const sqlParts = ["BEGIN;"];

  for (const rel of deletedRels) {
    sqlParts.push(`DELETE FROM entries_fts WHERE id IN (SELECT id FROM entries WHERE source_rel = ${sqlQuote(rel)});`);
    sqlParts.push(`DELETE FROM entries WHERE source_rel = ${sqlQuote(rel)};`);
  }

  for (const p of changed) {
    const rel = getRelativeDataPath(p);
    sqlParts.push(`DELETE FROM entries_fts WHERE id IN (SELECT id FROM entries WHERE source_rel = ${sqlQuote(rel)});`);
    sqlParts.push(`DELETE FROM entries WHERE source_rel = ${sqlQuote(rel)};`);

    const date = path.basename(p).slice(0, 10);
    const text = await fs.promises.readFile(p, "utf8");
    const entries = parseEntriesFromText(text, date, p);
    indexedEntries += entries.length;
    for (const entry of entries) {
      sqlParts.push(buildEntryInsertSql(entry));
    }
  }

  sqlParts.push("COMMIT;");
  if (changed.length > 0 || deletedRels.length > 0) {
    await runSqlite(dbPath, sqlParts.join("\n"));
  }

  const totalRows = await runSqliteJson(dbPath, "SELECT COUNT(*) AS count FROM entries;");
  const totalEntries = Number(totalRows[0]?.count ?? 0);
  const indexedAtMs = Date.now();
  await fs.promises.writeFile(
    statePath,
    JSON.stringify(
      {
        version: 1,
        indexedAtMs,
        dbPath,
        files: nextFiles
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    ok: true,
    dbPath,
    statePath,
    indexedAtMs,
    scannedFiles: files.length,
    changedFiles: changed.length,
    deletedFiles: deletedRels.length,
    indexedEntries,
    totalEntries,
    detail: `${changed.length} files updated, ${deletedRels.length} files removed, ${totalEntries} entries indexed`
  };
}

async function searchKnowledgeIndex(payload) {
  await ensureDataDir();
  const dbPath = getKnowledgeDbPath();
  if (!(await fileExists(dbPath))) {
    return { query: String(payload?.query ?? ""), items: [] };
  }

  await initKnowledgeDb(dbPath);
  const query = String(payload?.query ?? "").trim();
  const limit = Math.max(1, Math.min(100, Number(payload?.limit) || 30));
  const terms = splitSearchTerms(query);
  const excludeTags = parseTags(Array.isArray(payload?.excludeTags) ? payload.excludeTags.join(",") : payload?.excludeTags || "");

  let where = "1 = 1";
  if (terms.length > 0) {
    where = terms
      .map((term) => {
        const needle = sqlQuote(`%${escapeLike(term).toLowerCase()}%`);
        return (
          "(lower(body) LIKE " +
          needle +
          " ESCAPE '\\' OR lower(tags) LIKE " +
          needle +
          " ESCAPE '\\' OR lower(date) LIKE " +
          needle +
          " ESCAPE '\\' OR lower(created) LIKE " +
          needle +
          " ESCAPE '\\')"
        );
      })
      .join(" AND ");
  }

  if (excludeTags.length > 0) {
    const tagWhere = excludeTags
      .map((tag) => {
        const needle = sqlQuote(`%,${escapeLike(tag).toLowerCase()},%`);
        return "(',' || replace(lower(tags), ', ', ',') || ',') NOT LIKE " + needle + " ESCAPE '\\'";
      })
      .join(" AND ");
    where = `(${where}) AND ${tagWhere}`;
  }

  const scoreExpr =
    terms.length === 0
      ? "0"
      : terms
          .map((term) => {
            const lit = sqlQuote(term.toLowerCase());
            return `(CASE WHEN instr(lower(tags), ${lit}) > 0 THEN 8 ELSE 0 END + CASE WHEN instr(lower(body), ${lit}) > 0 THEN 3 ELSE 0 END + CASE WHEN instr(lower(date || ' ' || created), ${lit}) > 0 THEN 1 ELSE 0 END)`;
          })
          .join(" + ");

  const rows = await runSqliteJson(
    dbPath,
    [
      "SELECT id, date, created, created_at_ms AS createdAtMs, tags, body, source_file AS sourceFile,",
      `${scoreExpr} AS score`,
      "FROM entries",
      `WHERE ${where}`,
      "ORDER BY score DESC, created_at_ms DESC",
      `LIMIT ${limit};`
    ].join("\n")
  );

  return {
    query,
    items: rows.map((row) => ({
      id: String(row.id ?? ""),
      title: makeArticleTitle({ body: row.body, date: row.date }),
      date: String(row.date ?? ""),
      created: String(row.created ?? ""),
      createdAtMs: Number(row.createdAtMs ?? 0),
      tags: parseTags(row.tags || ""),
      body: String(row.body ?? ""),
      sourceFile: String(row.sourceFile ?? ""),
      score: Number(row.score ?? 0)
    }))
  };
}

function makeArticleTitle(entry) {
  const body = String(entry.body ?? "").trim();
  const heading = body.split("\n").find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  if (heading) return heading.replace(/^#{1,3}\s+/, "").trim().slice(0, 80);

  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) return firstLine.replace(/^[-*]\s+/, "").slice(0, 80);
  return `${entry.date} の記録`;
}

function renderWikiBody(markdown) {
  const lines = normalizeNewlines(String(markdown ?? "")).split("\n");
  const out = [];
  let inList = false;
  let inPre = false;

  function closeList() {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  }

  for (const line of lines) {
    const raw = line;
    const trimmed = raw.trim();

    if (/^```/.test(trimmed)) {
      closeList();
      if (inPre) {
        out.push("</code></pre>");
      } else {
        out.push("<pre><code>");
      }
      inPre = !inPre;
      continue;
    }

    if (inPre) {
      out.push(escapeHtml(raw));
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length + 1);
      out.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }

    closeList();
    if (!trimmed) {
      out.push("");
      continue;
    }
    out.push(`<p>${escapeHtml(trimmed)}</p>`);
  }

  closeList();
  if (inPre) out.push("</code></pre>");
  return out.join("\n");
}

function buildKnowledgeSiteHtml(entries, generatedAtMs) {
  const articles = entries.map((entry) => ({
    ...entry,
    tags: parseTags(entry.tags || ""),
    title: makeArticleTitle(entry)
  }));
  const tagCounts = new Map();
  const dateCounts = new Map();
  for (const entry of articles) {
    dateCounts.set(entry.date, (dateCounts.get(entry.date) || 0) + 1);
    for (const tag of entry.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const datesAsc = Array.from(dateCounts.keys()).sort();
  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => {
      if (a[1] !== b[1]) return b[1] - a[1];
      return String(a[0]).localeCompare(String(b[0]), "ja");
    })
    .slice(0, 30);
  const recentArticles = articles.slice(0, 12);
  const activeDates = Array.from(dateCounts.entries())
    .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
    .slice(0, 14);
  const summaryHtml = `<section class="summaryGrid">
        <div class="summaryBox">
          <h2>Overview</h2>
          <dl>
            <div><dt>Entries</dt><dd>${articles.length}</dd></div>
            <div><dt>Tags</dt><dd>${tagCounts.size}</dd></div>
            <div><dt>Period</dt><dd>${escapeHtml(datesAsc[0] || "-")} - ${escapeHtml(datesAsc[datesAsc.length - 1] || "-")}</dd></div>
          </dl>
        </div>
        <div class="summaryBox">
          <h2>Recent Entries</h2>
          <ul>${recentArticles
            .map((entry) => `<li><a href="#${escapeHtml(entry.id)}">${escapeHtml(entry.title)}</a><small>${escapeHtml(entry.date)}</small></li>`)
            .join("")}</ul>
        </div>
        <div class="summaryBox">
          <h2>Top Tags</h2>
          <div class="summaryTags">${topTags
            .map(([tag, count]) => `<span>${escapeHtml(tag)} <small>${count}</small></span>`)
            .join("")}</div>
        </div>
        <div class="summaryBox">
          <h2>Recent Dates</h2>
          <ul>${activeDates
            .map(([date, count]) => `<li><span>${escapeHtml(date)}</span><small>${count} entries</small></li>`)
            .join("")}</ul>
        </div>
      </section>`;
  const navItems = articles
    .slice(0, 300)
    .map(
      (entry) =>
        `<a class="navItem" href="#${escapeHtml(entry.id)}"><span>${escapeHtml(entry.title)}</span><small>${escapeHtml(
          entry.date
        )}</small></a>`
    )
    .join("\n");
  const summaryArticle = `<article class="article summaryArticle" id="top" data-search="acta wiki summary top overview recent tags">
        <header class="articleHead">
          <h1>Summary</h1>
          <div class="meta">Generated ${escapeHtml(new Date(generatedAtMs).toLocaleString("ja-JP"))}</div>
        </header>
        ${summaryHtml}
      </article>`;
  const articleItems = articles
    .map(
      (entry) => `<article class="article" id="${escapeHtml(entry.id)}" data-search="${escapeHtml(
        `${entry.title} ${entry.body} ${entry.tags.join(" ")} ${entry.date}`.toLowerCase()
      )}">
        <header class="articleHead">
          <h1>${escapeHtml(entry.title)}</h1>
          <div class="meta">${escapeHtml(entry.created || entry.date)} / ${escapeHtml(entry.id)}</div>
          ${
            entry.tags.length > 0
              ? `<div class="tags">${entry.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>`
              : ""
          }
        </header>
        <section class="body">${renderWikiBody(entry.body)}</section>
      </article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Acta Wiki</title>
  <style>
    :root { color-scheme: light; --line: #a2a9b1; --link: #36c; --muted: #54595d; --bg: #fff; --soft: #f8f9fa; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", sans-serif; color: #202122; background: var(--bg); }
    .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
    .side { border-right: 1px solid var(--line); background: var(--soft); padding: 18px 14px; position: sticky; top: 0; height: 100vh; overflow: auto; }
    .brand { font-family: Georgia, serif; font-size: 28px; margin: 0 0 12px; }
    .search { width: 100%; border: 1px solid var(--line); border-radius: 2px; padding: 8px 10px; background: #fff; }
    .count { color: var(--muted); margin: 10px 0 16px; }
    .navItem { display: block; color: var(--link); text-decoration: none; padding: 7px 2px; border-bottom: 1px solid #eaecf0; }
    .navItem small { display: block; color: var(--muted); }
    .content { max-width: 1040px; padding: 28px 38px 80px; }
    .siteHead { border-bottom: 1px solid var(--line); margin-bottom: 24px; }
    .siteHead h1 { font-family: Georgia, serif; font-size: 38px; font-weight: 400; margin: 0 0 4px; }
    .siteHead p { color: var(--muted); margin: 0 0 14px; }
    .article { border-bottom: 1px solid var(--line); padding: 18px 0 30px; }
    .article.isHidden { display: none; }
    .articleHead h1 { font-family: Georgia, serif; font-size: 30px; font-weight: 400; border-bottom: 1px solid var(--line); margin: 0 0 4px; }
    .meta { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
    .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0 12px; }
    .tags span { background: #eaecf0; border: 1px solid #c8ccd1; padding: 1px 7px; border-radius: 2px; color: #202122; }
    .summaryGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-top: 16px; }
    .summaryBox { border: 1px solid #a2a9b1; background: #f8f9fa; padding: 14px 16px; }
    .summaryBox h2 { font-family: Georgia, serif; font-weight: 400; font-size: 22px; margin: 0 0 10px; border-bottom: 1px solid #c8ccd1; }
    .summaryBox dl { margin: 0; }
    .summaryBox dl div { display: grid; grid-template-columns: 90px 1fr; gap: 10px; padding: 4px 0; }
    .summaryBox dt { color: var(--muted); }
    .summaryBox dd { margin: 0; font-weight: 600; }
    .summaryBox ul { margin: 0; padding-left: 18px; }
    .summaryBox li { margin: 4px 0; }
    .summaryBox li small { display: block; color: var(--muted); }
    .summaryTags { display: flex; flex-wrap: wrap; gap: 6px; }
    .summaryTags span { border: 1px solid #c8ccd1; background: #fff; padding: 2px 7px; }
    .summaryTags small { color: var(--muted); }
    .body h2, .body h3, .body h4 { border-bottom: 1px solid #eaecf0; font-weight: 400; margin-top: 20px; }
    .body pre { background: var(--soft); border: 1px solid #eaecf0; padding: 10px; overflow: auto; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } .side { position: static; height: auto; } .content { padding: 22px 18px 60px; } .summaryGrid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="side">
      <div class="brand">Acta Wiki</div>
      <input id="q" class="search" placeholder="記事を検索" />
      <div id="count" class="count">${articles.length} entries</div>
      <nav><a class="navItem" href="#top"><span>Summary</span><small>Top page</small></a>${navItems}</nav>
    </aside>
    <main class="content">
      <header class="siteHead">
        <h1>Acta Wiki</h1>
        <p>Generated ${escapeHtml(new Date(generatedAtMs).toLocaleString("ja-JP"))} from ${articles.length} indexed posts.</p>
      </header>
      ${summaryArticle}
      ${articleItems}
    </main>
  </div>
  <script>
    const articles = Array.from(document.querySelectorAll(".article"));
    const count = document.getElementById("count");
    document.getElementById("q").addEventListener("input", (event) => {
      const terms = String(event.target.value || "").trim().toLowerCase().split(/\\s+/).filter(Boolean);
      let visible = 0;
      for (const article of articles) {
        const haystack = article.dataset.search || "";
        const ok = terms.every((term) => haystack.includes(term));
        article.classList.toggle("isHidden", !ok);
        if (ok) visible++;
      }
      count.textContent = visible + " / " + articles.length + " entries";
    });
    window.__ACTA_WIKI_ENTRIES__ = ${escapeScriptJson(articles.map(({ id, date, created, title, tags }) => ({ id, date, created, title, tags })))};
  </script>
</body>
</html>`;
}

async function generateKnowledgeSite() {
  await ensureDataDir();
  const dbPath = getKnowledgeDbPath();
  if (!(await fileExists(dbPath))) {
    await rebuildKnowledgeIndex();
  }

  const rows = await runSqliteJson(
    dbPath,
    "SELECT id, date, created, created_at_ms AS createdAtMs, tags, body, source_file AS sourceFile FROM entries ORDER BY date DESC, created_at_ms DESC;"
  );
  const generatedAtMs = Date.now();
  const siteDir = getKnowledgeSiteDir();
  const sitePath = getKnowledgeSitePath();
  await fs.promises.mkdir(siteDir, { recursive: true });
  await fs.promises.writeFile(sitePath, buildKnowledgeSiteHtml(rows, generatedAtMs), "utf8");

  return {
    ok: true,
    sitePath,
    entryCount: rows.length,
    generatedAtMs
  };
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
    const commitRes = await runGitCommand(["commit", "--no-gpg-sign", "-m", "backup"]);
    if (commitRes.code !== 0) {
      return buildSyncResult(
        false,
        commitRes.stderr || commitRes.stdout || "git commit に失敗しました",
        'git commit --no-gpg-sign -m "backup"'
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

async function readProjectByDirName(dirName) {
  const cleanDirName = String(dirName ?? "").trim();
  if (!cleanDirName) return null;
  const sourceDir = path.join(getProjectsDir(), cleanDirName);
  const projectPath = path.join(sourceDir, PROJECT_FILE);
  const knowledgePath = path.join(sourceDir, PROJECT_KNOWLEDGE_FILE);
  const raw = await readTextFileIfExists(projectPath);
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") return null;
  let knowledge = await readTextFileIfExists(knowledgePath);
  if (knowledge.trim() && parseEntriesFromText(knowledge, "project", knowledgePath).length === 0) {
    const createdAtMs = Number(parsed.updatedAtMs) || Date.now();
    knowledge = formatEntryBlock({
      id: crypto.randomUUID(),
      created: formatDateTime(new Date(createdAtMs)),
      createdAtMs,
      tags: [],
      body: knowledge
    });
    await fs.promises.writeFile(knowledgePath, knowledge, "utf8");
  }
  return normalizeProject(parsed, cleanDirName, sourceDir, knowledge);
}

async function writeProject(project) {
  const sourceDir = path.join(getProjectsDir(), project.dirName);
  await fs.promises.mkdir(sourceDir, { recursive: true });
  const now = Date.now();
  const next = {
    id: project.id,
    name: project.name,
    dirName: project.dirName,
    createdAtMs: Number(project.createdAtMs) || now,
    updatedAtMs: now,
    archivedAtMs: Number(project.archivedAtMs) || 0,
    issueUrl: String(project.issueUrl ?? "").trim(),
    tasks: (project.tasks || []).map(normalizeProjectTask).filter((task) => task.title)
  };
  await fs.promises.writeFile(path.join(sourceDir, PROJECT_FILE), JSON.stringify(next, null, 2), "utf8");
  const knowledgePath = path.join(sourceDir, PROJECT_KNOWLEDGE_FILE);
  if (!(await fileExists(knowledgePath))) {
    const legacyKnowledge = typeof project.knowledge === "string" ? String(project.knowledge ?? "").trim() : "";
    if (legacyKnowledge) {
      const createdAtMs = Date.now();
      await fs.promises.writeFile(
        knowledgePath,
        formatEntryBlock({
          id: crypto.randomUUID(),
          created: formatDateTime(new Date(createdAtMs)),
          createdAtMs,
          tags: [],
          body: legacyKnowledge
        }),
        "utf8"
      );
    } else {
      await fs.promises.writeFile(knowledgePath, "", "utf8");
    }
  }
  const knowledgeText = await readTextFileIfExists(knowledgePath);
  return normalizeProject(next, project.dirName, sourceDir, knowledgeText);
}

async function listProjects() {
  await ensureDataDir();
  await fs.promises.mkdir(getProjectsDir(), { recursive: true });
  const entries = await fs.promises.readdir(getProjectsDir(), { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const project = await readProjectByDirName(entry.name);
    if (project) projects.push(project);
  }
  projects.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return projects;
}

async function getProjectById(id) {
  const projectId = String(id ?? "").trim();
  if (!projectId) throw new Error("projectId が不正です");
  const projects = await listProjects();
  const project = projects.find((item) => item.id === projectId || item.dirName === projectId);
  if (!project) throw new Error("プロジェクトが見つかりません");
  return project;
}

async function createProject(payload) {
  const name = String(payload?.name ?? "").trim();
  if (!name) throw new Error("プロジェクト名が空です");
  await ensureDataDir();
  const dirName = await ensureUniqueProjectDirName(name);
  const now = Date.now();
  return writeProject({
    id: crypto.randomUUID(),
    name,
    dirName,
    createdAtMs: now,
    updatedAtMs: now,
    archivedAtMs: 0,
    issueUrl: "",
    tasks: [],
    knowledge: "",
    sourceDir: path.join(getProjectsDir(), dirName)
  });
}

async function saveProject(payload) {
  const project = await getProjectById(payload?.id);
  return writeProject({
    ...project,
    tasks: Array.isArray(payload?.tasks) ? payload.tasks : project.tasks
  });
}

async function setProjectArchived(payload) {
  const project = await getProjectById(payload?.projectId);
  return writeProject({
    ...project,
    archivedAtMs: payload?.archived ? Date.now() : 0
  });
}

async function renameProject(payload) {
  const project = await getProjectById(payload?.projectId);
  const name = String(payload?.name ?? "").trim();
  if (!name) throw new Error("プロジェクト名が空です");
  return writeProject({
    ...project,
    name
  });
}

async function deleteProject(payload) {
  const project = await getProjectById(payload?.projectId);
  const projectsDir = path.resolve(getProjectsDir());
  const targetDir = path.resolve(project.sourceDir);
  const rel = path.relative(projectsDir, targetDir);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("削除対象が不正です");
  }
  await fs.promises.rm(targetDir, { recursive: true, force: true });
  return { deleted: true };
}

async function setProjectIssueUrl(payload) {
  const project = await getProjectById(payload?.projectId);
  const issueUrl = String(payload?.issueUrl ?? "").trim();
  if (issueUrl) {
    let parsed;
    try {
      parsed = new URL(issueUrl);
    } catch {
      throw new Error("issueリンクのURLが不正です");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("issueリンクは http または https のURLを指定してください");
    }
  }
  return writeProject({
    ...project,
    issueUrl
  });
}

async function addProjectTask(payload) {
  const project = await getProjectById(payload?.projectId);
  const title = String(payload?.title ?? "").trim();
  if (!title) throw new Error("タスク名が空です");
  const now = Date.now();
  project.tasks.unshift({
    id: crypto.randomUUID(),
    title,
    status: normalizeProjectTaskStatus(payload?.status),
    createdAtMs: now,
    updatedAtMs: now
  });
  return writeProject(project);
}

async function moveProjectTask(payload) {
  const project = await getProjectById(payload?.projectId);
  const taskId = String(payload?.taskId ?? "").trim();
  const status = normalizeProjectTaskStatus(payload?.status);
  let changed = false;
  let movedTask = null;
  project.tasks = project.tasks.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    movedTask = { ...task, status, updatedAtMs: Date.now() };
    return movedTask;
  });
  if (!changed) throw new Error("タスクが見つかりません");
  const written = await writeProject(project);
  if (!written.archivedAtMs && movedTask && (status === "InProgress" || status === "Waiting")) {
    await upsertProjectTasksToLatestTodo(written, [movedTask]);
  }
  return written;
}

async function renameProjectTask(payload) {
  const project = await getProjectById(payload?.projectId);
  const taskId = String(payload?.taskId ?? "").trim();
  const title = String(payload?.title ?? "").trim();
  if (!taskId) throw new Error("taskId が不正です");
  if (!title) throw new Error("タスク名が空です");

  let changed = false;
  project.tasks = project.tasks.map((task) => {
    if (task.id !== taskId) return task;
    changed = true;
    return { ...task, title, updatedAtMs: Date.now() };
  });
  if (!changed) throw new Error("タスクが見つかりません");
  return writeProject(project);
}

async function deleteProjectTask(payload) {
  const project = await getProjectById(payload?.projectId);
  const taskId = String(payload?.taskId ?? "").trim();
  if (!taskId) throw new Error("taskId が不正です");
  const before = project.tasks.length;
  project.tasks = project.tasks.filter((task) => task.id !== taskId);
  if (project.tasks.length === before) throw new Error("タスクが見つかりません");
  return writeProject(project);
}

async function addProjectKnowledgeEntry(payload) {
  const project = await getProjectById(payload?.projectId);
  const body = String(payload?.body ?? "").trim();
  if (!body) throw new Error("本文が空です");

  const knowledgePath = path.join(project.sourceDir, PROJECT_KNOWLEDGE_FILE);
  await fs.promises.mkdir(project.sourceDir, { recursive: true });
  const now = new Date();
  const createdAtMs = Date.now();
  await fs.promises.appendFile(
    knowledgePath,
    formatEntryBlock({
      id: crypto.randomUUID(),
      created: formatDateTime(now),
      createdAtMs,
      tags: [],
      body
    }),
    "utf8"
  );
  return getProjectById(project.id);
}

async function updateProjectKnowledgeEntry(payload) {
  const project = await getProjectById(payload?.projectId);
  const entryId = String(payload?.entryId ?? "").trim();
  const body = String(payload?.body ?? "").trim();
  if (!entryId) throw new Error("entryId が不正です");
  if (!body) throw new Error("本文が空です");

  const knowledgePath = path.join(project.sourceDir, PROJECT_KNOWLEDGE_FILE);
  const text = await readTextFileIfExists(knowledgePath);
  const { changed, nextText } = updateEntryInText(text, entryId, body, []);
  if (!changed) throw new Error("ナレッジ投稿が見つかりません");
  await fs.promises.writeFile(knowledgePath, nextText, "utf8");
  return getProjectById(project.id);
}

async function deleteProjectKnowledgeEntry(payload) {
  const project = await getProjectById(payload?.projectId);
  const entryId = String(payload?.entryId ?? "").trim();
  if (!entryId) throw new Error("entryId が不正です");

  const knowledgePath = path.join(project.sourceDir, PROJECT_KNOWLEDGE_FILE);
  const text = await readTextFileIfExists(knowledgePath);
  const { changed, nextText } = removeEntryFromText(text, entryId);
  if (!changed) throw new Error("ナレッジ投稿が見つかりません");
  await fs.promises.writeFile(knowledgePath, nextText, "utf8");
  return getProjectById(project.id);
}

function buildTodoBodyFromProjectGroups(groups, heading) {
  const lines = [`# ${heading}`];
  for (const group of groups) {
    if (!group.tasks.length) continue;
    lines.push(`- ${group.name}`);
    for (const task of group.tasks) {
      lines.push(`  - [${markerFromProjectTaskStatus(task.status)}] ${task.title}`);
    }
  }
  return lines.join("\n").trimEnd();
}

function markerFromProjectTaskStatus(status) {
  switch (normalizeProjectTaskStatus(status)) {
    case "InProgress":
      return "-";
    case "Waiting":
      return "R";
    case "Done":
      return "x";
    case "Inbox":
    default:
      return " ";
  }
}

function escapeRegExp(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTodoTaskTitle(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function findProjectTodoGroup(lines, projectName) {
  const name = String(projectName ?? "").trim();
  if (!name) return null;

  const headingRe = new RegExp(`^(-\\s+)${escapeRegExp(name)}\\s*$`);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!headingRe.test(line)) continue;

    let end = i + 1;
    while (end < lines.length && !/^\S/.test(lines[end] ?? "")) end += 1;
    return { start: i, end };
  }

  return null;
}

function upsertProjectTasksInTodoBody(body, projectName, tasks) {
  const normalizedTasks = (tasks || [])
    .map((task) => ({
      title: normalizeTodoTaskTitle(task?.title),
      marker: markerFromProjectTaskStatus(task?.status)
    }))
    .filter((task) => task.title);
  if (normalizedTasks.length === 0) return String(body ?? "").trimEnd();

  const lines = normalizeNewlines(String(body ?? "")).trimEnd().split("\n");
  const group = findProjectTodoGroup(lines, projectName);
  if (!group) {
    return [
      ...lines.filter((line, index) => !(lines.length === 1 && index === 0 && line === "")),
      `- ${projectName}`,
      ...normalizedTasks.map((task) => `  - [${task.marker}] ${task.title}`)
    ].join("\n");
  }

  const titleToLine = new Map();
  for (let i = group.start + 1; i < group.end; i += 1) {
    const line = lines[i] ?? "";
    const match = /^(\s*[-+*]\s*)\[([ xX\-\/rR])\](\s+)(.*?)\s*$/.exec(line);
    if (!match) continue;
    const title = normalizeTodoTaskTitle(match[4]);
    if (title && !titleToLine.has(title)) titleToLine.set(title, i);
  }

  const appendLines = [];
  for (const task of normalizedTasks) {
    const existingLine = titleToLine.get(task.title);
    if (typeof existingLine === "number") {
      lines[existingLine] = lines[existingLine].replace(
        /^(\s*[-+*]\s*)\[([ xX\-\/rR])\](\s+)/,
        `$1[${task.marker}]$3`
      );
      continue;
    }
    appendLines.push(`  - [${task.marker}] ${task.title}`);
  }

  if (appendLines.length > 0) {
    lines.splice(group.end, 0, ...appendLines);
  }

  return lines.join("\n").trimEnd();
}

async function addTodoEntry(body) {
  return addEntry({ body, tags: [TODO_TAG] });
}

async function appendToTodayTodo(body) {
  const today = formatDate(new Date());
  const entries = await listEntries();
  const current = entries.find((entry) => entry.date === today && entry.tags.includes(TODO_TAG));
  if (!current) return addTodoEntry(body);

  const separator = current.body.trimEnd() ? "\n" : "";
  const nextBody = `${current.body.trimEnd()}${separator}${String(body ?? "").replace(/^#\s+ToDo\s*\n*/i, "").trim()}`;
  const res = await updateEntry({ id: current.id, body: nextBody, tags: current.tags });
  if (!res.updated) throw new Error("今日のToDo更新に失敗しました");
  return { ...current, body: nextBody };
}

async function upsertProjectTasksToLatestTodo(project, tasks) {
  const targetTasks = (tasks || []).filter(
    (task) => task?.title && (task.status === "InProgress" || task.status === "Waiting")
  );
  if (!targetTasks.length) return null;

  const entries = await listEntries();
  const current = entries.find((entry) => isTodoEntry(entry));
  if (!current) {
    return addTodoEntry(buildTodoBodyFromProjectGroups([{ name: project.name, tasks: targetTasks }], "ToDo"));
  }

  const nextBody = upsertProjectTasksInTodoBody(current.body, project.name, targetTasks);
  if (nextBody === current.body.trimEnd()) return { ...current, body: nextBody };

  const tags = Array.from(new Set([...(current.tags || []), TODO_TAG]));
  const res = await updateEntry({ id: current.id, body: nextBody, tags });
  if (!res.updated) throw new Error("最新のToDo更新に失敗しました");
  return { ...current, body: nextBody, tags };
}

function isTodoEntry(entry) {
  if ((entry.tags || []).includes(TODO_TAG)) return true;
  return /^#\s*todo\b/im.test(String(entry.body ?? ""));
}

async function appendProjectInProgressToTodayTodo(payload) {
  const project = await getProjectById(payload?.projectId);
  if (project.archivedAtMs) throw new Error("アーカイブ済みプロジェクトはToDoに追記できません");
  const tasks = project.tasks.filter((task) => task.status === "InProgress" || task.status === "Waiting");
  if (tasks.length === 0) throw new Error("InProgress / Waiting のタスクがありません");
  return upsertProjectTasksToLatestTodo(project, tasks);
}

async function createTodoFromProjects() {
  const projects = await listProjects();
  const groups = projects
    .filter((project) => !project.archivedAtMs)
    .map((project) => ({
      name: project.name,
      tasks: project.tasks.filter((task) => task.status === "InProgress" || task.status === "Waiting")
    }))
    .filter((group) => group.tasks.length > 0);
  if (groups.length === 0) throw new Error("InProgress / Waiting のプロジェクトタスクがありません");
  return addTodoEntry(buildTodoBodyFromProjectGroups(groups, "ToDo"));
}

async function copyPreviousTodo() {
  const entries = await listEntries();
  const today = formatDate(new Date());
  const previous = entries.find((entry) => entry.date < today && isTodoEntry(entry));
  if (!previous) throw new Error("コピーできる前回のToDoがありません");
  return addTodoEntry(previous.body);
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
  listProjects,
  createProject,
  saveProject,
  setProjectArchived,
  renameProject,
  deleteProject,
  setProjectIssueUrl,
  addProjectTask,
  moveProjectTask,
  renameProjectTask,
  deleteProjectTask,
  addProjectKnowledgeEntry,
  updateProjectKnowledgeEntry,
  deleteProjectKnowledgeEntry,
  appendProjectInProgressToTodayTodo,
  createTodoFromProjects,
  copyPreviousTodo,
  rebuildKnowledgeIndex,
  searchKnowledgeIndex,
  generateKnowledgeSite,
  getKnowledgeSitePath,
  syncPull,
  syncBackup
};
