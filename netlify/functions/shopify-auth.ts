/**
 * Shopify Client Credentials Token Manager
 *
 * Yeni Shopify sistemi kalıcı access token kullanmıyor.
 * CLIENT_ID + CLIENT_SECRET ile 24 saatlik token alınıyor.
 * Token Netlify Functions process belleğinde cache'leniyor;
 * süre dolmadan 5 dakika önce otomatik yenileniyor.
 */

interface TokenCache {
  token: string
  expiresAt: number // Unix ms
}

// Serverless function'lar arasında paylaşılan basit in-memory cache
// (aynı Netlify instance'ında çalışan fonksiyonlar için yeterli)
let cache: TokenCache | null = null

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || ''
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || ''
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || ''

// Token'ın bitmesine 5 dakika kaldığında yenile
const BUFFER_MS = 5 * 60 * 1000

export async function getAccessToken(): Promise<string> {
  const now = Date.now()

  // Cache geçerli mi?
  if (cache && cache.expiresAt - now > BUFFER_MS) {
    return cache.token
  }

  if (!DOMAIN || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID ve SHOPIFY_CLIENT_SECRET env variable\'ları eksik.'
    )
  }

  // Shopify OAuth token endpoint'ine POST at
  // OAuth 2.0 standardı: application/x-www-form-urlencoded formatı gereklidir
  const url = `https://${DOMAIN}/admin/oauth/access_token`
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

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify token alınamadı (${res.status}): ${text}`)
  }

  const data = await res.json()
  // expires_in = 86399 (24 saat)
  const expiresIn = data.expires_in ?? 86399
  cache = {
    token: data.access_token,
    expiresAt: now + expiresIn * 1000,
  }

  return cache.token
}

export const SHOPIFY_DOMAIN = DOMAIN
