const { BrowserWindow, ipcMain } = require("electron")
const tg = require("./telegram/client")
const db = require("./database/database")
const queue = require("./queue/queue-manager")

function emit(value) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("scanner-event", value)
  }
}

function registerIpc() {
  queue.setEmitter(emit)

  ipcMain.handle("status", async () => ({
    authorized: await tg.isAuthorized(),
    queue: queue.status()
  }))

  ipcMain.handle("login", (_, data) => tg.beginLogin(data))
  ipcMain.handle("qr-login-start", () => tg.startQrLogin(emit))
  ipcMain.handle("submit-code", (_, data) => tg.submitCode(data))
  ipcMain.handle("submit-password", (_, value) => tg.submitPassword(value))
  ipcMain.handle("logout", () => tg.logout())
  ipcMain.handle("search-groups", (_, query) => queue.add("group-search", { query }))
  ipcMain.handle("scan-group", (_, data) => queue.add("group-scan", data))
  ipcMain.handle("search-messages", (_, filters) => db.searchMessages(filters))
  ipcMain.handle("list-groups", () => db.listGroups())
  ipcMain.handle("list-tasks", () => db.listTasks())
  ipcMain.handle("settings", () => db.getSettings())
  ipcMain.handle("save-settings", (_, data) => db.saveSettings(data))
  ipcMain.handle("pause-queue", (_, value) => queue.pause(value))

  queue.start()
}

module.exports = {
  registerIpc
}
