require("dotenv").config()

const QRCode = require("qrcode")
const { Api, TelegramClient } = require("telegram")
const { StringSession } = require("telegram/sessions")
const session = require("./session")

const apiId = Number(process.env.TELEGRAM_API_ID)
const apiHash = process.env.TELEGRAM_API_HASH

let client = null
let loginState = null
let qrLoginRunning = false
let passwordResolver = null
let passwordRejecter = null

function getClient() {
  if (!client) {
    client = new TelegramClient(
      new StringSession(session.load()),
      apiId,
      apiHash,
      {
        connectionRetries: 5
      }
    )
  }

  return client
}

async function isAuthorized() {
  try {
    const currentClient = getClient()
    await currentClient.connect()
    return await currentClient.checkAuthorization()
  } catch {
    return false
  }
}

async function beginLogin(data) {
  const phone = String(data?.phone || "").trim()

  if (!phone) {
    throw new Error("Введите номер телефона в международном формате")
  }

  const currentClient = getClient()
  await currentClient.connect()

  const sentCode = await currentClient.sendCode(
    {
      apiId,
      apiHash
    },
    phone
  )

  loginState = {
    phone,
    phoneCodeHash: sentCode.phoneCodeHash
  }

  return {
    step: "code",
    type: sentCode.type?.className || "unknown",
    nextType: sentCode.nextType?.className || null,
    timeout: sentCode.timeout || null
  }
}

async function submitCode(data) {
  if (!loginState) {
    throw new Error("Сначала запросите код авторизации")
  }

  const code = String(data?.code || "").trim()

  if (!code) {
    throw new Error("Введите код из Telegram")
  }

  const currentClient = getClient()

  try {
    await currentClient.invoke(
      new Api.auth.SignIn({
        phoneNumber: loginState.phone,
        phoneCodeHash: loginState.phoneCodeHash,
        phoneCode: code
      })
    )

    session.save(currentClient.session.save())
    loginState = null

    return {
      step: "done"
    }
  } catch (error) {
    if (error.errorMessage === "SESSION_PASSWORD_NEEDED") {
      return {
        step: "password"
      }
    }

    throw error
  }
}

async function startQrLogin(emit) {
  if (qrLoginRunning) {
    return {
      started: true
    }
  }

  const currentClient = getClient()
  await currentClient.connect()

  if (await currentClient.checkAuthorization()) {
    emit({
      type: "qr-login-success"
    })

    return {
      started: true,
      authorized: true
    }
  }

  qrLoginRunning = true

  currentClient
    .signInUserWithQrCode(
      {
        apiId,
        apiHash
      },
      {
        qrCode: async qrCode => {
          const token = qrCode.token.toString("base64url")
          const loginUrl = `tg://login?token=${token}`
          const dataUrl = await QRCode.toDataURL(loginUrl, {
            width: 280,
            margin: 2,
            errorCorrectionLevel: "M"
          })

          emit({
            type: "qr-login-code",
            dataUrl,
            expires: qrCode.expires
          })
        },
        password: async () => {
          emit({
            type: "qr-login-password"
          })

          return new Promise((resolve, reject) => {
            passwordResolver = resolve
            passwordRejecter = reject
          })
        },
        onError: error => {
          emit({
            type: "qr-login-error",
            error: error.message
          })
        }
      }
    )
    .then(() => {
      session.save(currentClient.session.save())
      qrLoginRunning = false
      passwordResolver = null
      passwordRejecter = null

      emit({
        type: "qr-login-success"
      })
    })
    .catch(error => {
      qrLoginRunning = false
      passwordResolver = null
      passwordRejecter = null

      emit({
        type: "qr-login-error",
        error: error.message
      })
    })

  return {
    started: true
  }
}

async function submitPassword(value) {
  const password = String(value || "")

  if (passwordResolver) {
    passwordResolver(password)
    passwordResolver = null
    passwordRejecter = null

    return {
      step: "waiting"
    }
  }

  const currentClient = getClient()

  await currentClient.signInWithPassword(
    {
      apiId,
      apiHash
    },
    {
      password: async () => password,
      onError: error => {
        throw error
      }
    }
  )

  session.save(currentClient.session.save())
  loginState = null

  return {
    step: "done"
  }
}

async function logout() {
  if (passwordRejecter) {
    passwordRejecter(new Error("Авторизация отменена"))
  }

  if (client) {
    await client.disconnect()
  }

  client = null
  loginState = null
  qrLoginRunning = false
  passwordResolver = null
  passwordRejecter = null
  session.clear()

  return true
}

module.exports = {
  getClient,
  isAuthorized,
  beginLogin,
  submitCode,
  startQrLogin,
  submitPassword,
  logout
}
