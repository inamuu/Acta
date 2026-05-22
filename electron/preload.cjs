const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("acta", {
  getDataDir: () => ipcRenderer.invoke("acta:getDataDir"),
  getAiSettings: () => ipcRenderer.invoke("acta:getAiSettings"),
  saveAiSettings: (payload) => ipcRenderer.invoke("acta:saveAiSettings", payload),
  listEntries: () => ipcRenderer.invoke("acta:listEntries"),
  addEntry: (payload) => ipcRenderer.invoke("acta:addEntry", payload),
  saveImage: (payload) => ipcRenderer.invoke("acta:saveImage", payload),
  chooseDataDir: () => ipcRenderer.invoke("acta:chooseDataDir"),
  deleteEntry: (payload) => ipcRenderer.invoke("acta:deleteEntry", payload),
  updateEntry: (payload) => ipcRenderer.invoke("acta:updateEntry", payload),
  rebuildKnowledgeIndex: () => ipcRenderer.invoke("acta:rebuildKnowledgeIndex"),
  searchKnowledgeIndex: (payload) => ipcRenderer.invoke("acta:searchKnowledgeIndex", payload),
  generateKnowledgeSite: () => ipcRenderer.invoke("acta:generateKnowledgeSite"),
  openKnowledgeSite: () => ipcRenderer.invoke("acta:openKnowledgeSite"),
  syncPull: () => ipcRenderer.invoke("acta:syncPull"),
  syncBackup: () => ipcRenderer.invoke("acta:syncBackup"),
  aiStartSession: (payload) => ipcRenderer.invoke("acta:aiStartSession", payload),
  aiSendInput: (payload) => ipcRenderer.invoke("acta:aiSendInput", payload),
  aiReadOutput: (payload) => ipcRenderer.invoke("acta:aiReadOutput", payload),
  aiStopSession: (payload) => ipcRenderer.invoke("acta:aiStopSession", payload)
});
