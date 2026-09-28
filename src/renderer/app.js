const app = document.getElementById("app")
let queueTimer = null
let searchTaskId = null

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;"
})[character])

const typeLabels = {
  group: "ГРУППА",
  supergroup: "СУПЕРГРУППА",
  channel: "КАНАЛ",
  channel_discussion: "КАНАЛ + ОБСУЖДЕНИЕ",
  forum: "ФОРУМ",
  unknown: "НЕ ОПРЕДЕЛЕНО"
}

const activityLabels = {
  high: "Высокая",
  active: "Активная",
  weak: "Слабая",
  inactive: "Неактивная",
  unavailable: "Недоступная",
  unknown: "Не проверена"
}

const geographyLabels = {
  rf_only: "Только РФ",
  ukraine: "Украина",
  international: "Международная",
  unknown: "География не указана"
}

const currencyLabels = {
  usd: "USD",
  eur: "EUR",
  uah: "UAH",
  crypto: "Криптовалюта",
  rub: "RUB",
  unknown: "Оплата не указана"
}

function stopQueueTimer() {
  if (queueTimer) clearInterval(queueTimer)
  queueTimer = null
}

function classifyVacancy(text) {
  const source = String(text || "")
  const normalized = source.toLowerCase().replace(/ё/g, "е")
  const rfPatterns = [
    /гражданств[оа]\s+рф/i,
    /только\s+(?:для\s+)?(?:граждан\s+)?рф/i,
    /кандидат\w*\s+из\s+россии/i,
    /нахождени\w*\s+(?:на\s+территории\s+)?российской\s+федерации/i,
    /на\s+территории\s+рф/i,
    /резидент\w*\s+рф/i,
    /оформлени\w*\s+по\s+тк\s+рф/i,
    /удал[её]нно\s+по\s+рф/i,
    /вне\s+рф\/рб/i
  ]
  const internationalPatterns = [
    /international|worldwide|anywhere|relocation/i,
    /международн|релокаци|из любой страны/i,
    /рынк\w*\s+(?:сша|европ|зарубеж)/i,
    /вне\s+рф\/рб/i,
    /кандидат\w*\s+из\s+(?:европ|украин|беларус|казахстан)/i
  ]
  const ukrainePatterns = [
    /из\s+украины/i,
    /кандидат\w*\s+из\s+украин/i,
    /україн|україна/i,
    /₴|\buah\b|грн/i
  ]

  let geography = "unknown"

  if (rfPatterns.some(pattern => pattern.test(normalized))) geography = "rf_only"
  if (internationalPatterns.some(pattern => pattern.test(normalized))) geography = "international"
  if (ukrainePatterns.some(pattern => pattern.test(normalized))) geography = "ukraine"

  let currency = "unknown"

  if (/\$\s?\d|\d[\d\s.,]*\s?\$|\busd\b|доллар/i.test(source)) currency = "usd"
  else if (/€\s?\d|\d[\d\s.,]*\s?€|\beur\b|евро/i.test(source)) currency = "eur"
  else if (/₴\s?\d|\d[\d\s.,]*\s?₴|\buah\b|грн/i.test(source)) currency = "uah"
  else if (/\busdt\b|оплат\w*\s+(?:в|через)\s+крипт|криптовалют/i.test(source)) currency = "crypto"
  else if (/₽|\brub\b|\bруб(?:\.|лей|ля|ль)?\b/i.test(source)) currency = "rub"

  return { geography, currency }
}

function looksLikeVacancy(text) {
  const value = String(text || "").toLowerCase()
  const positive = /ищ(?:ут|ем)|нужен|нужна|требуется|ваканси|работа|задач|обязанност|услови|оплат|доход|зарплат|контакт|отклик|проект|специалист|разработчик|дизайнер|монтаж|маркетолог|smm|developer|designer|manager|remote|full-time|part-time/i
  const negative = /доброе утро друзья|btc\s*[≈=]|eth\s*[≈=]|торгуем на|крипта сигналы|#реклама|о рекламодателе|разработать вопросы к собеседованию/i

  return positive.test(value) && !negative.test(value)
}

