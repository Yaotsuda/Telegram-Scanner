const fs = require("fs")
const path = require("path")

let databasePath = ""
let state = null

const defaultSettings = {
  min_delay_ms: "1800",
  max_delay_ms: "4200",
  batch_pause_ms: "20000",
  batch_size: "12",
  history_limit: "500",
  search_limit: "100",
  preview_limit: "100",
  min_members: "300",
  active_days: "3",
  min_messages_24h: "3",
  min_messages_7d: "15",
  inactive_days: "7",
  max_depth: "2",
  max_links_per_group: "30",
  exclude_rf: "true",
  exclude_rub: "true",
  include_unknown_geo: "true"
}

function createState() {
  return {
    counters: {
      groups: 0,
      messages: 0,
      group_links: 0,
      scan_tasks: 0
    },
    groups: [],
    messages: [],
    group_links: [],
    scan_tasks: [],
    settings: { ...defaultSettings }
  }
}

function now() {
  return new Date().toISOString()
}

function save() {
  const temporaryPath = `${databasePath}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8")
  fs.renameSync(temporaryPath, databasePath)
}

function initDatabase(basePath) {
  const dataDirectory = path.join(basePath, "data")
  fs.mkdirSync(dataDirectory, { recursive: true })
  databasePath = path.join(dataDirectory, "scanner.json")

  if (fs.existsSync(databasePath)) {
    state = JSON.parse(fs.readFileSync(databasePath, "utf8"))
  } else {
    state = createState()
  }

  state.counters ||= {
    groups: 0,
    messages: 0,
    group_links: 0,
    scan_tasks: 0
  }
  state.groups ||= []
  state.messages ||= []
  state.group_links ||= []
  state.scan_tasks ||= []
  state.settings = {
    ...defaultSettings,
    ...(state.settings || {})
  }

  save()
}

function upsertGroup(group) {
  const telegramId = String(group.telegram_id)
  let existing = state.groups.find(item => item.telegram_id === telegramId)

  if (!existing && group.username) {
    existing = state.groups.find(item => item.username === group.username)
  }

  if (existing) {
    Object.assign(existing, group, {
      telegram_id: telegramId,
      id: existing.id,
      created_at: existing.created_at,
      updated_at: now()
    })
  } else {
    state.counters.groups += 1
    state.groups.push({
      id: state.counters.groups,
      username: null,
      title: "",
      description: "",
      members_count: 0,
      online_count: 0,
      entity_type: "unknown",
      linked_chat_id: null,
      linked_chat_title: null,
      linked_chat_username: null,
      messages_24h: 0,
      messages_7d: 0,
      messages_30d: 0,
      average_messages_day: 0,
      last_message_at: null,
      activity_status: "unknown",
      is_active: false,
      source_group_id: null,
      discovery_depth: 0,
      last_scanned_at: null,
      created_at: now(),
      updated_at: now(),
      ...group,
      telegram_id: telegramId
    })
  }

  save()
}

function addMessage(message) {
  const exists = state.messages.some(item => {
    return item.group_id === message.group_id &&
      item.telegram_message_id === message.telegram_message_id
  })

  if (exists) {
    return false
  }

  state.counters.messages += 1
  state.messages.push({
    id: state.counters.messages,
    ...message,
    created_at: now()
  })

  return true
}

function addLink(link) {
  const exists = state.group_links.some(item => {
    return item.source_group_id === link.source_group_id &&
      item.telegram_url === link.telegram_url
  })

  if (exists) {
    return false
  }

  state.counters.group_links += 1
  state.group_links.push({
    id: state.counters.group_links,
    target_group_id: null,
    status: "new",
    ...link,
    created_at: now()
  })

  return true
}

function flush() {
  save()
}

function listGroups() {
  return [...state.groups].sort((first, second) => {
    if (first.is_active !== second.is_active) {
      return Number(second.is_active) - Number(first.is_active)
    }

    return String(second.last_message_at || "").localeCompare(
      String(first.last_message_at || "")
    )
  })
}

function listTasks() {
  return [...state.scan_tasks]
    .sort((first, second) => second.id - first.id)
    .slice(0, 300)
}

function classifyMessage(text) {
  const source = String(text || "")
  const normalized = source.toLowerCase().replace(/ё/g, "е")
  const rfPatterns = [
    /гражданств[оа]\s+рф/i,
    /только\s+(?:для\s+)?(?:граждан\s+)?рф/i,
    /кандидат\w*\s+из\s+россии/i,
    /нахождени\w*\s+(?:на\s+территории\s+)?российской\s+федерации/i,
    /на\s+территории\s+рф/i,
    /резидент\w*\s+рф/i,
    /самозанят\w*\s+рф/i,
    /ип\s+рф/i,
    /оформлени\w*\s+по\s+тк\s+рф/i,
    /рф\s*[|,/·-]\s*18\+/i
  ]
  const internationalPatterns = [
    /international/i,
    /relocation/i,
    /релокаци/i,
    /worldwide/i,
    /anywhere/i,
    /europe|европ/i,
    /cyprus|кипр/i,
    /global\s+team/i,
    /международн/i
  ]
  const ukrainePatterns = [
    /украин/i,
    /україн/i,
    /україна/i,
    /uah/i,
    /₴/i
  ]
  let geography = "unknown"

  if (rfPatterns.some(pattern => pattern.test(normalized))) {
    geography = "rf_only"
  } else if (ukrainePatterns.some(pattern => pattern.test(normalized))) {
    geography = "ukraine"
  } else if (internationalPatterns.some(pattern => pattern.test(normalized))) {
    geography = "international"
  }

  let currency = "unknown"

  if (/\$|\busd\b|доллар/i.test(source)) {
    currency = "usd"
  } else if (/€|\beur\b|евро/i.test(source)) {
    currency = "eur"
  } else if (/₴|\buah\b|грн/i.test(source)) {
    currency = "uah"
  } else if (/\busdt\b|\bbtc\b|\beth\b|криптовалют|криптокошел/i.test(source)) {
    currency = "crypto"
  } else if (/₽|\brub\b|\bруб(?:\.|лей|ля|ль)?\b/i.test(source)) {
    currency = "rub"
  }

  return {
    geography,
    currency,
    is_rf_only: geography === "rf_only",
    is_rub: currency === "rub"
  }
}

function searchMessages(filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase()
  const groupId = filters.group_id ? Number(filters.group_id) : null
  const excludeRf = filters.exclude_rf === undefined
    ? state.settings.exclude_rf === "true"
    : Boolean(filters.exclude_rf)
  const excludeRub = filters.exclude_rub === undefined
    ? state.settings.exclude_rub === "true"
    : Boolean(filters.exclude_rub)
  const includeUnknownGeo = filters.include_unknown_geo === undefined
    ? state.settings.include_unknown_geo === "true"
    : Boolean(filters.include_unknown_geo)

  return state.messages
    .map(message => {
      const classification = classifyMessage(message.text)
      const group = state.groups.find(item => item.id === message.group_id)

      return {
        ...message,
        ...classification,
        group_title: group?.title || "",
        group_username: group?.username || ""
      }
    })
    .filter(message => {
      if (groupId && message.group_id !== groupId) return false
      if (query && !String(message.text || "").toLowerCase().includes(query)) return false
      if (excludeRf && message.is_rf_only) return false
      if (excludeRub && message.is_rub) return false
      if (!includeUnknownGeo && message.geography === "unknown") return false
      return true
    })
    .sort((first, second) => {
      return String(second.message_date || "").localeCompare(
        String(first.message_date || "")
      )
    })
    .slice(0, 500)
}

function getSettings() {
  return { ...state.settings }
}

function saveSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    state.settings[key] = String(value)
  }

  save()
  return getSettings()
}

function addTask(taskType, payload) {
  state.counters.scan_tasks += 1

  const task = {
    id: state.counters.scan_tasks,
    task_type: taskType,
    payload: JSON.stringify(payload),
    target_title: payload.title || payload.username || payload.query || "",
    target_username: payload.username || "",
    entity_type: "unknown",
    stage: "Ожидает",
    progress: 0,
    current: 0,
    total: 0,
    messages_scanned: 0,
    messages_saved: 0,
    links_found: 0,
    related_groups_found: 0,
    delay_ms: 0,
    flood_wait_seconds: 0,
    priority: 0,
    status: "pending",
    attempts: 0,
    next_run_at: null,
    started_at: null,
    finished_at: null,
    last_request_at: null,
    error: null,
    created_at: now(),
    updated_at: now()
  }

  state.scan_tasks.push(task)
  save()
  return task.id
}

function updateTask(id, status, error = null) {
  const task = state.scan_tasks.find(item => item.id === Number(id))
  if (!task) return

  task.status = status
  task.error = error
  task.updated_at = now()

  if (status === "running" && !task.started_at) task.started_at = now()
  if (["done", "error", "cancelled"].includes(status)) task.finished_at = now()
  if (status === "error") task.attempts += 1

  save()
}

function updateTaskProgress(id, progress) {
  const task = state.scan_tasks.find(item => item.id === Number(id))
  if (!task) return

  Object.assign(task, progress, {
    updated_at: now()
  })

  save()
}

function getPendingTasks() {
  const tasks = state.scan_tasks
    .filter(task => ["pending", "waiting", "running"].includes(task.status))
    .map(task => {
      let payload = {}

      try {
        payload = JSON.parse(task.payload || "{}")
      } catch {
        payload = {}
      }

      if (task.status === "running" || task.status === "waiting") {
        task.status = "pending"
        task.stage = "Восстановлено после перезапуска"
        task.flood_wait_seconds = 0
        task.error = null
        task.updated_at = now()
      }

      return {
        id: task.id,
        type: task.task_type,
        payload
      }
    })

  save()
  return tasks
}

function findGroupByTelegramId(telegramId) {
  return state.groups.find(item => item.telegram_id === String(telegramId))
}

module.exports = {
  initDatabase,
  upsertGroup,
  addMessage,
  addLink,
  flush,
  listGroups,
  listTasks,
  searchMessages,
  getSettings,
  saveSettings,
  addTask,
  updateTask,
  updateTaskProgress,
  getPendingTasks,
  findGroupByTelegramId
}
