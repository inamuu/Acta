const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");
const storage = require("./storage.cjs");

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#f6f7fb",
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
  ipcMain.handle("acta:getDataDir", async () => storage.getDataDir());
  ipcMain.handle("acta:listEntries", async () => storage.listEntries());
  ipcMain.handle("acta:addEntry", async (_event, payload) => storage.addEntry(payload));

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
