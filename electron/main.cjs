const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const storage = require("./storage.cjs");
const iconPath = path.join(__dirname, "assets", "icon.png");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "acta-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);


// データフォルダを監視して、アプリ外（CLI/git pull など）からの変更も自動で画面へ反映する。
const DATA_WATCH_DEBOUNCE_MS = 600;
const DATA_WATCH_IGNORED_RE = /(^|[\\/])(\.git|node_modules|wiki|\.DS_Store)([\\/]|$)|knowledge-index/;

let dataWatcher = null;
let dataWatchTimer = null;
let watchedDataDir = "";

function notifyDataChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("acta:dataChanged");
  }
}

function scheduleDataChangedNotice() {
  if (dataWatchTimer) clearTimeout(dataWatchTimer);
  dataWatchTimer = setTimeout(() => {
    dataWatchTimer = null;
    notifyDataChanged();
  }, DATA_WATCH_DEBOUNCE_MS);
}

function stopDataDirWatcher() {
  if (dataWatchTimer) {
    clearTimeout(dataWatchTimer);
    dataWatchTimer = null;
  }
  if (dataWatcher) {
    try {
      dataWatcher.close();
    } catch {
      // ignore
    }
  }
  dataWatcher = null;
  watchedDataDir = "";
}

function startDataDirWatcher() {
  const dir = storage.getDataDir();
  if (dataWatcher && watchedDataDir === dir) return;

  stopDataDirWatcher();
  try {
    fs.mkdirSync(dir, { recursive: true });
    const watcher = fs.watch(dir, { recursive: true }, (_eventType, fileName) => {
      const name = String(fileName ?? "");
      if (name && DATA_WATCH_IGNORED_RE.test(name)) return;
      scheduleDataChangedNotice();
    });
    watcher.on("error", () => stopDataDirWatcher());
    dataWatcher = watcher;
    watchedDataDir = dir;
  } catch {
    dataWatcher = null;
    watchedDataDir = "";
  }
}

// 外部で開くのは Web / メールのみ。file: や独自スキームを OS のハンドラに渡さない。
const EXTERNAL_URL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function openExternalIfAllowed(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value) return false;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!EXTERNAL_URL_SCHEMES.has(parsed.protocol)) return false;
  void shell.openExternal(parsed.toString());
  return true;
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
    openExternalIfAllowed(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const current = win.webContents.getURL();
    if (url && current && url !== current) {
      e.preventDefault();
      openExternalIfAllowed(url);
    }
  });

  return win;
}

function registerAssetProtocol() {
  protocol.handle("acta-asset", (request) => {
    const url = new URL(request.url);
    const rawRelativePath = decodeURIComponent(`${url.hostname}${url.pathname}`);
    const dataDir = storage.getDataDir();
    const filePath = path.normalize(path.join(dataDir, rawRelativePath));
    const relative = path.relative(dataDir, filePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.setIcon(iconPath);
  }

  registerAssetProtocol();

  ipcMain.handle("acta:getDataDir", async () => storage.getDataDir());
  ipcMain.handle("acta:getSettings", async () => storage.getSettings());
  ipcMain.handle("acta:saveSettings", async (_event, payload) => storage.setSettings(payload));
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
    startDataDirWatcher();
    return { canceled: false, dataDir: storage.getDataDir() };
  });
  ipcMain.handle("acta:listEntries", async () => storage.listEntries());
  ipcMain.handle("acta:addEntry", async (_event, payload) => storage.addEntry(payload));
  ipcMain.handle("acta:saveImage", async (_event, payload) => storage.saveImage(payload));
  ipcMain.handle("acta:deleteEntry", async (_event, payload) => storage.deleteEntry(payload));
  ipcMain.handle("acta:updateEntry", async (_event, payload) => storage.updateEntry(payload));
  ipcMain.handle("acta:listProjects", async () => storage.listProjects());
  ipcMain.handle("acta:setProjectOrder", async (_event, payload) => storage.setProjectOrder(payload));
  ipcMain.handle("acta:createProject", async (_event, payload) => storage.createProject(payload));
  ipcMain.handle("acta:saveProject", async (_event, payload) => storage.saveProject(payload));
  ipcMain.handle("acta:addProjectTask", async (_event, payload) => storage.addProjectTask(payload));
  ipcMain.handle("acta:moveProjectTask", async (_event, payload) => storage.moveProjectTask(payload));
  ipcMain.handle("acta:reassignProjectTask", async (_event, payload) => storage.reassignProjectTask(payload));
  ipcMain.handle("acta:renameProjectTask", async (_event, payload) => storage.renameProjectTask(payload));
  ipcMain.handle("acta:deleteProjectTask", async (_event, payload) => storage.deleteProjectTask(payload));
  ipcMain.handle("acta:setProjectArchived", async (_event, payload) => storage.setProjectArchived(payload));
  ipcMain.handle("acta:renameProject", async (_event, payload) => storage.renameProject(payload));
  ipcMain.handle("acta:deleteProject", async (_event, payload) => storage.deleteProject(payload));
  ipcMain.handle("acta:setProjectIssueUrl", async (_event, payload) => storage.setProjectIssueUrl(payload));
  ipcMain.handle("acta:addProjectKnowledgeEntry", async (_event, payload) => storage.addProjectKnowledgeEntry(payload));
  ipcMain.handle("acta:updateProjectKnowledgeEntry", async (_event, payload) =>
    storage.updateProjectKnowledgeEntry(payload)
  );
  ipcMain.handle("acta:deleteProjectKnowledgeEntry", async (_event, payload) =>
    storage.deleteProjectKnowledgeEntry(payload)
  );
  ipcMain.handle("acta:appendProjectInProgressToTodayTodo", async (_event, payload) =>
    storage.appendProjectInProgressToTodayTodo(payload)
  );
  ipcMain.handle("acta:appendActiveProjectsInProgressToTodayTodo", async () =>
    storage.appendActiveProjectsInProgressToTodayTodo()
  );
  ipcMain.handle("acta:createTodoFromProjects", async () => storage.createTodoFromProjects());
  ipcMain.handle("acta:syncGitHubItems", async () => storage.syncGitHubItems());
  ipcMain.handle("acta:copyPreviousTodo", async () => storage.copyPreviousTodo());
  ipcMain.handle("acta:rebuildKnowledgeIndex", async () => storage.rebuildKnowledgeIndex());
  ipcMain.handle("acta:searchKnowledgeIndex", async (_event, payload) => storage.searchKnowledgeIndex(payload));
  ipcMain.handle("acta:generateKnowledgeSite", async () => storage.generateKnowledgeSite());
  ipcMain.handle("acta:openKnowledgeSite", async () => {
    const sitePath = storage.getKnowledgeSitePath();
    const error = await shell.openPath(sitePath);
    return { opened: !error, path: sitePath, error: error || undefined };
  });
  ipcMain.handle("acta:syncPull", async () => storage.syncPull());
  ipcMain.handle("acta:syncBackup", async () => storage.syncBackup());
  createWindow();
  startDataDirWatcher();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopDataDirWatcher();
  if (process.platform !== "darwin") app.quit();
});
