const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const storage = require("./storage.cjs");
const iconPath = path.join(__dirname, "assets", "icon.png");
const aiSessions = new Map();

function getAiSessionOrThrow(id) {
  const key = String(id ?? "").trim();
  if (!key) throw new Error("sessionId が不正です");

  const session = aiSessions.get(key);
  if (!session) throw new Error("AIセッションが見つかりません");
  return session;
}

function buildAiPrompt(session, input) {
  const recent = session.history.slice(-20);
  const lines = [];

  if (session.systemInstruction) {
    lines.push("# 事前指示");
    lines.push(session.systemInstruction);
    lines.push("");
  }

  if (recent.length > 0) {
    lines.push("# 会話履歴");
    for (const turn of recent) {
      lines.push(`ユーザー: ${turn.user}`);
      lines.push(`アシスタント: ${turn.assistant}`);
      lines.push("");
    }
  }

  lines.push("# 今回のユーザー入力");
  lines.push(input);
  lines.push("");
  lines.push("日本語で回答してください。");

  return lines.join("\n");
}

async function readFileIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function detectAiCliKind(cliPath) {
  const binName = path.basename(String(cliPath ?? "")).toLowerCase();
  if (binName.includes("claude")) return "claude";
  return "codex";
}

function parseJsonLine(line) {
  const text = String(line ?? "").trim();
  if (!text || !text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function captureCodexThreadIdFromLine(session, line) {
  const event = parseJsonLine(line);
  if (!event) return;

  if (event.type === "thread.started") {
    const id = String(event.thread_id ?? "").trim();
    if (id) session.codexThreadId = id;
  }
}

function startAiSession(cliPath) {
  const binPath = String(cliPath ?? "").trim();
  if (!binPath) throw new Error("CLIパスが未設定です");

  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    cliPath: binPath,
    systemInstruction: "",
    needsBootstrap: true,
    codexThreadId: "",
    history: [],
    chunks: [],
    alive: true,
    busy: false,
    worker: null,
    exitCode: null,
    error: ""
  };
  aiSessions.set(sessionId, session);

  return { sessionId };
}

function runAiTurn(session, input) {
  const dataDir = storage.getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  let prompt = buildAiPrompt(session, input);
  const outPath = path.join(app.getPath("temp"), `acta-ai-${session.id}-${Date.now()}.txt`);
  const cliKind = detectAiCliKind(session.cliPath);
  let args = [];
  let useOutputFile = false;
  let parseThreadIdFromStdout = false;

  if (cliKind === "claude") {
    args = ["--print"];
  } else if (session.codexThreadId) {
    // Reuse remote thread state to avoid re-sending long local history each turn.
    args = ["exec", "resume", "--skip-git-repo-check", session.codexThreadId, "-"];
    prompt = input;
  } else {
    // First turn: create a thread and capture its id from JSON events.
    args = ["exec", "--skip-git-repo-check", "-C", dataDir, "--color", "never", "--json", "-o", outPath, "-"];
    useOutputFile = true;
    parseThreadIdFromStdout = true;
  }

  session.busy = true;
  session.exitCode = null;
  session.error = "";

  const child = spawn(session.cliPath, args, {
    cwd: dataDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env
    }
  });
  session.worker = child;

  let stdoutText = "";
  let stderrText = "";
  let stdoutPending = "";
  child.stdout?.on("data", (chunk) => {
    const text = String(chunk ?? "");
    stdoutText += text;
    if (!parseThreadIdFromStdout) return;

    stdoutPending += text;
    while (true) {
      const idx = stdoutPending.indexOf("\n");
      if (idx < 0) break;
      const line = stdoutPending.slice(0, idx);
      stdoutPending = stdoutPending.slice(idx + 1);
      captureCodexThreadIdFromLine(session, line);
    }
  });
  child.stderr?.on("data", (chunk) => {
    stderrText += String(chunk ?? "");
  });

  child.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    session.error = msg || "実行に失敗しました";
    session.chunks.push(`\n[エラー] ${session.error}\n`);
    session.busy = false;
    session.exitCode = 1;
    session.worker = null;
  });

  child.on("close", (code) => {
    void (async () => {
      if (parseThreadIdFromStdout && stdoutPending) {
        captureCodexThreadIdFromLine(session, stdoutPending);
      }

      let answer = "";
      if (useOutputFile) {
        answer = (await readFileIfExists(outPath)).trim();
        try {
          await fs.promises.unlink(outPath);
        } catch {
          // ignore
        }
      } else {
        answer = stdoutText.trim();
      }

      session.exitCode = typeof code === "number" ? code : null;
      session.busy = false;
      session.worker = null;

      if (!session.alive) return;

      if (session.exitCode === 0 && answer) {
        session.history.push({ user: input, assistant: answer });
        session.chunks.push(`${answer}\n`);
        return;
      }

      if (cliKind === "codex") {
        // If resume execution failed, retry from a fresh thread next turn.
        session.codexThreadId = "";
      }

      const fallback = answer || stderrText.trim() || stdoutText.trim();
      if (fallback) {
        session.chunks.push(`\n[実行ログ]\n${fallback}\n`);
      }
      if (session.exitCode !== 0) {
        session.chunks.push(`\n[AI実行失敗: code=${session.exitCode ?? "?"}]\n`);
      }
    })();
  });

  child.stdin.write(prompt);
  child.stdin.end();
}

