const {
  app, BrowserWindow
}
= require('electron')
const path = require('path')
const {
  initDatabase
}
= require('./database/database')
const {
  registerIpc
}
= require('./ipc')
let win
app.whenReady().then(() => {
  initDatabase(app.getPath('userData'))
  registerIpc()
  win = new BrowserWindow( {
    width: 1280, height: 820, minWidth: 980, minHeight: 650, webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false
    }
  })
  win.loadFile(path.join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
