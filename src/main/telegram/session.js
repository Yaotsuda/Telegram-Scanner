const {
  app, safeStorage
}
= require('electron')
const fs = require('fs')
const path = require('path')
function file() {
  return path.join(app.getPath('userData'),'telegram.session')
}
function load() {
  try {
    const b=fs.readFileSync(file());
    return safeStorage.isEncryptionAvailable()?safeStorage.decryptString(b):b.toString('utf8')
  }
  catch {
    return ''
  }
}
function save(value) {
  const b=safeStorage.isEncryptionAvailable()?safeStorage.encryptString(value):Buffer.from(value);
  fs.writeFileSync(file(),b)
}
function clear() {
  try {
    fs.unlinkSync(file())
  }
  catch {
  }
}
module.exports= {
  load,save,clear
}
