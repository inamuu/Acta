const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("acta", {
  getDataDir: () => ipcRenderer.invoke("acta:getDataDir"),
  getAiSettings: () => ipcRenderer.invoke("acta:getAiSettings"),
  saveAiSettings: (payload) => ipcRenderer.invoke("acta:saveAiSettings", payload),
  listEntries: () => ipcRenderer.invoke("acta:listEntries"),
  addEntry: (payload) => ipcRenderer.invoke("acta:addEntry", payload),
  chooseDataDir: () => ipcRenderer.invoke("acta:chooseDataDir"),
  deleteEntry: (payload) => ipcRenderer.invoke("acta:deleteEntry", payload),
  updateEntry: (payload) => ipcRenderer.invoke("acta:updateEntry", payload),
  aiStartSession: (payload) => ipcRenderer.invoke("acta:aiStartSession", payload),
  aiSendInput: (payload) => ipcRenderer.invoke("acta:aiSendInput", payload),
  aiReadOutput: (payload) => ipcRenderer.invoke("acta:aiReadOutput", payload),
  aiStopSession: (payload) => ipcRenderer.invoke("acta:aiStopSession", payload)
});
