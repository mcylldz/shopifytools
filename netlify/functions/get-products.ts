import type { Handler } from '@netlify/functions'
import { getAccessToken, SHOPIFY_DOMAIN } from './shopify-auth'

export const handler: Handler = async (event) => {
  if (!SHOPIFY_DOMAIN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SHOPIFY_STORE_DOMAIN env variable eksik.' }),
    }
  }

  const params = event.queryStringParameters || {}
  const tag = params.tag || ''
  const status = params.status || 'any'
  const limit = Math.min(Number(params.limit) || 250, 250)

  try {
    const token = await getAccessToken()

    const qs = new URLSearchParams()
    qs.set('limit', String(limit))
    qs.set('fields', 'id,title,status,tags,variants')
    if (status !== 'any') qs.set('status', status)

    let allProducts: unknown[] = []
    let nextUrl: string | null = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json?${qs.toString()}`

    while (nextUrl) {
      const res: Response = await fetch(nextUrl, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
      })

      if (!res.ok) {
        const text: string = await res.text()
        throw new Error(`Shopify API hatası (${res.status}): ${text}`)
      }

      const data = await res.json()
      allProducts = allProducts.concat(data.products || [])

      // Shopify Link header tam URL döndürür — doğrudan kullan
      const linkHeader: string = res.headers.get('Link') || ''
      const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      nextUrl = nextMatch ? nextMatch[1] : null
    }

    // Etiket filtresi
    const filtered = tag
      ? allProducts.filter((p: any) => {
          const tags: string[] = (p.tags || '').split(',').map((t: string) => t.trim().toLowerCase())
          return tags.includes(tag.toLowerCase())
        })
      : allProducts

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: filtered }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
