/**
 * Shopify Client Credentials Token Manager — with debug logging
 */

interface TokenCache {
  token: string
  expiresAt: number
}

let cache: TokenCache | null = null

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || ''
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || ''
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || ''

const BUFFER_MS = 5 * 60 * 1000

const mask = (v: string) =>
  v.length > 8 ? v.slice(0, 4) + '****' + v.slice(-4) : v ? '****' : '(boş)'

export async function getAccessToken(): Promise<string> {
  const now = Date.now()

  console.log('[shopify-auth] getAccessToken çağrıldı')
  console.log(`[shopify-auth] SHOPIFY_STORE_DOMAIN = "${DOMAIN || '(boş)'}"`)
  console.log(`[shopify-auth] SHOPIFY_CLIENT_ID    = "${mask(CLIENT_ID)}"`)
  console.log(`[shopify-auth] SHOPIFY_CLIENT_SECRET= "${mask(CLIENT_SECRET)}"`)

  if (cache && cache.expiresAt - now > BUFFER_MS) {
    console.log('[shopify-auth] Cache geçerli, mevcut token kullanılıyor')
    return cache.token
  }

  if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
    const missing = [
      !DOMAIN && 'SHOPIFY_STORE_DOMAIN',
      !CLIENT_ID && 'SHOPIFY_CLIENT_ID',
      !CLIENT_SECRET && 'SHOPIFY_CLIENT_SECRET',
    ].filter(Boolean).join(', ')
    const msg = `Eksik env variable(lar): ${missing}`
    console.error('[shopify-auth] ' + msg)
    throw new Error(msg)
  }

  const url = `https://${DOMAIN}/admin/oauth/access_token`
  console.log(`[shopify-auth] Token isteği gönderiliyor: POST ${url}`)

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'client_credentials',
  })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  console.log(`[shopify-auth] Shopify yanıtı: ${res.status} ${res.statusText}`)

  if (!res.ok) {
    const text = await res.text()
    // HTML'den sadece hata metnini çek
    const match = text.match(/Oauth error[^<\n]+/)
    const errMsg = match ? match[0].trim() : text.slice(0, 300)
    console.error(`[shopify-auth] Token alınamadı: ${errMsg}`)
    throw new Error(`Shopify token alınamadı (${res.status}): ${errMsg}`)
  }

  const data = await res.json()
  const expiresIn = data.expires_in ?? 86399
  console.log(`[shopify-auth] Token başarıyla alındı! expires_in=${expiresIn}, scope="${data.scope}"`)

  cache = {
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
  }

  return cache.token
}

export const SHOPIFY_DOMAIN = DOMAIN