function splitVacancies(message) {
  const text = String(message.text || "").trim()

  if (!text) return []

  const hashtagMatches = [...text.matchAll(/(?:^|\s)(#[\p{L}\p{N}_]+)/gu)]
  const starts = hashtagMatches
    .map(match => match.index + match[0].indexOf("#"))
    .filter((value, index, array) => index === 0 || value !== array[index - 1])

  let parts = []

  if (starts.length > 1) {
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]
      const end = starts[index + 1] ?? text.length
      parts.push(text.slice(start, end).trim())
    }
  } else {
    parts = text.split(/(?:➖){5,}|\n\s*[-–—]{3,}\s*\n/g).map(value => value.trim())
  }

  return parts
    .filter(value => value.length >= 60)
    .filter(looksLikeVacancy)
    .map((value, index) => ({
      ...message,
      vacancy_id: `${message.id || message.telegram_message_id}-${index}`,
      text: value,
      ...classifyVacancy(value)
    }))
}

async function dashboard() {
  stopQueueTimer()
  const status = await window.scanner.status()
  app.innerHTML = `<h2>Главная</h2><div class="card">Аккаунт: <b class="${status.authorized ? "ok" : "error"}">${status.authorized ? "подключён" : "не подключён"}</b></div>`
}

function renderSearchProgress(task) {
  const container = document.getElementById("searchProgress")
  if (!container || !task) return

  const progress = Number(task.progress || 0)
  const statusClass = task.status === "error" ? "inactive" : task.status === "done" ? "active" : "type"

  container.innerHTML = `
    <div class="card task-card">
      <div class="row between">
        <b>${escapeHtml(task.target_title || "Поиск")}</b>
        <span class="badge ${statusClass}">${escapeHtml(task.status)}</span>
      </div>
      <p><b>Этап:</b> ${escapeHtml(task.stage || "Подготовка")}</p>
      <div class="progress"><div style="width:${progress}%"></div></div>
      <div class="stats">
        <span>Прогресс: <b>${progress}%</b></span>
        <span>Обработано: <b>${task.current || 0}/${task.total || 0}</b></span>
        <span>Источников: <b>${task.related_groups_found || 0}</b></span>
        <span>Сохранено: <b>${task.messages_saved || 0}</b></span>
        <span>FLOOD_WAIT: <b>${task.flood_wait_seconds || 0} с</b></span>
      </div>
      ${task.error ? `<p class="error">${escapeHtml(task.error)}</p>` : ""}
      <button class="primary" id="openQueue">Открыть очередь</button>
    </div>
  `

  document.getElementById("openQueue").onclick = queue
}

async function refreshSearchProgress() {
  if (!searchTaskId) return
  const tasks = await window.scanner.listTasks()
  const task = tasks.find(item => Number(item.id) === Number(searchTaskId))
  if (!task) return

  renderSearchProgress(task)

  if (["done", "error", "cancelled"].includes(task.status)) {
    stopQueueTimer()
    document.querySelectorAll("#normalSearch, #extendedSearch").forEach(button => button.disabled = false)
  }
}

async function startGroupSearch(extended) {
  const input = document.getElementById("q")
  const query = input.value.trim()

  if (!query) {
    document.getElementById("searchProgress").innerHTML = `<div class="card error">Введите запрос.</div>`
    return
  }

  document.querySelectorAll("#normalSearch, #extendedSearch").forEach(button => button.disabled = true)
  document.getElementById("searchProgress").innerHTML = `<div class="card">Добавление поиска в очередь...</div>`

  try {
    const searchQuery = extended ? `__extended__:${query}` : query
    const result = await window.scanner.searchGroups(searchQuery)
    searchTaskId = result.id
    await refreshSearchProgress()
    queueTimer = setInterval(refreshSearchProgress, 1000)
  } catch (error) {
    document.querySelectorAll("#normalSearch, #extendedSearch").forEach(button => button.disabled = false)
    document.getElementById("searchProgress").innerHTML = `<div class="card error">${escapeHtml(error.message)}</div>`
  }
}

async function groupSearch() {
  stopQueueTimer()
  app.innerHTML = `
    <h2>Поиск групп и каналов</h2>
    <div class="card">
      <div class="row">
        <input id="q" placeholder="Например: Node.js, Telegram bot, PostgreSQL">
        <button class="primary" id="normalSearch">Обычный поиск</button>
        <button class="warn" id="extendedSearch">Расширенный поиск</button>
      </div>
      <p class="muted">Обычный поиск использует только введённую фразу. Расширенный добавляет набор русских, украинских и английских запросов.</p>
    </div>
    <div id="searchProgress"></div>
  `

  document.getElementById("normalSearch").onclick = () => startGroupSearch(false)
  document.getElementById("extendedSearch").onclick = () => startGroupSearch(true)
}

async function groups() {
  stopQueueTimer()
  const rows = await window.scanner.listGroups()
  app.innerHTML = `<div class="row page-title"><h2>Группы и каналы</h2><label><input id="activeOnly" type="checkbox"> Только активные</label></div><div id="groupList"></div>`

  const render = () => {
    const filtered = document.getElementById("activeOnly").checked ? rows.filter(item => item.is_active) : rows
    document.getElementById("groupList").innerHTML = filtered.map(item => `
      <div class="card group-card">
        <div class="row between">
          <div><span class="badge type">${escapeHtml(typeLabels[item.entity_type] || item.entity_type)}</span><span class="badge ${item.is_active ? "active" : "inactive"}">${escapeHtml(activityLabels[item.activity_status] || item.activity_status)}</span></div>
          <button class="primary scan" data-username="${escapeHtml(item.username)}">Сканировать</button>
        </div>
        <h3>${escapeHtml(item.title)}</h3>
        <p><a href="https://t.me/${escapeHtml(item.username)}">@${escapeHtml(item.username)}</a></p>
        <p>${escapeHtml(item.description || "Описание отсутствует")}</p>
        <div class="stats"><span>Участники: <b>${item.members_count || 0}</b></span><span>Онлайн: <b>${item.online_count || 0}</b></span><span>24 часа: <b>${item.messages_24h || 0}</b></span><span>7 дней: <b>${item.messages_7d || 0}</b></span><span>30 дней: <b>${item.messages_30d || 0}</b></span></div>
      </div>
    `).join("") || `<div class="card">Источники не найдены.</div>`

    document.querySelectorAll(".scan").forEach(button => {
      button.onclick = async () => {
        await window.scanner.scanGroup({ username: button.dataset.username, depth: 0 })
        queue()
      }
    })
  }

  document.getElementById("activeOnly").onchange = render
  render()
}

async function messages() {
  stopQueueTimer()
  app.innerHTML = `
    <h2>Вакансии и заказы</h2>
    <div class="card">
      <div class="row"><input id="mq" placeholder="Node.js, backend, Telegram bot"><button class="primary" id="mgo">Искать</button></div>
      <div class="row"><label><input id="excludeRf" type="checkbox" checked> Исключить только РФ</label><label><input id="excludeRub" type="checkbox" checked> Исключить RUB</label><label><input id="includeUnknownGeo" type="checkbox" checked> Без указанной географии</label></div>
    </div>
    <div id="results"></div>
  `

  document.getElementById("mgo").onclick = async () => {
    const query = document.getElementById("mq").value.trim().toLowerCase()
    const rows = await window.scanner.searchMessages({ query: "", exclude_rf: false, exclude_rub: false, include_unknown_geo: true })
    let vacancies = rows.flatMap(splitVacancies)

    if (query) vacancies = vacancies.filter(item => item.text.toLowerCase().includes(query))
    if (document.getElementById("excludeRf").checked) vacancies = vacancies.filter(item => item.geography !== "rf_only")
    if (document.getElementById("excludeRub").checked) vacancies = vacancies.filter(item => item.currency !== "rub")
    if (!document.getElementById("includeUnknownGeo").checked) vacancies = vacancies.filter(item => item.geography !== "unknown")

    document.getElementById("results").innerHTML = vacancies.map(item => `
      <div class="card">
        <div class="row"><span class="badge type">${escapeHtml(geographyLabels[item.geography])}</span><span class="badge ${item.currency === "rub" ? "inactive" : "active"}">${escapeHtml(currencyLabels[item.currency])}</span></div>
        <b>${escapeHtml(item.group_title)}</b>
        <p>${escapeHtml(item.text)}</p>
        ${item.message_url ? `<a href="${escapeHtml(item.message_url)}">Открыть сообщение</a>` : ""}
      </div>
    `).join("") || `<div class="card">Подходящих вакансий не найдено.</div>`
  }
}

function duration(task) {
  if (!task.started_at) return "—"
  const end = task.finished_at ? new Date(task.finished_at) : new Date()
  const seconds = Math.max(0, Math.floor((end - new Date(task.started_at)) / 1000))
  return `${Math.floor(seconds / 60)}м ${seconds % 60}с`
}

async function renderQueue() {
  const rows = await window.scanner.listTasks()
  const container = document.getElementById("queueList")
  if (!container) return

  container.innerHTML = rows.map(task => `
    <div class="card task-card">
      <div class="row between"><div><b>#${task.id} ${escapeHtml(task.task_type)}</b> ${escapeHtml(task.target_title || "")}</div><span class="badge ${task.status === "error" ? "inactive" : task.status === "done" ? "active" : "type"}">${escapeHtml(task.status)}</span></div>
      <p><b>Этап:</b> ${escapeHtml(task.stage || "Ожидает")}</p>
      <div class="progress"><div style="width:${Number(task.progress || 0)}%"></div></div>
      <div class="stats"><span>Прогресс: <b>${task.progress || 0}%</b></span><span>Объекты: <b>${task.current || 0}/${task.total || 0}</b></span><span>Сообщений: <b>${task.messages_scanned || 0}</b></span><span>Сохранено: <b>${task.messages_saved || 0}</b></span><span>Время: <b>${duration(task)}</b></span><span>FLOOD_WAIT: <b>${task.flood_wait_seconds || 0} с</b></span></div>
      ${task.error ? `<p class="error">${escapeHtml(task.error)}</p>` : ""}
    </div>
  `).join("") || `<div class="card">Очередь пуста.</div>`
}

async function queue() {
  stopQueueTimer()
  app.innerHTML = `<h2>Очередь выполнения</h2><div class="card row"><button class="warn" id="pause">Пауза</button><button class="primary" id="resume">Продолжить</button></div><div id="queueList"></div>`
  document.getElementById("pause").onclick = () => window.scanner.pauseQueue(true)
  document.getElementById("resume").onclick = () => window.scanner.pauseQueue(false)
  await renderQueue()
  queueTimer = setInterval(renderQueue, 1000)
}

async function settings() {
  stopQueueTimer()
  const values = await window.scanner.settings()
  const fields = [["search_limit", "Результатов на запрос"], ["min_members", "Минимум участников"], ["active_days", "Последняя активность, дней"], ["min_messages_24h", "Минимум сообщений за 24 часа"], ["min_messages_7d", "Минимум сообщений за 7 дней"], ["preview_limit", "Сообщений для проверки"], ["history_limit", "Сообщений при сканировании"], ["inactive_days", "Неактивна после, дней"], ["max_links_per_group", "Максимум ссылок"], ["min_delay_ms", "Минимальная задержка, мс"], ["max_delay_ms", "Максимальная задержка, мс"]]
  app.innerHTML = `<h2>Настройки</h2><div class="card settings-grid">${fields.map(([key, label]) => `<label>${label}<input id="${key}" value="${escapeHtml(values[key] || "")}"></label>`).join("")}<button class="primary" id="save">Сохранить</button></div>`
  document.getElementById("save").onclick = async () => {
    await window.scanner.saveSettings(Object.fromEntries(fields.map(([key]) => [key, document.getElementById(key).value])))
    alert("Настройки сохранены")
  }
}

const pages = { dashboard, "group-search": groupSearch, groups, messages, queue, settings }
document.querySelectorAll("[data-page]").forEach(button => button.onclick = () => pages[button.dataset.page]())
window.scanner.onEvent(event => {
  if (event.type !== "task-progress") return
  if (document.getElementById("queueList")) renderQueue()
  if (document.getElementById("searchProgress") && Number(event.id) === Number(searchTaskId)) refreshSearchProgress()
})
dashboard()
