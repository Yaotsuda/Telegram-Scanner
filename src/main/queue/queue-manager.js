const db = require("../database/database")
const limiter = require("./rate-limiter")
const { wait, floodSeconds } = require("../telegram/flood-control")
const groupSearch = require("../telegram/group-search")
const groupScan = require("../telegram/group-scanner")

const items = []
let running = false
let paused = false
let restored = false
let emit = () => {}

function setEmitter(handler) {
  emit = handler
}

function restorePendingTasks() {
  if (restored) {
    return
  }

  restored = true

  for (const task of db.getPendingTasks()) {
    if (!items.some(item => item.id === task.id)) {
      items.push(task)
    }
  }
}

function add(type, payload) {
  const id = db.addTask(type, payload)
  items.push({ id, type, payload })
  emit({ type: "queue", status: "added", id })
  return { id }
}

function report(item, details) {
  db.updateTaskProgress(item.id, details)
  emit({ type: "task-progress", id: item.id, ...details })
}

async function execute(item) {
  const progress = details => report(item, details)

  if (item.type === "group-search") {
    return groupSearch.search(item.payload.query, progress)
  }

  if (item.type === "group-scan") {
    return groupScan.scan(item.payload, progress)
  }

  throw new Error("Неизвестный тип задания")
}

async function loop() {
  if (running) {
    return
  }

  running = true
  restorePendingTasks()

  while (running) {
    if (paused || !items.length) {
      await wait(500)
      continue
    }

    const item = items.shift()
    db.updateTask(item.id, "running")
    report(item, {
      status: "running",
      stage: "Подготовка",
      progress: 1,
      error: null
    })

    try {
      const delay = await limiter.throttle()

      report(item, {
        delay_ms: delay || 0,
        last_request_at: new Date().toISOString()
      })

      const result = await execute(item)

      db.updateTask(item.id, "done")
      report(item, {
        status: "done",
        stage: "Завершено",
        progress: 100,
        delay_ms: 0,
        flood_wait_seconds: 0,
        error: null
      })

      emit({
        type: "task",
        status: "done",
        id: item.id,
        result
      })
    } catch (error) {
      const seconds = floodSeconds(error)

      if (seconds) {
        report(item, {
          status: "waiting",
          stage: "Ожидание FLOOD_WAIT",
          flood_wait_seconds: seconds,
          error: error.message
        })

        emit({
          type: "flood",
          id: item.id,
          seconds
        })

        await wait((seconds + 3) * 1000)

        report(item, {
          status: "pending",
          stage: "Повтор после FLOOD_WAIT",
          flood_wait_seconds: 0,
          error: null
        })

        items.unshift(item)
      } else {
        db.updateTask(item.id, "error", String(error.message))
        report(item, {
          status: "error",
          stage: "Ошибка",
          error: String(error.message)
        })

        emit({
          type: "task",
          status: "error",
          id: item.id,
          error: String(error.message)
        })
      }
    }
  }
}

function start() {
  loop()
}

function pause(value) {
  paused = Boolean(value)
  return status()
}

function status() {
  return {
    running,
    paused,
    pending: items.length
  }
}

module.exports = {
  add,
  start,
  pause,
  status,
  setEmitter
}
