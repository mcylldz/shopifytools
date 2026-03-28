import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

const METAFIELDS_SET_MUTATION = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id namespace key
      }
      userErrors {
        field message
      }
    }
  }
`

interface MetafieldInput {
  ownerId: string
  namespace: string
  key: string
  value: string
  type: string
}

function buildMetafields(productId: string, enrichment: any): MetafieldInput[] {
  const mfs: MetafieldInput[] = []
  const g = enrichment.google || {}
  const m = enrichment.meta || {}

  const add = (ns: string, key: string, value: any, type = 'single_line_text_field') => {
    if (value === null || value === undefined || value === '') return
    const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    mfs.push({ ownerId: productId, namespace: ns, key, value: strValue, type })
  }

  // — Google Shopping fields —
  add('mm-google-shopping', 'google_product_category', g.google_product_category)
  add('mm-google-shopping', 'product_type', g.product_type)
  add('mm-google-shopping', 'condition', g.condition)
  add('mm-google-shopping', 'brand', g.brand)
  add('mm-google-shopping', 'identifier_exists', g.identifier_exists === false ? 'false' : 'true')
  add('mm-google-shopping', 'gender', g.gender)
  add('mm-google-shopping', 'age_group', g.age_group)
  add('mm-google-shopping', 'color', g.color)
  add('mm-google-shopping', 'material', g.material)
  add('mm-google-shopping', 'pattern', g.pattern)
  add('mm-google-shopping', 'size_system', g.size_system)
  add('mm-google-shopping', 'size_type', g.size_type)
  add('mm-google-shopping', 'item_group_id', g.item_group_id)
  add('mm-google-shopping', 'mpn', g.mpn)
  add('mm-google-shopping', 'shipping_weight', g.shipping_weight)
  if (g.sale_price_effective_date)
    add('mm-google-shopping', 'sale_price_effective_date', g.sale_price_effective_date)
  add('mm-google-shopping', 'custom_label_0', g.custom_label_0)
  add('mm-google-shopping', 'custom_label_1', g.custom_label_1)
  add('mm-google-shopping', 'custom_label_2', g.custom_label_2)
  add('mm-google-shopping', 'custom_label_3', g.custom_label_3)
  add('mm-google-shopping', 'custom_label_4', g.custom_label_4)
  if (g.product_highlight)
    add('mm-google-shopping', 'product_highlight', g.product_highlight, 'json')

  // — Meta Catalog fields —
  add('mm-meta-catalog', 'short_description', m.short_description)
  add('mm-meta-catalog', 'fb_product_category', m.fb_product_category)
  add('mm-meta-catalog', 'inventory', m.inventory)
  add('mm-meta-catalog', 'return_policy_days', m.return_policy_days)
  // Mirror custom labels from Google
  add('mm-meta-catalog', 'custom_label_0', g.custom_label_0 || m.custom_label_0)
  add('mm-meta-catalog', 'custom_label_1', g.custom_label_1 || m.custom_label_1)
  add('mm-meta-catalog', 'custom_label_2', g.custom_label_2 || m.custom_label_2)
  add('mm-meta-catalog', 'custom_label_3', g.custom_label_3 || m.custom_label_3)
  add('mm-meta-catalog', 'custom_label_4', g.custom_label_4 || m.custom_label_4)
  if (m.sale_price_effective_date || g.sale_price_effective_date)
    add('mm-meta-catalog', 'sale_price_effective_date', g.sale_price_effective_date || m.sale_price_effective_date)

  // — Enrichment tracking —
  add('enrichment', 'status', JSON.stringify({
    last_run: new Date().toISOString(),
    model: 'claude-sonnet-4-6',
    fields_filled: mfs.length,
    errors: 0,
  }), 'json')
  add('enrichment', 'version', '1.0')
  add('enrichment', 'needs_review', enrichment.needs_review ? 'true' : 'false', 'boolean')

  return mfs
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  let productId: string
  let enrichment: any
  let updateTitle: boolean
  let updateDescription: boolean
  try {
    const body = JSON.parse(event.body || '{}')
    productId = body.productId
    enrichment = body.enrichment
    updateTitle = body.updateTitle ?? false
    updateDescription = body.updateDescription ?? false
    if (!productId || !enrichment) throw new Error('productId ve enrichment gerekli')
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) }
  }

  try {
    const metafields = buildMetafields(productId, enrichment)

    console.log(`[save] ${productId}: ${metafields.length} metafield yazılacak`)

    // Max 25 metafield/mutation — gerekirse böl
    let totalWritten = 0
    const errors: string[] = []

    for (let i = 0; i < metafields.length; i += 25) {
      const batch = metafields.slice(i, i + 25)
      const data = await graphqlFetch<any>(METAFIELDS_SET_MUTATION, { metafields: batch })

      const userErrors = data.metafieldsSet?.userErrors || []
      if (userErrors.length > 0) {
        for (const ue of userErrors) {
          errors.push(`${ue.field}: ${ue.message}`)
        }
      }
      totalWritten += (data.metafieldsSet?.metafields?.length || 0)
    }

    // Opsiyonel: title ve description güncelle
    if (updateTitle || updateDescription) {
      const g = enrichment.google || {}
      const updateFields: string[] = []
      const updateVars: string[] = []
      const updateValues: Record<string, string> = {}

      if (updateTitle && g.title) {
        updateFields.push('title: $title')
        updateVars.push('$title: String')
        updateValues.title = g.title
      }
      if (updateDescription && g.description) {
        updateFields.push('descriptionHtml: $desc')
        updateVars.push('$desc: String')
        updateValues.desc = g.description
      }

      if (updateFields.length > 0) {
        const mutation = `
          mutation UpdateProduct($id: ID!, ${updateVars.join(', ')}) {
            productUpdate(input: { id: $id, ${updateFields.join(', ')} }) {
              product { id }
              userErrors { field message }
            }
          }
        `
        await graphqlFetch(mutation, { id: productId, ...updateValues })
      }
    }

    console.log(`[save] ${productId}: ${totalWritten} metafield yazıldı, ${errors.length} hata`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: errors.length === 0,
        fieldsWritten: totalWritten,
        totalFields: metafields.length,
        errors,
      }),
    }
  } catch (err: any) {
    console.error(`[save] Hata: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
