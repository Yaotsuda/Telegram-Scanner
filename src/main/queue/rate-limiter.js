const db = require("../database/database")
const { wait } = require("../telegram/flood-control")

let count = 0

async function throttle() {
  const settings = db.getSettings()
  const minimum = Number(settings.min_delay_ms || 1800)
  const maximum = Number(settings.max_delay_ms || 4200)
  const delay = Math.floor(minimum + Math.random() * Math.max(1, maximum - minimum))

  await wait(delay)
  count += 1

  if (count >= Number(settings.batch_size || 12)) {
    count = 0
    await wait(Number(settings.batch_pause_ms || 20000))
  }

  return delay
}

module.exports = { throttle }
