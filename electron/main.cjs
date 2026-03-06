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

async function readFileIfExists(filePath) {
  try {
    return await fs.promises.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function makeSessionUpdate(kind, fields) {
  return {
    id: crypto.randomUUID(),
    kind,
    createdAtMs: Date.now(),
    ...fields
  };
}

function pushSessionUpdate(session, update) {
  session.updates.push(update);
}

function trimPreview(text, maxLen = 240) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function buildTurnSummary(ms, usage) {
  const parts = [];
  const duration = formatDurationMs(ms);
  if (duration) parts.push(duration);
  if (usage && typeof usage.output_tokens === "number") {
    parts.push(`出力 ${usage.output_tokens} tok`);
  }
  return parts.join(" / ");
}

function setSessionPhase(session, phase, label, detail = "") {
  const nextLabel = String(label ?? "").trim() || "待機中";
  const nextDetail = String(detail ?? "").trim();
  const unchanged =
    session.phase === phase && session.phaseLabel === nextLabel && session.phaseDetail === nextDetail;

  session.phase = phase;
  session.phaseLabel = nextLabel;
  session.phaseDetail = nextDetail;
  if (unchanged) return;

  const tone =
    phase === "error" ? "error" : phase === "done" ? "done" : phase === "thinking" || phase === "tool" ? "active" : "neutral";
  pushSessionUpdate(
    session,
    makeSessionUpdate("status", {
      label: nextLabel,
      detail: nextDetail || undefined,
      tone
    })
  );
}

function appendAssistantText(session, text) {
  const value = String(text ?? "");
  if (!value) return;
  session.currentAnswer += value;
  pushSessionUpdate(
    session,
    makeSessionUpdate("assistant", {
      text: value
    })
  );
}

function handleCodexItemText(session, item) {
  const nextText = typeof item?.text === "string" ? item.text : "";
  if (!nextText) return;

  const itemId = String(item?.id ?? "");
  const prevText = itemId ? session.itemTextState[itemId] || "" : "";
  const delta = itemId && nextText.startsWith(prevText) ? nextText.slice(prevText.length) : nextText;
  if (itemId) session.itemTextState[itemId] = nextText;
  appendAssistantText(session, delta);
}

function handleCodexEvent(session, event) {
  if (!event || typeof event !== "object") return;

  switch (event.type) {
    case "thread.started": {
      const id = String(event.thread_id ?? "").trim();
      if (id) session.codexThreadId = id;
      return;
    }
    case "turn.started": {
      session.turnStartedAtMs = Date.now();
      session.lastTurnDurationMs = null;
      session.lastTurnUsage = null;
      session.activeCommand = "";
      session.itemTextState = {};
      setSessionPhase(session, "thinking", "応答を考えています");
      return;
    }
    case "item.started": {
      const item = event.item ?? {};
      if (item.type === "command_execution") {
        const command = String(item.command ?? "").trim();
        session.activeCommand = command;
        setSessionPhase(session, "tool", "コマンドを実行しています", trimPreview(command, 120));
        pushSessionUpdate(
          session,
          makeSessionUpdate("command", {
            status: "started",
            command
          })
        );
        return;
      }
      if (item.type === "agent_message") {
        handleCodexItemText(session, item);
      }
      return;
    }
    case "item.completed": {
      const item = event.item ?? {};
      if (item.type === "command_execution") {
        const command = String(item.command ?? "").trim();
        const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
        pushSessionUpdate(
          session,
          makeSessionUpdate("command", {
            status: "completed",
            command,
            exitCode,
            output: trimPreview(item.aggregated_output)
          })
        );
        session.activeCommand = "";
        setSessionPhase(
          session,
          "thinking",
          "結果を取り込んでいます",
          trimPreview(command, 120) || undefined
        );
        return;
      }
      if (item.type === "agent_message") {
        handleCodexItemText(session, item);
      }
      return;
    }
    case "turn.completed": {
      if (session.turnStartedAtMs) {
        session.lastTurnDurationMs = Math.max(0, Date.now() - session.turnStartedAtMs);
      }
      session.lastTurnUsage = event.usage ?? null;
      session.activeCommand = "";
      session.itemTextState = {};
      setSessionPhase(
        session,
        "done",
        "応答が完了しました",
        buildTurnSummary(session.lastTurnDurationMs, session.lastTurnUsage)
      );
      return;
    }
    case "error": {
      const msg = String(event.message ?? event.error ?? "").trim();
      if (!msg) return;
      session.error = msg;
      setSessionPhase(session, "error", "CLI 実行エラー", trimPreview(msg));
      pushSessionUpdate(
        session,
        makeSessionUpdate("error", {
          text: msg
        })
      );
      return;
    }
    default:
      return;
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
    updates: [],
    alive: true,
    busy: false,
    worker: null,
    exitCode: null,
    error: "",
    phase: "idle",
    phaseLabel: "待機中",
    phaseDetail: "",
    activeCommand: "",
    turnStartedAtMs: null,
    lastTurnDurationMs: null,
    lastTurnUsage: null,
    currentAnswer: "",
    itemTextState: {}
  };
  aiSessions.set(sessionId, session);

  return { sessionId };
}

function runAiTurn(session, input) {
  const dataDir = storage.getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  let prompt = buildAiPrompt(session, input);
  const cliKind = detectAiCliKind(session.cliPath);
  const codexRunArgs = ["-s", "workspace-write", "-a", "never"];
  const outPath = cliKind === "codex" ? path.join(app.getPath("temp"), `acta-ai-${session.id}-${Date.now()}.txt`) : "";
  let args = [];

  if (cliKind === "claude") {
    args = ["--print"];
  } else if (session.codexThreadId) {
    // Reuse remote thread state to avoid re-sending long local history each turn.
    args = [...codexRunArgs, "exec", "resume", "--skip-git-repo-check", "--json", "-o", outPath, session.codexThreadId, "-"];
    prompt = input;
  } else {
    args = [...codexRunArgs, "exec", "--skip-git-repo-check", "-C", dataDir, "--color", "never", "--json", "-o", outPath, "-"];
  }

  session.busy = true;
  session.exitCode = null;
  session.error = "";
  session.activeCommand = "";
  session.turnStartedAtMs = null;
  session.lastTurnDurationMs = null;
  session.lastTurnUsage = null;
  session.currentAnswer = "";
  session.itemTextState = {};
  setSessionPhase(session, "thinking", "CLI に送信しています");

  const child = spawn(session.cliPath, args, {
    cwd: dataDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env
    }
  });
  session.worker = child;

  let stderrText = "";
  let stdoutPending = "";
  const stdoutNotes = [];

  child.stdout?.on("data", (chunk) => {
    const text = String(chunk ?? "");
    if (cliKind !== "codex") {
      if (!session.turnStartedAtMs) session.turnStartedAtMs = Date.now();
      appendAssistantText(session, text);
      return;
    }

    stdoutPending += text;
    while (true) {
      const idx = stdoutPending.indexOf("\n");
      if (idx < 0) break;
      const line = stdoutPending.slice(0, idx);
      stdoutPending = stdoutPending.slice(idx + 1);
      const event = parseJsonLine(line);
      if (event) {
        handleCodexEvent(session, event);
        continue;
      }
      const note = trimPreview(line);
      if (note) stdoutNotes.push(note);
    }
  });
  child.stderr?.on("data", (chunk) => {
    stderrText += String(chunk ?? "");
  });

  child.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    session.error = msg || "実行に失敗しました";
    setSessionPhase(session, "error", "CLI 実行エラー", trimPreview(session.error));
    pushSessionUpdate(
      session,
      makeSessionUpdate("error", {
        text: session.error
      })
    );
    session.busy = false;
    session.exitCode = 1;
    session.worker = null;
  });

  child.on("close", (code) => {
    void (async () => {
      if (cliKind === "codex" && stdoutPending) {
        const event = parseJsonLine(stdoutPending);
        if (event) {
          handleCodexEvent(session, event);
        } else {
          const note = trimPreview(stdoutPending);
          if (note) stdoutNotes.push(note);
        }
      }

      let fileAnswer = "";
      if (outPath) {
        fileAnswer = String(await readFileIfExists(outPath)).trim();
        try {
          await fs.promises.unlink(outPath);
        } catch {
          // ignore
        }
      }

      session.exitCode = typeof code === "number" ? code : null;
      session.busy = false;
      session.worker = null;

      if (!session.alive) return;

      if (!session.currentAnswer.trim() && fileAnswer) {
        appendAssistantText(session, fileAnswer);
      }

      const answer = session.currentAnswer.trim();
      if (session.exitCode === 0 && answer) {
        session.history.push({ user: input, assistant: answer });
        if (session.phase !== "done") {
          if (session.turnStartedAtMs) {
            session.lastTurnDurationMs = Math.max(0, Date.now() - session.turnStartedAtMs);
          }
          setSessionPhase(
            session,
            "done",
            "応答が完了しました",
            buildTurnSummary(session.lastTurnDurationMs, session.lastTurnUsage)
          );
        }
        return;
      }

      if (cliKind === "codex") {
        // If resume execution failed, retry from a fresh thread next turn.
        session.codexThreadId = "";
      }

      const fallback = trimPreview(stderrText) || stdoutNotes.join("\n").trim();
      if (fallback) {
        pushSessionUpdate(
          session,
          makeSessionUpdate("error", {
            text: fallback
          })
        );
      }
      if (session.exitCode !== 0) {
        const detail = `code=${session.exitCode ?? "?"}`;
        setSessionPhase(session, "error", "AI 実行に失敗しました", detail);
        pushSessionUpdate(
          session,
          makeSessionUpdate("error", {
            text: `[AI実行失敗: ${detail}]`
          })
        );
      } else {
        setSessionPhase(session, "idle", "待機中");
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
  const updates = session.updates.splice(0, session.updates.length);

  const res = {
    updates,
    alive: session.alive,
    busy: Boolean(session.busy),
    exitCode: session.exitCode,
    phase: session.phase,
    phaseLabel: session.phaseLabel,
    activeCommand: session.activeCommand || undefined,
    turnStartedAtMs: session.turnStartedAtMs ?? null,
    lastTurnDurationMs: session.lastTurnDurationMs ?? null,
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
  ipcMain.handle("acta:syncPull", async () => storage.syncPull());
  ipcMain.handle("acta:syncBackup", async () => storage.syncBackup());
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
