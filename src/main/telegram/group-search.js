const { Api } = require("telegram")
const { getClient } = require("./client")
const db = require("../database/database")
const { wait } = require("./flood-control")

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) return value

  if (typeof value === "number") {
    return new Date(value < 1000000000000 ? value * 1000 : value)
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function classify(entity, linkedChatId) {
  if (entity.forum) return "forum"
  if (entity.megagroup) return "supergroup"
  if (entity.broadcast && linkedChatId) return "channel_discussion"
  if (entity.broadcast) return "channel"
  return "group"
}

function activityStatus(lastMessageAt, messages7d, inactiveDays) {
  if (!lastMessageAt) return "unavailable"

  const age = Date.now() - new Date(lastMessageAt).getTime()

  if (age > inactiveDays * 86400000) return "inactive"
  if (messages7d >= 50) return "high"
  if (messages7d >= 15) return "active"
  return "weak"
}

function isUnavailableError(error) {
  const message = String(error?.message || error || "")

  return message.includes("CHANNEL_INVALID") ||
    message.includes("CHANNEL_PRIVATE") ||
    message.includes("Could not find the input entity") ||
    message.includes("USERNAME_INVALID") ||
    message.includes("USERNAME_NOT_OCCUPIED")
}

async function resolveEntity(client, candidate) {
  const username = String(candidate?.username || "").replace(/^@/, "").trim()

  if (!username) {
    return null
  }

  try {
    return await client.getEntity(username)
  } catch {
    try {
      const resolved = await client.invoke(
        new Api.contacts.ResolveUsername({ username })
      )

      return resolved.chats?.find(chat => chat.username === username) || null
    } catch {
      return null
    }
  }
}

async function inspectCandidate(client, candidate, settings) {
  const entity = await resolveEntity(client, candidate)

  if (!entity || !entity.username) {
    return null
  }

  let full = null

  try {
    full = await client.invoke(
      new Api.channels.GetFullChannel({ channel: entity })
    )
  } catch (error) {
    if (!isUnavailableError(error)) {
      throw error
    }
  }

  const fullChat = full?.fullChat || null
  const linkedChatId = fullChat?.linkedChatId
    ? String(fullChat.linkedChatId)
    : null
  const linkedChat = linkedChatId
    ? full?.chats?.find(chat => String(chat.id) === linkedChatId)
    : null
  const previewLimit = Number(settings.preview_limit || 100)
  let messages = []

  try {
    messages = await client.getMessages(entity.username, {
      limit: previewLimit
    })
  } catch (error) {
    if (isUnavailableError(error)) {
      return null
    }

    throw error
  }

  const currentTime = Date.now()
  let messages24h = 0
  let messages7d = 0
  let messages30d = 0
  let lastMessageAt = null

  for (const message of messages) {
    const date = toDate(message.date)

    if (!date) continue
    if (!lastMessageAt || date > lastMessageAt) lastMessageAt = date

    const age = currentTime - date.getTime()

    if (age <= 86400000) messages24h += 1
    if (age <= 7 * 86400000) messages7d += 1
    if (age <= 30 * 86400000) messages30d += 1
  }

  const type = classify(entity, linkedChatId)
  const membersCount = Number(
    fullChat?.participantsCount || entity.participantsCount || 0
  )
  const onlineCount = Number(fullChat?.onlineCount || 0)
  const lastMessageIso = lastMessageAt?.toISOString() || null
  const status = activityStatus(
    lastMessageIso,
    messages7d,
    Number(settings.inactive_days || 7)
  )
  const lastAgeDays = lastMessageAt
    ? (currentTime - lastMessageAt.getTime()) / 86400000
    : Number.POSITIVE_INFINITY
  const isActive = membersCount >= Number(settings.min_members || 300) &&
    lastAgeDays <= Number(settings.active_days || 3) &&
    messages24h >= Number(settings.min_messages_24h || 3) &&
    messages7d >= Number(settings.min_messages_7d || 15)

  return {
    telegram_id: String(entity.id),
    username: entity.username,
    title: entity.title || candidate.title || "",
    description: fullChat?.about || "",
    members_count: membersCount,
    online_count: onlineCount,
    entity_type: type,
    linked_chat_id: linkedChatId,
    linked_chat_title: linkedChat?.title || null,
    linked_chat_username: linkedChat?.username || null,
    messages_24h: messages24h,
    messages_7d: messages7d,
    messages_30d: messages30d,
    average_messages_day: Number((messages30d / 30).toFixed(2)),
    last_message_at: lastMessageIso,
    activity_status: status,
    is_active: isActive,
    last_scanned_at: new Date().toISOString(),
    source_group_id: null,
    discovery_depth: 0
  }
}

function parseSearchRequest(query) {
  const source = String(query || "").trim()
  const extendedPrefix = "__extended__:"

  if (source.startsWith(extendedPrefix)) {
    return {
      query: source.slice(extendedPrefix.length).trim(),
      extended: true
    }
  }

  return {
    query: source,
    extended: false
  }
}

function buildQueries(query, extended) {
  const source = String(query || "").trim()

  if (!extended) {
    return [source].filter(value => value.length >= 3)
  }

  const variants = [
    source,
    "фриланс",
    "удаленная работа",
    "IT вакансии",
    "заказы разработка",
    "remote work",
    "remote jobs",
    "freelance jobs",
    "developer jobs",
    "international jobs",
    "relocation jobs",
    "віддалена робота",
    "український фриланс",
    "робота для українців"
  ]

  return [...new Set(variants.filter(value => value.length >= 3))]
}

function addCandidates(target, chats) {
  for (const item of chats || []) {
    const username = String(item.username || "").replace(/^@/, "").trim()

    if (!username) continue

    target.set(username.toLowerCase(), {
      username,
      title: item.title || username
    })
  }
}

async function collectCandidates(client, query, limit) {
  const candidates = new Map()

  try {
    const result = await client.invoke(
      new Api.contacts.Search({ q: query, limit })
    )

    addCandidates(candidates, result.chats)
  } catch {
  }

  for (const groupsOnly of [true, false]) {
    try {
      const result = await client.invoke(
        new Api.messages.SearchGlobal({
          q: query,
          filter: new Api.InputMessagesFilterEmpty(),
          minDate: 0,
          maxDate: 0,
          offsetRate: 0,
          offsetPeer: new Api.InputPeerEmpty(),
          offsetId: 0,
          limit,
          groupsOnly
        })
      )

      addCandidates(candidates, result.chats)
    } catch {
    }
  }

  return candidates
}

async function search(query, progress = () => {}) {
  const client = getClient()
  const settings = db.getSettings()
  const limit = Math.min(100, Number(settings.search_limit || 100))
  const request = parseSearchRequest(query)
  const queries = buildQueries(request.query, request.extended)
  const allCandidates = new Map()

  progress({
    stage: request.extended ? "Расширенный поиск источников" : "Обычный поиск источников",
    current: 0,
    total: queries.length,
    progress: 2,
    error: null
  })

  for (let index = 0; index < queries.length; index += 1) {
    const searchQuery = queries[index]
    const found = await collectCandidates(client, searchQuery, limit)

    for (const [username, candidate] of found) {
      allCandidates.set(username, candidate)
    }

    progress({
      stage: `Поисковая фраза: ${searchQuery}`,
      current: index + 1,
      total: queries.length,
      related_groups_found: allCandidates.size,
      progress: Math.min(
        35,
        2 + Math.round(((index + 1) / queries.length) * 33)
      ),
      last_request_at: new Date().toISOString(),
      error: null
    })

    await wait(700 + Math.floor(Math.random() * 500))
  }

  const candidates = [...allCandidates.values()]
  let active = 0
  let saved = 0
  let skipped = 0

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const delay = 900 + Math.floor(Math.random() * 800)

    progress({
      stage: `Проверка активности: ${candidate.title || candidate.username}`,
      target_title: candidate.title || candidate.username,
      target_username: candidate.username,
      current: index + 1,
      total: candidates.length,
      progress: 36 + Math.round(
        ((index + 1) / Math.max(candidates.length, 1)) * 62
      ),
      delay_ms: delay,
      last_request_at: new Date().toISOString(),
      error: null
    })

    try {
      const group = await inspectCandidate(client, candidate, settings)

      if (!group) {
        skipped += 1
      } else {
        db.upsertGroup(group)
        saved += 1

        if (group.is_active) active += 1
      }
    } catch (error) {
      skipped += 1

      if (!isUnavailableError(error)) {
        progress({
          stage: `Пропущено: ${candidate.title || candidate.username}`,
          error: String(error.message || error)
        })
      }
    }

    await wait(delay)
  }

  progress({
    stage: `${request.extended ? "Расширенный" : "Обычный"} поиск завершён. Пропущено: ${skipped}`,
    progress: 100,
    current: candidates.length,
    total: candidates.length,
    messages_saved: saved,
    related_groups_found: active,
    delay_ms: 0,
    error: null
  })

  return {
    queries: queries.length,
    found: candidates.length,
    saved,
    active,
    skipped
  }
}

module.exports = {
  search
}
