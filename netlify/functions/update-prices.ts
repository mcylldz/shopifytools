import type { Handler } from '@netlify/functions'
import { getAccessToken, graphqlFetch, SHOPIFY_DOMAIN } from './shopify-auth'

const roundToHundred = (value: number): number => Math.round(value / 100) * 100

// ── Koleksiyon ürünleri (GraphQL) ──
async function getCollectionProducts(collectionId: string): Promise<any[]> {
  const query = `
    query GetCollectionProducts($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        products(first: $first, after: $after) {
          edges {
            node {
              id
              title
              status
              tags
              variants(first: 100) {
                edges {
                  node { id title price compareAtPrice }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `

  const products: any[] = []
  let after: string | null = null

  while (true) {
    const data: any = await graphqlFetch(query, { id: collectionId, first: 50, after })
    const edges = data.collection?.products?.edges || []
    for (const edge of edges) {
      const node = edge.node
      products.push({
        id: node.id,
        title: node.title,
        status: node.status,
        tags: node.tags?.join(', ') || '',
        variants: node.variants.edges.map((ve: any) => ({
          id: ve.node.id,
          title: ve.node.title,
          price: ve.node.price,
          compare_at_price: ve.node.compareAtPrice,
        })),
      })
    }

    if (!data.collection?.products?.pageInfo?.hasNextPage) break
    after = data.collection.products.pageInfo.endCursor
  }

  return products
}

// ── Tüm ürünler veya tag bazlı (REST) ──
async function getAllProducts(tag?: string, onSale?: boolean, status?: string): Promise<any[]> {
  const token = await getAccessToken()
  const products: any[] = []
  const statusParam = status && status !== 'any' ? `&status=${status}` : ''
  let nextUrl = `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json?limit=250&fields=id,title,status,tags,variants${statusParam}`

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
    })
    if (!res.ok) throw new Error(`Products API error: ${res.status}`)

    const data = await res.json()
    for (const p of (data.products || [])) {
      products.push({
        id: p.id,
        title: p.title,
        status: p.status,
        tags: p.tags || '',
        variants: (p.variants || []).map((v: any) => ({
          id: String(v.id),
          title: v.title || 'Default',
          price: v.price,
          compare_at_price: v.compare_at_price,
          updated_at: v.updated_at || p.updated_at || '',
        })),
      })
    }

    // Pagination
    const link = res.headers.get('Link') || ''
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/)
    nextUrl = nextMatch ? nextMatch[1] : ''
  }

  // Filtreler
  let filtered = products
  if (tag) {
    const lowerTag = tag.toLowerCase()
    filtered = filtered.filter((p) => {
      const tags = p.tags.split(',').map((t: string) => t.trim().toLowerCase())
      return tags.includes(lowerTag)
    })
  }
  if (onSale) {
    filtered = filtered.filter((p) =>
      p.variants.some((v: any) => v.compare_at_price && parseFloat(v.compare_at_price) > 0)
    )
  }

  return filtered
}