function stopAiSession(sessionId) {
  const session = getAiSessionOrThrow(sessionId);
  session.alive = false;
  session.busy = false;

  if (session.worker) {
    try {
      session.worker.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  aiSessions.delete(session.id);
  return { stopped: true };
}

function readAiSession(sessionId) {
  const session = getAiSessionOrThrow(sessionId);
  const chunk = session.chunks.join("");
  session.chunks.length = 0;

  const res = {
    chunk,
    alive: session.alive,
    busy: Boolean(session.busy),
    exitCode: session.exitCode,
    error: session.error || undefined
  };
  return res;
}

function writeAiSessionInput(sessionId, input) {
  const session = getAiSessionOrThrow(sessionId);
  if (!session.alive) throw new Error("AIセッションは終了しています");
  if (session.busy) throw new Error("前回の応答を待ってから送信してください");

  const text = String(input ?? "");
  if (!text.trim()) return { sent: false };

  if (session.needsBootstrap) {
    session.systemInstruction = text;
    session.needsBootstrap = false;
    return { sent: true };
  }

  runAiTurn(session, text);
  return { sent: true };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#eef4ff",
    transparent: false,
    icon: iconPath,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  // Open links in the default browser (avoid navigating away inside the app).
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const current = win.webContents.getURL();
    if (url && current && url !== current) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  return win;
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.setIcon(iconPath);
  }

  ipcMain.handle("acta:getDataDir", async () => storage.getDataDir());
  ipcMain.handle("acta:getAiSettings", async () => storage.getAiSettings());
  ipcMain.handle("acta:saveAiSettings", async (_event, payload) => storage.setAiSettings(payload));
  ipcMain.handle("acta:chooseDataDir", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showOpenDialog(win, {
      title: "保存先フォルダを選択",
      properties: ["openDirectory", "createDirectory"]
    });

    if (res.canceled) {
      return { canceled: true, dataDir: storage.getDataDir() };
    }

    const dir = res.filePaths?.[0];
    if (!dir) {
      return { canceled: true, dataDir: storage.getDataDir() };
    }

    await storage.setDataDir(dir);
    return { canceled: false, dataDir: storage.getDataDir() };
  });
  ipcMain.handle("acta:listEntries", async () => storage.listEntries());
  ipcMain.handle("acta:addEntry", async (_event, payload) => storage.addEntry(payload));
  ipcMain.handle("acta:deleteEntry", async (_event, payload) => storage.deleteEntry(payload));
  ipcMain.handle("acta:updateEntry", async (_event, payload) => storage.updateEntry(payload));
  ipcMain.handle("acta:aiStartSession", async (_event, payload) => startAiSession(payload?.cliPath));
  ipcMain.handle("acta:aiSendInput", async (_event, payload) => writeAiSessionInput(payload?.sessionId, payload?.input));
  ipcMain.handle("acta:aiReadOutput", async (_event, payload) => readAiSession(payload?.sessionId));
  ipcMain.handle("acta:aiStopSession", async (_event, payload) => stopAiSession(payload?.sessionId));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const session of aiSessions.values()) {
    if (session.worker) {
      try {
        session.worker.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
  aiSessions.clear();
  if (process.platform !== "darwin") app.quit();
});
