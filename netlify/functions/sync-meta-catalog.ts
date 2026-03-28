import type { Handler } from '@netlify/functions'

const CATALOG_ID = process.env.META_CATALOG_ID || ''
const META_API_VERSION = 'v21.0'

interface MetaSyncRequest {
  retailer_id: string
  enrichment: {
    gender?: string
    age_group?: string
    color?: string
    size?: string
    material?: string
    pattern?: string
    fb_product_category?: string
    short_description?: string
    custom_label_0?: string
    custom_label_1?: string
    custom_label_2?: string
    custom_label_3?: string
    custom_label_4?: string
    shipping_weight_value?: string
    shipping_weight_unit?: string
    return_policy_days?: string
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const accessToken = process.env.META_CATALOG_ACCESS_TOKEN
  if (!accessToken) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        skipped: true,
        error: 'META_CATALOG_ACCESS_TOKEN env variable eksik — Meta sync atlandı',
      }),
    }
  }

  if (!CATALOG_ID) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        skipped: true,
        error: 'META_CATALOG_ID env variable eksik — Meta sync atlandı',
      }),
    }
  }

  let requests: MetaSyncRequest[]
  try {
    const body = JSON.parse(event.body || '{}')
    // Tek ürün veya birden fazla
    if (body.retailer_id) {
      requests = [{ retailer_id: body.retailer_id, enrichment: body.enrichment }]
    } else if (Array.isArray(body.items)) {
      requests = body.items
    } else {
      throw new Error('retailer_id veya items[] gerekli')
    }
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) }
  }

  try {
    // Meta Batch API — max 5000 items per batch
    const batchRequests = requests.map((req) => {
      const e = req.enrichment
      const data: Record<string, string> = {}

      // Sadece Meta'nın kabul ettiği alanları gönder
      if (e.gender) data.gender = e.gender
      if (e.age_group) data.age_group = e.age_group
      if (e.color) data.color = e.color
      if (e.size) data.size = e.size
      if (e.material) data.material = e.material
      if (e.pattern) data.pattern = e.pattern
      if (e.fb_product_category) data.fb_product_category = e.fb_product_category
      if (e.custom_label_0) data.custom_label_0 = e.custom_label_0
      if (e.custom_label_1) data.custom_label_1 = e.custom_label_1
      if (e.custom_label_2) data.custom_label_2 = e.custom_label_2
      if (e.custom_label_3) data.custom_label_3 = e.custom_label_3
      if (e.custom_label_4) data.custom_label_4 = e.custom_label_4
      // shipping_weight: birleşik string "300 g" formatında
      if (e.shipping_weight_value && e.shipping_weight_unit) {
        data.shipping_weight = `${e.shipping_weight_value} ${e.shipping_weight_unit}`
      }
      // KALDIRILDI: short_description, shipping_weight_value, shipping_weight_unit, return_policy_days
      // (Meta bu field isimlerini tanımıyor)

      return {
        method: 'UPDATE',
        retailer_id: req.retailer_id,
        data,
      }
    })

    console.log(`[meta-sync] ${batchRequests.length} ürün Meta'ya gönderiliyor`)

    const response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${CATALOG_ID}/batch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          allow_upsert: false,
          requests: batchRequests,
        }),
      }
    )

    const result = await response.json()

    if (result.error) {
      console.error(`[meta-sync] API Error: ${JSON.stringify(result.error)}`)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: result.error.message || JSON.stringify(result.error),
        }),
      }
    }

    // Meta batch API validation_status kontrolü
    // API 200 dönüp ama per-item validation hatası verebilir
    const handles = result.handles || []
    const validationErrors: string[] = []
    
    if (Array.isArray(handles)) {
      for (const handle of handles) {
        if (handle.status === 'error' || handle.errors?.length > 0) {
          const errs = (handle.errors || []).map((e: any) => e.message || JSON.stringify(e)).join('; ')
          validationErrors.push(`retailer_id=${handle.retailer_id}: ${errs}`)
          console.error(`[meta-sync] Validation error: retailer_id=${handle.retailer_id}: ${errs}`)
        }
      }
    }

    console.log(`[meta-sync] Response: ${JSON.stringify(result).substring(0, 500)}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: validationErrors.length === 0,
        handles: result,
        validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      }),
    }
  } catch (err: any) {
    console.error(`[meta-sync] Hata: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
