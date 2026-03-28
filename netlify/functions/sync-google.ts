import type { Handler } from '@netlify/functions'
import { GoogleAuth } from 'google-auth-library'

const MERCHANT_ID = process.env.GOOGLE_MERCHANT_ID || ''

interface GoogleSyncItem {
  productId: string   // Shopify numeric product ID (e.g. "8531344228597")
  variantId: string   // Shopify numeric variant ID (e.g. "46564222468341")
  enrichment: {
    gender?: string
    age_group?: string
    color?: string
    size?: string
    material?: string
    pattern?: string
    product_type?: string
    custom_label_0?: string
    custom_label_1?: string
    custom_label_2?: string
    custom_label_3?: string
    custom_label_4?: string
  }
}

// Service Account ile access token al
async function getAccessToken(): Promise<string> {
  const keyJson = process.env.GOOGLE_MERCHANT_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_MERCHANT_SERVICE_ACCOUNT_KEY env variable eksik')

  const credentials = JSON.parse(keyJson)
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/content'],
  })

  const client = await auth.getClient()
  const tokenRes = await client.getAccessToken()
  if (!tokenRes.token) throw new Error('Google access token alınamadı')
  return tokenRes.token
}

// Tek bir variant'ı Google Merchant'a güncelle
async function updateProduct(
  accessToken: string,
  item: GoogleSyncItem
): Promise<{ variantId: string; success: boolean; error?: string }> {
  // Shopify Google kanalı ürünleri bu formatta gönderir:
  // online:tr:TR:shopify_TR_{productId}_{variantId}
  const offerId = `shopify_TR_${item.productId}_${item.variantId}`
  const productRef = `online:tr:TR:${offerId}`
  const url = `https://shoppingcontent.googleapis.com/content/v2.1/${MERCHANT_ID}/products/${encodeURIComponent(productRef)}`

  const e = item.enrichment
  const body: Record<string, any> = {}

  // Sadece dolu alanları gönder
  if (e.gender) body.gender = e.gender
  if (e.age_group) body.ageGroup = e.age_group
  if (e.color) body.color = e.color
  if (e.size) body.sizes = [e.size]
  if (e.material) body.material = e.material
  if (e.pattern) body.pattern = e.pattern
  if (e.product_type) body.productTypes = [e.product_type]

  // Custom labels — Google Content API UPDATE'de customAttributes kabul etmiyor
  // custom_label_0-4 doğrudan standart alanlar olarak gönder
  if (e.custom_label_0) body.customLabel0 = e.custom_label_0
  if (e.custom_label_1) body.customLabel1 = e.custom_label_1
  if (e.custom_label_2) body.customLabel2 = e.custom_label_2
  if (e.custom_label_3) body.customLabel3 = e.custom_label_3
  if (e.custom_label_4) body.customLabel4 = e.custom_label_4

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (res.status === 404) {
      // Ürün Google'da bulunamadı — offerId formatı farklı olabilir
      console.log(`[google-sync] 404: ${productRef} — Google'da bulunamadı`)
      return { variantId: item.variantId, success: false, error: `404: ${offerId} bulunamadı` }
    }

    if (res.status === 429) {
      // Rate limit — backoff
      console.log(`[google-sync] 429: rate limit — ${offerId}`)
      return { variantId: item.variantId, success: false, error: 'Rate limited' }
    }

    if (!res.ok) {
      const errText = await res.text()
      console.error(`[google-sync] ${res.status}: ${errText.substring(0, 300)}`)
      return { variantId: item.variantId, success: false, error: `${res.status}: ${errText.substring(0, 200)}` }
    }

    const result = await res.json()
    console.log(`[google-sync] ✅ ${offerId} güncellendi`)
    return { variantId: item.variantId, success: true }
  } catch (err: any) {
    console.error(`[google-sync] Exception: ${err.message}`)
    return { variantId: item.variantId, success: false, error: err.message }
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // Env var kontrolü — yoksa graceful skip
  if (!process.env.GOOGLE_MERCHANT_SERVICE_ACCOUNT_KEY) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        skipped: true,
        error: 'GOOGLE_MERCHANT_SERVICE_ACCOUNT_KEY env variable eksik — Google sync atlandı',
      }),
    }
  }

  if (!MERCHANT_ID) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        skipped: true,
        error: 'GOOGLE_MERCHANT_ID env variable eksik — Google sync atlandı',
      }),
    }
  }

  let items: GoogleSyncItem[]
  try {
    const body = JSON.parse(event.body || '{}')
    if (Array.isArray(body.items)) {
      items = body.items
    } else if (body.productId && body.variantId) {
      items = [{ productId: body.productId, variantId: body.variantId, enrichment: body.enrichment }]
    } else {
      throw new Error('items[] veya productId/variantId gerekli')
    }
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) }
  }

  try {
    console.log(`[google-sync] ${items.length} variant Google Merchant'a gönderiliyor`)

    const accessToken = await getAccessToken()

    // Her variant için sırayla güncelle (rate limit koruması)
    const results: { variantId: string; success: boolean; error?: string }[] = []
    let successCount = 0

    for (const item of items) {
      const result = await updateProduct(accessToken, item)
      results.push(result)
      if (result.success) successCount++

      // Basit rate limiting — 100ms arası
      if (items.length > 1) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    const allSuccess = successCount === items.length
    const errors = results.filter((r) => !r.success)

    console.log(`[google-sync] Tamamlandı: ${successCount}/${items.length} başarılı`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: allSuccess,
        total: items.length,
        successCount,
        failedCount: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
    }
  } catch (err: any) {
    console.error(`[google-sync] Fatal: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
