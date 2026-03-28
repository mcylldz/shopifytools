import type { Handler } from '@netlify/functions'
import { getAccessToken, SHOPIFY_DOMAIN } from './shopify-auth'

interface VariantUpdate {
  id: string
  price: string
  compare_at_price: string | null
}

const roundToHundred = (value: string | null): string | null => {
  if (!value || parseFloat(value) === 0) return value
  return String(Math.round(parseFloat(value) / 100) * 100)
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!SHOPIFY_DOMAIN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SHOPIFY_STORE_DOMAIN env variable eksik.' }),
    }
  }

  let variants: VariantUpdate[] = []
  try {
    const body = JSON.parse(event.body || '{}')
    variants = body.variants || []
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Geçersiz JSON body' }) }
  }

  if (!variants.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Hiç variant gönderilmedi' }) }
  }

  try {
    const token = await getAccessToken()
    const results: { id: string; success: boolean; error?: string }[] = []

    // 25'lik batch'ler halinde paralel işle
    const batchSize = 25
    for (let i = 0; i < variants.length; i += batchSize) {
      const batch = variants.slice(i, i + batchSize)

      await Promise.all(
        batch.map(async (variant) => {
          const url = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/variants/${variant.id}.json`
          try {
            const res = await fetch(url, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': token,
              },
              body: JSON.stringify({
                variant: {
                  id: variant.id,
                  price: roundToHundred(variant.price),
                  compare_at_price: roundToHundred(variant.compare_at_price),
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

      if (i + batchSize < variants.length) {
        await new Promise((r) => setTimeout(r, 200))
      }
    }

    const successCount = results.filter((r) => r.success).length
    const failCount = results.filter((r) => !r.success).length

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ successCount, failCount }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
