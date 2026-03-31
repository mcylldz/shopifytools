import type { Handler } from '@netlify/functions'
import { getAccessToken, SHOPIFY_DOMAIN } from './shopify-auth'

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!SHOPIFY_DOMAIN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SHOPIFY_STORE_DOMAIN eksik' }) }
  }

  try {
    const token = await getAccessToken()
    const { productId, imageUrl, imageBase64, position, alt } = JSON.parse(event.body || '{}')

    if (!productId) throw new Error('productId gerekli')
    if (!imageUrl && !imageBase64) throw new Error('imageUrl veya imageBase64 gerekli')

    // Numeric product ID
    const numericId = String(productId).replace(/.*\//, '')

    // Build image payload
    const imagePayload: any = { position: position || 1 }
    if (alt) imagePayload.alt = alt

    if (imageBase64) {
      // Base64 data — strip data URL prefix if present
      imagePayload.attachment = imageBase64.replace(/^data:[^;]+;base64,/, '')
    } else {
      imagePayload.src = imageUrl
    }

    // Upload image via REST API
    const res = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products/${numericId}/images.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
        body: JSON.stringify({ image: imagePayload }),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Shopify image upload hatası (${res.status}): ${text.substring(0, 200)}`)
    }

    const data = await res.json()
    const image = data.image

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        image: {
          id: image.id,
          src: image.src,
          position: image.position,
          width: image.width,
          height: image.height,
        },
      }),
    }
  } catch (err: any) {
    console.error(`[push-image] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
