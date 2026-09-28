const { Api } = require("telegram")
const { getClient } = require("./client")
const db = require("../database/database")
const { extract } = require("./link-extractor")

function normalizeDate(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "number") {
    const milliseconds = value < 1000000000000 ? value * 1000 : value
    return new Date(milliseconds).toISOString()
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function classify(entity, linkedChatId) {
  if (entity.forum) return "forum"
  if (entity.megagroup) return "supergroup"
  if (entity.broadcast && linkedChatId) return "channel_discussion"
  if (entity.broadcast) return "channel"
  return "group"
}

async function scan(data, progress = () => {}) {
  const client = getClient()
  const entity = await client.getEntity(data.username)
  const settings = db.getSettings()
  let full = null

  progress({
    stage: "Получение полной информации",
    target_title: entity.title || data.username,
    target_username: entity.username || data.username,
    progress: 3,
    last_request_at: new Date().toISOString()
  })

  try {
    full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }))
  } catch {
    full = null
  }

  const fullChat = full?.fullChat || null
  const linkedChatId = fullChat?.linkedChatId ? String(fullChat.linkedChatId) : null
  const linkedChat = linkedChatId
    ? full?.chats?.find(chat => String(chat.id) === linkedChatId)
    : null
  const type = classify(entity, linkedChatId)

  db.upsertGroup({
    telegram_id: String(entity.id),
    username: entity.username || data.username,
    title: entity.title || "",
    description: fullChat?.about || "",
    members_count: Number(fullChat?.participantsCount || entity.participantsCount || 0),
    online_count: Number(fullChat?.onlineCount || 0),
    entity_type: type,
    linked_chat_id: linkedChatId,
    linked_chat_title: linkedChat?.title || null,
    linked_chat_username: linkedChat?.username || null,
    source_group_id: data.source_group_id || null,
    discovery_depth: data.depth || 0,
    last_scanned_at: new Date().toISOString()
  })

  const group = db.findGroupByTelegramId(entity.id)
  const limit = Number(settings.history_limit || 500)
  const maxLinks = Number(settings.max_links_per_group || 30)
  let messagesScanned = 0
  let messagesSaved = 0
  let linksFound = 0
  let lastMessageAt = null
  let messages24h = 0
  let messages7d = 0
  let messages30d = 0
  const now = Date.now()

  progress({
    stage: "Сканирование сообщений",
    entity_type: type,
    total: limit,
    progress: 5
  })

  for await (const message of client.iterMessages(entity, { limit })) {
    const text = message.message || ""
    const date = normalizeDate(message.date)
    const links = extract(text).slice(0, Math.max(0, maxLinks - linksFound))

    if (date) {
      if (!lastMessageAt || date > lastMessageAt) lastMessageAt = date
      const age = now - new Date(date).getTime()
      if (age <= 86400000) messages24h += 1
      if (age <= 7 * 86400000) messages7d += 1
      if (age <= 30 * 86400000) messages30d += 1
    }

    const added = db.addMessage({
      telegram_message_id: message.id,
      group_id: group.id,
      sender_id: message.senderId ? String(message.senderId) : null,
      text,
      message_date: date,
      message_url: entity.username
        ? `https://t.me/${entity.username}/${message.id}`
        : null,
      has_links: links.length ? 1 : 0,
      matched_keywords: null
    })

    if (added) messagesSaved += 1

    for (const link of links) {
      if (db.addLink({
        source_group_id: group.id,
        target_username: link.username,
        message_id: message.id,
        telegram_url: link.url
      })) {
        linksFound += 1
      }
    }

    messagesScanned += 1

    if (messagesScanned % 10 === 0 || messagesScanned === limit) {
      progress({
        stage: "Сканирование сообщений",
        messages_scanned: messagesScanned,
        messages_saved: messagesSaved,
        links_found: linksFound,
        current: messagesScanned,
        total: limit,
        progress: Math.min(90, 5 + Math.round((messagesScanned / limit) * 85)),
        last_request_at: new Date().toISOString()
      })
    }
  }

  const inactiveDays = Number(settings.inactive_days || 7)
  const lastAge = lastMessageAt
    ? (now - new Date(lastMessageAt).getTime()) / 86400000
    : Number.POSITIVE_INFINITY
  const activityStatus = lastAge > inactiveDays
    ? "inactive"
    : messages7d >= 50
      ? "high"
      : messages7d >= 15
        ? "active"
        : "weak"
  const isActive = Number(group.members_count || 0) >= Number(settings.min_members || 300) &&
    lastAge <= Number(settings.active_days || 3) &&
    messages24h >= Number(settings.min_messages_24h || 3) &&
    messages7d >= Number(settings.min_messages_7d || 15)

  db.upsertGroup({
    ...group,
    messages_24h: messages24h,
    messages_7d: messages7d,
    messages_30d: messages30d,
    average_messages_day: Number((messages30d / 30).toFixed(2)),
    last_message_at: lastMessageAt,
    activity_status: activityStatus,
    is_active: isActive,
    last_scanned_at: new Date().toISOString()
  })
  db.flush()

  progress({
    stage: linkedChatId ? "Канал и обсуждение обработаны" : "Сканирование завершено",
    progress: 100,
    messages_scanned: messagesScanned,
    messages_saved: messagesSaved,
    links_found: linksFound,
    related_groups_found: linkedChatId ? 1 : 0,
    current: messagesScanned,
    total: messagesScanned
  })

  return { messagesScanned, messagesSaved, linksFound, linkedChatId }
}

module.exports = { scan }
