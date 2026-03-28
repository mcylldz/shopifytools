import type { Handler } from '@netlify/functions'
import { getAccessToken, SHOPIFY_DOMAIN } from './shopify-auth'

export const handler: Handler = async () => {
  const result: Record<string, unknown> = {}

  try {
    const token = await getAccessToken()
    result.token = '✓ alındı'

    // Test each status value directly
    const statuses = ['active', 'draft', 'archived', 'any']
    for (const status of statuses) {
      const qs = new URLSearchParams()
      qs.set('limit', '1')
      qs.set('fields', 'id,title,status')
      if (status !== 'any') qs.set('status', status)

      const url = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json?${qs.toString()}`
      result[`url_${status}`] = url

      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': token,
        },
      })
      const text = await res.text()
      if (res.ok) {
        const data = JSON.parse(text)
        result[`status_${status}`] = `✓ ${res.status} — ${data.products?.length ?? 0} ürün`
        if (data.products?.length > 0) {
          result[`sample_${status}`] = data.products[0]
        }
      } else {
        result[`status_${status}`] = `✕ ${res.status}: ${text.slice(0, 300)}`
      }
    }
  } catch (e: any) {
    result.error = e.message
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result, null, 2),
  }
}
