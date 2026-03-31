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
    const { productId, imageUrl, imageBase64, position, pushMode } = JSON.parse(event.body || '{}')

    if (!productId) throw new Error('productId gerekli')
    if (!imageUrl && !imageBase64) throw new Error('imageUrl veya imageBase64 gerekli')

    const numericId = String(productId).replace(/.*\//, '')
    const pos = parseInt(position) || 1
    const mode = pushMode || 'add' // 'add' or 'replace'

    // ── REPLACE MODE: Sıradaki görseli sil, yerine yenisini koy ──
    if (mode === 'replace') {
      // 1. Mevcut görselleri al
      const listRes = await fetch(
        `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products/${numericId}/images.json`,
        { headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token } }
      )
      if (!listRes.ok) throw new Error(`Ürün görselleri alınamadı: ${listRes.status}`)

      const listData = await listRes.json()
      const existingImages = listData.images || []

      // 2. Belirtilen sıradaki görseli bul ve sil
      const imageToDelete = existingImages.find((img: any) => img.position === pos)
      if (imageToDelete) {
        const delRes = await fetch(
          `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products/${numericId}/images/${imageToDelete.id}.json`,
          { method: 'DELETE', headers: { 'X-Shopify-Access-Token': token } }
        )
        if (!delRes.ok) {
          console.warn(`[push-image] Görsel silinemedi (${delRes.status}), devam ediliyor`)
        } else {
          console.log(`[push-image] Eski görsel silindi: position=${pos}, id=${imageToDelete.id}`)
        }
      }
    }

    // ── Upload new image ──
    const imagePayload: any = { position: pos }
    if (imageBase64) {
      imagePayload.attachment = imageBase64.replace(/^data:[^;]+;base64,/, '')
    } else {
      imagePayload.src = imageUrl
    }

    const res = await fetch(
      `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products/${numericId}/images.json`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ image: imagePayload }),
      }
    )

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Shopify image upload hatası (${res.status}): ${text.substring(0, 200)}`)
    }

    const data = await res.json()
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        mode,
        image: { id: data.image.id, src: data.image.src, position: data.image.position },
      }),
    }
  } catch (err: any) {
    console.error(`[push-image] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
