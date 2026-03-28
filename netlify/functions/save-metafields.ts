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

// BUG 1 FIX v5: Shopify 2025-01'de field adı 'category' (scalar ID)
// productCategory değil, category olarak gönderilmeli
const PRODUCT_CATEGORY_MUTATION = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product {
        id
        category { id name fullName }
      }
      userErrors { field message }
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

// BUG 3 FIX: Backend fiyat aralığı hesaplama
function getPriceLabel(price: string | number): string {
  const p = typeof price === 'string' ? parseFloat(price) : price
  if (isNaN(p) || p <= 500) return 'Budget'
  if (p <= 1500) return 'Mid-Range'
  if (p <= 3000) return 'Premium'
  return 'Luxury'
}

function getMarginLabel(price: string | number, compareAt: string | number | null): string {
  if (!compareAt) return 'Low Margin'
  const p = typeof price === 'string' ? parseFloat(price) : price
  const c = typeof compareAt === 'string' ? parseFloat(compareAt) : compareAt
  if (isNaN(p) || isNaN(c) || c <= 0) return 'Low Margin'
  const margin = ((c - p) / c) * 100
  if (margin > 60) return 'High Margin'
  if (margin >= 40) return 'Standard'
  return 'Low Margin'
}

// BUG 8 FIX: sale_price_effective_date backend hesaplama
function calculateSalePriceDate(price: string, compareAtPrice: string | null): string | null {
  const p = parseFloat(price || '0')
  const c = parseFloat(compareAtPrice || '0')
  if (!c || c <= p) return null // İndirim yoksa yazma

  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 90)

  const fmt = (d: Date) => {
    const offset = '+03:00'
    return d.toISOString().replace(/\.\d{3}Z$/, offset)
  }
  return `${fmt(now)}/${fmt(end)}`
}

// BUG 6 FIX: Ürün tipine göre default ağırlık
function getDefaultWeight(productType: string): { value: string; unit: string } {
  const t = (productType || '').toLowerCase()
  if (t.includes('elbise') || t.includes('dress')) return { value: '300', unit: 'g' }
  if (t.includes('ceket') || t.includes('jacket') || t.includes('mont')) return { value: '500', unit: 'g' }
  if (t.includes('pantolon') || t.includes('jean')) return { value: '400', unit: 'g' }
  if (t.includes('aksesuar') || t.includes('takı') || t.includes('kolye') || t.includes('küpe') || t.includes('bileklik')) return { value: '50', unit: 'g' }
  if (t.includes('çanta') || t.includes('bag')) return { value: '400', unit: 'g' }
  if (t.includes('atkı') || t.includes('şal')) return { value: '150', unit: 'g' }
  return { value: '250', unit: 'g' }
}

// BUG 6 FIX: Shipping weight'ı value/unit'e parse et
function parseShippingWeight(weight: string): { value: string; unit: string } {
  if (!weight) return { value: '250', unit: 'g' }
  const match = weight.match(/^(\d+)\s*(g|kg|lb|oz)$/i)
  if (match) return { value: match[1], unit: match[2].toLowerCase() }
  return { value: '250', unit: 'g' }
}

