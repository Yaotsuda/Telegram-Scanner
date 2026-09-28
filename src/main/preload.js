const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("scanner", {
  status: () => ipcRenderer.invoke("status"),
  login: data => ipcRenderer.invoke("login", data),
  startQrLogin: () => ipcRenderer.invoke("qr-login-start"),
  submitCode: data => ipcRenderer.invoke("submit-code", data),
  submitPassword: value => ipcRenderer.invoke("submit-password", value),
  logout: () => ipcRenderer.invoke("logout"),
  searchGroups: query => ipcRenderer.invoke("search-groups", query),
  scanGroup: data => ipcRenderer.invoke("scan-group", data),
  searchMessages: filters => ipcRenderer.invoke("search-messages", filters),
  listGroups: () => ipcRenderer.invoke("list-groups"),
  listTasks: () => ipcRenderer.invoke("list-tasks"),
  settings: () => ipcRenderer.invoke("settings"),
  saveSettings: data => ipcRenderer.invoke("save-settings", data),
  pauseQueue: value => ipcRenderer.invoke("pause-queue", value),
  onEvent: handler => {
    ipcRenderer.removeAllListeners("scanner-event")
    ipcRenderer.on("scanner-event", (_, value) => handler(value))
  }
})
