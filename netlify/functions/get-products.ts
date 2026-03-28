import type { Handler } from '@netlify/functions'
import { getAccessToken, SHOPIFY_DOMAIN } from './shopify-auth'

interface SlimVariant {
  id: string
  title: string
  price: string
  compare_at_price: string | null
}

interface SlimProduct {
  id: number
  title: string
  status: string
  tags: string
  variants: SlimVariant[]
}

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

  try {
    const token = await getAccessToken()

    const qs = new URLSearchParams()
    qs.set('limit', '250')
    qs.set('fields', 'id,title,status,tags,variants')
    if (status !== 'any') qs.set('status', status)

    const allProducts: SlimProduct[] = []
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
      const products = data.products || []

      // Sadece gerekli alanları al — response boyutunu küçült
      for (const p of products) {
        const variants: SlimVariant[] = (p.variants || []).map((v: any) => ({
          id: String(v.id),
          title: v.title || 'Default Title',
          price: v.price,
          compare_at_price: v.compare_at_price,
        }))

        allProducts.push({
          id: p.id,
          title: p.title,
          status: p.status,
          tags: p.tags || '',
          variants,
        })
      }

      // Shopify Link header tam URL döndürür
      const linkHeader: string = res.headers.get('Link') || ''
      const nextMatch: RegExpMatchArray | null = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      nextUrl = nextMatch ? nextMatch[1] : null
    }

    // Etiket filtresi
    const filtered = tag
      ? allProducts.filter((p) => {
          const tags = p.tags.split(',').map((t) => t.trim().toLowerCase())
          return tags.includes(tag.toLowerCase())
        })
      : allProducts

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: filtered,
        totalProducts: filtered.length,
        totalVariants: filtered.reduce((sum, p) => sum + p.variants.length, 0),
      }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
