const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("node:path");
const storage = require("./storage.cjs");
const iconPath = path.join(__dirname, "assets", "icon.png");

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#f6f7fb",
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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