// ── Variant fiyat güncelle (REST) ──
async function updateVariantPrice(variantId: string, price: string, comparePrice: string | null): Promise<boolean> {
  const token = await getAccessToken()
  const numericId = variantId.replace(/.*\//, '')

  const variantPayload: any = { id: numericId }
  if (price !== null) variantPayload.price = price
  if (comparePrice !== null) variantPayload.compare_at_price = comparePrice

  const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/variants/${numericId}.json`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ variant: variantPayload }),
  })

  return res.ok
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!SHOPIFY_DOMAIN) {
    return { statusCode: 500, body: JSON.stringify({ error: 'SHOPIFY_STORE_DOMAIN eksik' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ── Preview: ürünleri çek ve öncesi/sonrası göster ──
    if (action === 'preview') {
      const { filter, collectionId, productIds, tag, percentage, updatePrice, updateCompare, productStatus } = body
      let products: any[] = []

      if (filter === 'whole_store') {
        products = await getAllProducts(undefined, undefined, productStatus)
      } else if (filter === 'collection' && collectionId) {
        products = await getCollectionProducts(collectionId)
        // Status filtresi (GraphQL collection'dan gelen)
        if (productStatus && productStatus !== 'any') {
          products = products.filter((p) => p.status?.toUpperCase() === productStatus.toUpperCase())
        }
      } else if (filter === 'products' && productIds?.length) {
        const all = await getAllProducts(undefined, undefined, productStatus)
        products = all.filter((p) => productIds.includes(String(p.id)))
      } else if (filter === 'on_sale') {
        products = await getAllProducts(undefined, true, productStatus)
      } else if (filter === 'tag' && tag) {
        products = await getAllProducts(tag, undefined, productStatus)
      } else {
        throw new Error('Geçersiz filtre')
      }

      // % hesapla
      const pct = parseFloat(percentage) / 100
      const preview = products.map((p) => ({
        id: p.id,
        title: p.title,
        variants: p.variants.map((v: any) => {
          const oldPrice = parseFloat(v.price || '0')
          const oldCompare = parseFloat(v.compare_at_price || '0')
          const newPrice = updatePrice ? roundToHundred(oldPrice * (1 + pct)) : oldPrice
          const newCompare = updateCompare ? (oldCompare > 0 ? roundToHundred(oldCompare * (1 + pct)) : 0) : oldCompare

          return {
            id: v.id,
            title: v.title,
            oldPrice: oldPrice,
            newPrice: newPrice,
            oldCompare: oldCompare,
            newCompare: newCompare,
          }
        }),
      }))

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, products: preview, totalVariants: preview.reduce((s, p) => s + p.variants.length, 0) }),
      }
    }

    // ── Apply: fiyatları güncelle ──
    if (action === 'apply') {
      const { updates } = body // [{ variantId, price, comparePrice }]
      if (!updates?.length) throw new Error('Güncellenecek veri yok')

      let success = 0
      let fail = 0

      // Batch 4'er
      for (let i = 0; i < updates.length; i += 4) {
        const batch = updates.slice(i, i + 4)
        const results = await Promise.all(
          batch.map((u: any) => updateVariantPrice(u.variantId, u.price, u.comparePrice))
        )
        success += results.filter(Boolean).length
        fail += results.filter((r) => !r).length

        if (i + 4 < updates.length) {
          await new Promise((r) => setTimeout(r, 300))
        }
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, updated: success, failed: fail }),
      }
    }

    // ── Repair (paginated): her çağrıda 1 sayfa (250 ürün) tara ──
    if (action === 'repair') {
      const { percentage, cutoffTime, updatePrice, updateCompare, pageUrl } = body
      const pct = parseFloat(percentage) / 100
      const cutoff = new Date(cutoffTime).getTime()
      const token = await getAccessToken()

      // İlk sayfa veya devam URL'i
      const url = pageUrl || `https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json?limit=250&fields=id,title,status,tags,variants`

      console.log(`[repair] Fetching page: ${url.substring(0, 80)}...`)

      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      })
      if (!res.ok) throw new Error(`Products API error: ${res.status}`)

      const data = await res.json()
      const products = data.products || []

      let needsUpdate: any[] = []
      let alreadyUpdated = 0
      let scannedVariants = 0

      for (const p of products) {
        for (const v of (p.variants || [])) {
          scannedVariants++
          const variantUpdated = new Date(v.updated_at || p.updated_at || '2000-01-01').getTime()
          if (variantUpdated >= cutoff) {
            alreadyUpdated++
          } else {
            const oldPrice = parseFloat(v.price || '0')
            const oldCompare = parseFloat(v.compare_at_price || '0')
            needsUpdate.push({
              variantId: String(v.id),
              price: String(updatePrice !== false ? roundToHundred(oldPrice * (1 + pct)) : oldPrice),
              comparePrice: updateCompare !== false ? (oldCompare > 0 ? String(roundToHundred(oldCompare * (1 + pct))) : null) : (oldCompare > 0 ? String(oldCompare) : null),
              productTitle: p.title,
              oldPrice,
              newPrice: updatePrice !== false ? roundToHundred(oldPrice * (1 + pct)) : oldPrice,
            })
          }
        }
      }

      // Sonraki sayfa
      const link = res.headers.get('Link') || ''
      const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/)
      const nextPageUrl = nextMatch ? nextMatch[1] : null

      console.log(`[repair] Page: ${products.length} products, ${scannedVariants} variants, ${needsUpdate.length} need update, hasNext: ${!!nextPageUrl}`)

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          needsUpdate: needsUpdate.length,
          alreadyUpdated,
          scannedVariants,
          scannedProducts: products.length,
          nextPageUrl,
          updates: needsUpdate.map(v => ({
            variantId: v.variantId,
            price: v.price,
            comparePrice: v.comparePrice,
          })),
          samples: needsUpdate.slice(0, 5).map(v => ({
            product: v.productTitle,
            oldPrice: v.oldPrice,
            newPrice: v.newPrice,
          })),
        }),
      }
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Geçersiz action: ${action}` }) }
  } catch (err: any) {
    console.error(`[update-prices] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
