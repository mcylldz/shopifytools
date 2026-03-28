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
  const pageInfo = params.page_info || ''

  try {
    const token = await getAccessToken()

    // URL oluştur
    let url: string
    if (pageInfo) {
      // Sonraki sayfa — sadece page_info ve limit gerekli
      url = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json?limit=250&fields=id,title,status,tags,variants&page_info=${pageInfo}`
    } else {
      // İlk sayfa
      const qs = new URLSearchParams()
      qs.set('limit', '250')
      qs.set('fields', 'id,title,status,tags,variants')
      if (status !== 'any') qs.set('status', status)
      url = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json?${qs.toString()}`
    }

    const res: Response = await fetch(url, {
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
    const rawProducts = data.products || []

    // Sadece gerekli alanları al
    const products: SlimProduct[] = rawProducts.map((p: any) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      tags: p.tags || '',
      variants: (p.variants || []).map((v: any) => ({
        id: String(v.id),
        title: v.title || 'Default Title',
        price: v.price,
        compare_at_price: v.compare_at_price,
      })),
    }))

    // Etiket filtresi (her sayfada uygula)
    const filtered = tag
      ? products.filter((p: SlimProduct) => {
          const tags = p.tags.split(',').map((t: string) => t.trim().toLowerCase())
          return tags.includes(tag.toLowerCase())
        })
      : products

    // Sonraki sayfa cursor'ını çıkar
    const linkHeader: string = res.headers.get('Link') || ''
    const nextMatch: RegExpMatchArray | null = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    const nextPageInfo = nextMatch ? nextMatch[1] : null

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: filtered,
        nextPageInfo,
        hasMore: !!nextPageInfo,
      }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