function buildMetafields(productId: string, enrichment: any, productData?: any): MetafieldInput[] {
  const mfs: MetafieldInput[] = []
  const g = enrichment.google || {}
  const m = enrichment.meta || {}

  const add = (ns: string, key: string, value: any, type = 'single_line_text_field') => {
    if (value === null || value === undefined || value === '') return
    let strValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    // FIX 3: single_line_text_field'a newline girmesini engelle
    if (type === 'single_line_text_field') {
      strValue = strValue.replace(/[\r\n]+/g, ' ').trim()
    }
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

  // BUG 2 FIX: size alanını variant'tan çıkar
  if (g.size) {
    add('mm-google-shopping', 'size', g.size)
  } else if (productData?.variants?.length > 0) {
    const v = productData.variants[0]
    const sizeOpt = (v.options || v.selectedOptions || []).find(
      (opt: any) => ['boyut', 'beden', 'size'].includes((opt.name || '').toLowerCase())
    )
    add('mm-google-shopping', 'size', sizeOpt?.value || 'Tek Beden')
  }

  add('mm-google-shopping', 'material', g.material)
  add('mm-google-shopping', 'pattern', g.pattern)
  add('mm-google-shopping', 'size_system', g.size_system)
  add('mm-google-shopping', 'size_type', g.size_type)
  add('mm-google-shopping', 'item_group_id', g.item_group_id)
  add('mm-google-shopping', 'mpn', g.mpn)

  // BUG 6 FIX: Shipping weight — value/unit ayrı + birleşik
  const weight = g.shipping_weight
    ? parseShippingWeight(g.shipping_weight)
    : getDefaultWeight(g.product_type || '')
  add('mm-google-shopping', 'shipping_weight', `${weight.value} ${weight.unit}`)
  add('mm-google-shopping', 'shipping_weight_value', weight.value)
  add('mm-google-shopping', 'shipping_weight_unit', weight.unit)

  // BUG 8 FIX: sale_price_effective_date backend hesaplama
  const firstVariant = productData?.variants?.[0]
  const salePriceDate = firstVariant
    ? calculateSalePriceDate(firstVariant.price, firstVariant.compareAtPrice)
    : null
  if (salePriceDate) {
    add('mm-google-shopping', 'sale_price_effective_date', salePriceDate)
  }

  add('mm-google-shopping', 'custom_label_0', g.custom_label_0)

  // BUG 3 FIX: Fiyat aralığı backend'de hesapla
  if (firstVariant?.price) {
    add('mm-google-shopping', 'custom_label_1', getPriceLabel(firstVariant.price))
  } else {
    add('mm-google-shopping', 'custom_label_1', g.custom_label_1)
  }

  add('mm-google-shopping', 'custom_label_2', g.custom_label_2)
  add('mm-google-shopping', 'custom_label_3', g.custom_label_3)

  if (firstVariant?.price) {
    add('mm-google-shopping', 'custom_label_4', getMarginLabel(firstVariant.price, firstVariant.compareAtPrice))
  } else {
    add('mm-google-shopping', 'custom_label_4', g.custom_label_4)
  }

  if (g.product_highlight)
    add('mm-google-shopping', 'product_highlight', g.product_highlight, 'json')

  // — Meta Catalog fields — (multi_line_text_field for descriptions)
  add('mm-meta-catalog', 'short_description', m.short_description, 'multi_line_text_field')
  add('mm-meta-catalog', 'rich_text_description', m.rich_text_description || g.description, 'multi_line_text_field')
  add('mm-meta-catalog', 'additional_variant_attribute', m.additional_variant_attribute)
  add('mm-meta-catalog', 'fb_product_category', m.fb_product_category)
  add('mm-meta-catalog', 'inventory', m.inventory)
  add('mm-meta-catalog', 'return_policy_days', m.return_policy_days)

  // Mirror custom labels
  const googleLabel1 = firstVariant?.price ? getPriceLabel(firstVariant.price) : (g.custom_label_1 || m.custom_label_1)
  const googleLabel4 = firstVariant?.price ? getMarginLabel(firstVariant.price, firstVariant?.compareAtPrice) : (g.custom_label_4 || m.custom_label_4)

  add('mm-meta-catalog', 'custom_label_0', g.custom_label_0 || m.custom_label_0)
  add('mm-meta-catalog', 'custom_label_1', googleLabel1)
  add('mm-meta-catalog', 'custom_label_2', g.custom_label_2 || m.custom_label_2)
  add('mm-meta-catalog', 'custom_label_3', g.custom_label_3 || m.custom_label_3)
  add('mm-meta-catalog', 'custom_label_4', googleLabel4)

  // Meta sale_price_effective_date (same backend calc)
  if (salePriceDate) {
    add('mm-meta-catalog', 'sale_price_effective_date', salePriceDate)
  }

  // — Enrichment tracking —
  // BUG 5 FIX: Model adı düzeltildi
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
  let productData: any
  try {
    const body = JSON.parse(event.body || '{}')
    productId = body.productId
    enrichment = body.enrichment
    updateTitle = body.updateTitle ?? false
    updateDescription = body.updateDescription ?? false
    productData = body.productData || null
    if (!productId || !enrichment) throw new Error('productId ve enrichment gerekli')
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) }
  }

  try {
    const metafields = buildMetafields(productId, enrichment, productData)
    console.log(`[save] ${productId}: ${metafields.length} metafield yazılacak`)

    let totalWritten = 0
    const errors: string[] = []

    // Metafields — max 25/mutation
    for (let i = 0; i < metafields.length; i += 25) {
      const batch = metafields.slice(i, i + 25)
      const data = await graphqlFetch<any>(METAFIELDS_SET_MUTATION, { metafields: batch })
      const userErrors = data.metafieldsSet?.userErrors || []
      if (userErrors.length > 0) {
        for (const ue of userErrors) errors.push(`${ue.field}: ${ue.message}`)
      }
      totalWritten += (data.metafieldsSet?.metafields?.length || 0)
    }

    // BUG 1 FIX v6 — FINAL
    // GID format: gid://shopify/TaxonomyCategory/xx (NOT ProductTaxonomyNode)
    // Taxonomy search API'si query parametresini desteklemiyor.
    // Çözüm: product_type text → keyword matching → doğru TaxonomyCategory GID
    const productType = enrichment.google?.product_type || ''
    const rawCatId = enrichment.google?.google_product_category

    // Shopify Taxonomy GID'leri (introspection ile doğrulanmış — 2025-01)
    const TAXONOMY: Record<string, string> = {
      // Clothing (aa-1-*)
      'dresses':    'gid://shopify/TaxonomyCategory/aa-1-4',
      'tops':       'gid://shopify/TaxonomyCategory/aa-1-13',
      'skirts':     'gid://shopify/TaxonomyCategory/aa-1-15',
      'pants':      'gid://shopify/TaxonomyCategory/aa-1-12',
      'outerwear':  'gid://shopify/TaxonomyCategory/aa-1-10',
      'one-pieces': 'gid://shopify/TaxonomyCategory/aa-1-9',
      'suits':      'gid://shopify/TaxonomyCategory/aa-1-19',
      'shorts':     'gid://shopify/TaxonomyCategory/aa-1-14',
      'swimwear':   'gid://shopify/TaxonomyCategory/aa-1-20',
      'lingerie':   'gid://shopify/TaxonomyCategory/aa-1-6',
      'activewear': 'gid://shopify/TaxonomyCategory/aa-1-1',
      // Accessories (aa-2-*)
      'scarves':    'gid://shopify/TaxonomyCategory/aa-2-26',
      'belts':      'gid://shopify/TaxonomyCategory/aa-2-6',
      'hats':       'gid://shopify/TaxonomyCategory/aa-2-17',
      'sunglasses': 'gid://shopify/TaxonomyCategory/aa-2-27',
      'gloves':     'gid://shopify/TaxonomyCategory/aa-2-13',
      'hair':       'gid://shopify/TaxonomyCategory/aa-2-14',
    }

    // Google taxonomy ID → Shopify TaxonomyCategory mapping
    const GOOGLE_TO_SHOPIFY: Record<number, string> = {
      2271: TAXONOMY['dresses'],
      212:  TAXONOMY['tops'],
      3455: TAXONOMY['skirts'],
      204:  TAXONOMY['pants'],
      3066: TAXONOMY['outerwear'],
      5322: TAXONOMY['one-pieces'],   // Jumpsuits → One-Pieces
      203:  TAXONOMY['suits'],
      179:  TAXONOMY['scarves'],
    }

    // Türkçe product_type → İngilizce keyword mapping
    const KEYWORD_MAP: [RegExp, string][] = [
      [/elbise|dress/i,      'dresses'],
      [/bluz|blouse|top|üst/i, 'tops'],
      [/gömlek|shirt/i,      'tops'],
      [/etek|skirt/i,        'skirts'],
      [/pantolon|pant|trousers/i, 'pants'],
      [/ceket|jacket|blazer|coat|mont|kaban/i, 'outerwear'],
      [/hırka|cardigan|kazak|sweater|triko/i, 'outerwear'],
      [/tulum|jumpsuit|romper/i, 'one-pieces'],
      [/takım|suit/i,        'suits'],
      [/şort|short/i,        'shorts'],
      [/mayo|bikini|swim/i,  'swimwear'],
      [/iç çamaşır|lingerie/i, 'lingerie'],
      [/atkı|şal|scarf|shawl/i, 'scarves'],
      [/kemer|belt/i,        'belts'],
      [/şapka|hat/i,         'hats'],
      [/çanta|bag|handbag/i, 'dresses'], // fallback — Luggage & Bags farklı top-level
    ]

    if (rawCatId || productType) {
      try {
        let taxonomyNodeId: string | null = null

        // 1. Google ID mapping dene
        if (rawCatId) {
          const catId = typeof rawCatId === 'string' ? parseInt(rawCatId, 10) : rawCatId
          if (catId && GOOGLE_TO_SHOPIFY[catId]) {
            taxonomyNodeId = GOOGLE_TO_SHOPIFY[catId]
            console.log(`[save] ${productId}: Google→Shopify: ${catId} → ${taxonomyNodeId}`)
          }
        }

        // 2. product_type keyword matching
        if (!taxonomyNodeId && productType) {
          for (const [regex, key] of KEYWORD_MAP) {
            if (regex.test(productType)) {
              taxonomyNodeId = TAXONOMY[key]
              console.log(`[save] ${productId}: keyword match: "${productType}" → ${key} → ${taxonomyNodeId}`)
              break
            }
          }
        }

        // 3. Fallback: default Dresses (kadın moda mağazası)
        if (!taxonomyNodeId) {
          taxonomyNodeId = TAXONOMY['dresses']
          console.log(`[save] ${productId}: fallback → Dresses → ${taxonomyNodeId}`)
        }

        console.log(`[save] ${productId}: category = ${taxonomyNodeId}`)
        const catData = await graphqlFetch<any>(PRODUCT_CATEGORY_MUTATION, {
          input: {
            id: productId,
            category: taxonomyNodeId,
          },
        })
        const catErrors = catData.productUpdate?.userErrors || []
        if (catErrors.length > 0) {
          for (const ce of catErrors) {
            console.error(`[save] category hatası: ${ce.field}: ${ce.message}`)
            errors.push(`category: ${ce.message}`)
          }
        } else {
          const cat = catData.productUpdate?.product?.category
          console.log(`[save] ${productId}: category başarılı: ${cat?.fullName || cat?.name}`)
        }
      } catch (catErr: any) {
        console.error(`[save] productCategory exception: ${catErr.message}`)
        errors.push(`productCategory: ${catErr.message}`)
      }
    }

    // Title/description güncelleme
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
