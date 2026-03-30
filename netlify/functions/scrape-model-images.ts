import type { Handler } from '@netlify/functions'

// Shopify mağazasından ürün görsellerini çeker (manken görselleri için)
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { url } = JSON.parse(event.body || '{}')

    if (!url) {
      return { statusCode: 400, body: JSON.stringify({ error: 'url gerekli' }) }
    }

    // Shopify URL parse
    const match = url.match(/https?:\/\/([^/]+)\/(?:.*\/)?products\/([^/?#]+)/)
    if (!match) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Geçersiz Shopify ürün URL formatı' }),
      }
    }

    const [, store, handle] = match
    const jsonUrl = `https://${store}/products/${handle}.json`

    const res = await fetch(jsonUrl)
    if (!res.ok) {
      throw new Error(`Ürün alınamadı: ${res.status}`)
    }

    const { product } = await res.json()

    const images = (product.images || []).map((img: any) => img.src)

    console.log(`[scrape-model-images] ${store}/${handle}: ${images.length} görseller çekildi`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        title: product.title,
        images,
      }),
    }
  } catch (err: any) {
    console.error(`[scrape-model-images] Error: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
