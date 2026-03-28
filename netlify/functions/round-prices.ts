import type { Handler } from '@netlify/functions'

const DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || ''
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN || ''

interface VariantUpdate {
  id: string
  price: string
  compare_at_price: string | null
}

const roundUp = (value: string | null): string | null => {
  if (!value || value === '' || parseFloat(value) === 0) return value
  return String(Math.ceil(parseFloat(value)))
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!DOMAIN || !TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Shopify credentials are not configured.' }),
    }
  }

  let variants: VariantUpdate[] = []
  try {
    const body = JSON.parse(event.body || '{}')
    variants = body.variants || []
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  if (!variants.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No variants provided' }) }
  }

  const results: { id: string; success: boolean; error?: string }[] = []

  // Process in batches of 10 to avoid rate limits
  const batchSize = 10
  for (let i = 0; i < variants.length; i += batchSize) {
    const batch = variants.slice(i, i + batchSize)

    await Promise.all(
      batch.map(async (variant) => {
        const newPrice = roundUp(variant.price)
        const newCompareAt = roundUp(variant.compare_at_price)

        const url = `https://${DOMAIN}/admin/api/2024-01/variants/${variant.id}.json`
        try {
          const res = await fetch(url, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': TOKEN,
            },
            body: JSON.stringify({
              variant: {
                id: variant.id,
                price: newPrice,
                compare_at_price: newCompareAt,
              },
            }),
          })

          if (!res.ok) {
            const text = await res.text()
            results.push({ id: variant.id, success: false, error: `${res.status}: ${text}` })
          } else {
            results.push({ id: variant.id, success: true })
          }
        } catch (err: any) {
          results.push({ id: variant.id, success: false, error: err.message })
        }
      })
    )

    // small delay between batches to respect Shopify rate limits
    if (i + batchSize < variants.length) {
      await new Promise((r) => setTimeout(r, 500))
    }
  }

  const successCount = results.filter((r) => r.success).length
  const failCount = results.filter((r) => !r.success).length

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results, successCount, failCount }),
  }
}
