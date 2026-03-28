import type { Handler } from '@netlify/functions'

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || ''
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || ''

const shopifyFetch = async (path: string, options: RequestInit = {}) => {
  const url = `https://${DOMAIN}/admin/api/2024-01${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
      ...options.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Shopify API error ${res.status}: ${text}`)
  }
  return res.json()
}

export const handler: Handler = async (event) => {
  if (!DOMAIN || !TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Shopify credentials are not configured.' }),
    }
  }

  const params = event.queryStringParameters || {}
  const tag = params.tag || ''
  const status = params.status || 'any'
  const limit = Math.min(Number(params.limit) || 250, 250)

  // Build query string
  const qs = new URLSearchParams()
  qs.set('limit', String(limit))
  qs.set('fields', 'id,title,status,tags,variants')

  if (status !== 'any') qs.set('status', status)

  try {
    let allProducts: unknown[] = []
    let pageUrl = `/products.json?${qs.toString()}`

    // Paginate through all products using page_info cursor
    while (pageUrl) {
      const url = `https://${DOMAIN}/admin/api/2024-01${pageUrl}`
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': TOKEN,
        },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Shopify API error ${res.status}: ${text}`)
      }

      const data = await res.json()
      const products = data.products || []
      allProducts = allProducts.concat(products)

      // Check for next page link header
      const linkHeader = res.headers.get('Link') || ''
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/)
      if (nextMatch) {
        const nextFullUrl = nextMatch[1]
        const urlObj = new URL(nextFullUrl)
        pageUrl = urlObj.pathname + urlObj.search
      } else {
        pageUrl = ''
      }
    }

    // Filter by tag if provided
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
