const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("acta", {
  getDataDir: () => ipcRenderer.invoke("acta:getDataDir"),
  getSettings: () => ipcRenderer.invoke("acta:getSettings"),
  saveSettings: (payload) => ipcRenderer.invoke("acta:saveSettings", payload),
  listEntries: () => ipcRenderer.invoke("acta:listEntries"),
  addEntry: (payload) => ipcRenderer.invoke("acta:addEntry", payload),
  saveImage: (payload) => ipcRenderer.invoke("acta:saveImage", payload),
  chooseDataDir: () => ipcRenderer.invoke("acta:chooseDataDir"),
  deleteEntry: (payload) => ipcRenderer.invoke("acta:deleteEntry", payload),
  updateEntry: (payload) => ipcRenderer.invoke("acta:updateEntry", payload),
  listProjects: () => ipcRenderer.invoke("acta:listProjects"),
  setProjectOrder: (payload) => ipcRenderer.invoke("acta:setProjectOrder", payload),
  createProject: (payload) => ipcRenderer.invoke("acta:createProject", payload),
  saveProject: (payload) => ipcRenderer.invoke("acta:saveProject", payload),
  addProjectTask: (payload) => ipcRenderer.invoke("acta:addProjectTask", payload),
  moveProjectTask: (payload) => ipcRenderer.invoke("acta:moveProjectTask", payload),
  reassignProjectTask: (payload) => ipcRenderer.invoke("acta:reassignProjectTask", payload),
  renameProjectTask: (payload) => ipcRenderer.invoke("acta:renameProjectTask", payload),
  deleteProjectTask: (payload) => ipcRenderer.invoke("acta:deleteProjectTask", payload),
  setProjectArchived: (payload) => ipcRenderer.invoke("acta:setProjectArchived", payload),
  renameProject: (payload) => ipcRenderer.invoke("acta:renameProject", payload),
  deleteProject: (payload) => ipcRenderer.invoke("acta:deleteProject", payload),
  setProjectIssueUrl: (payload) => ipcRenderer.invoke("acta:setProjectIssueUrl", payload),
  addProjectKnowledgeEntry: (payload) => ipcRenderer.invoke("acta:addProjectKnowledgeEntry", payload),
  updateProjectKnowledgeEntry: (payload) => ipcRenderer.invoke("acta:updateProjectKnowledgeEntry", payload),
  deleteProjectKnowledgeEntry: (payload) => ipcRenderer.invoke("acta:deleteProjectKnowledgeEntry", payload),
  appendProjectInProgressToTodayTodo: (payload) => ipcRenderer.invoke("acta:appendProjectInProgressToTodayTodo", payload),
  appendActiveProjectsInProgressToTodayTodo: () =>
    ipcRenderer.invoke("acta:appendActiveProjectsInProgressToTodayTodo"),
  createTodoFromProjects: () => ipcRenderer.invoke("acta:createTodoFromProjects"),
  syncGitHubItems: () => ipcRenderer.invoke("acta:syncGitHubItems"),
  copyPreviousTodo: () => ipcRenderer.invoke("acta:copyPreviousTodo"),
  rebuildKnowledgeIndex: () => ipcRenderer.invoke("acta:rebuildKnowledgeIndex"),
  searchKnowledgeIndex: (payload) => ipcRenderer.invoke("acta:searchKnowledgeIndex", payload),
  generateKnowledgeSite: () => ipcRenderer.invoke("acta:generateKnowledgeSite"),
  openKnowledgeSite: () => ipcRenderer.invoke("acta:openKnowledgeSite"),
  syncPull: () => ipcRenderer.invoke("acta:syncPull"),
  syncBackup: () => ipcRenderer.invoke("acta:syncBackup"),
  setUnsavedChanges: (dirty) => ipcRenderer.send("acta:setUnsavedChanges", Boolean(dirty)),
  onDataChanged: (listener) => {
    const handler = () => {
      if (typeof listener === "function") listener();
    };
    ipcRenderer.on("acta:dataChanged", handler);
    return () => ipcRenderer.removeListener("acta:dataChanged", handler);
  }
});
