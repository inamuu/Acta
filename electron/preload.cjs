const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("acta", {
  getDataDir: () => ipcRenderer.invoke("acta:getDataDir"),
  listEntries: () => ipcRenderer.invoke("acta:listEntries"),
  addEntry: (payload) => ipcRenderer.invoke("acta:addEntry", payload),
  chooseDataDir: () => ipcRenderer.invoke("acta:chooseDataDir")
});
