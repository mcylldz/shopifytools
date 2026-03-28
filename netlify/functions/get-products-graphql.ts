import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          title
          descriptionHtml
          vendor
          productType
          tags
          status
          featuredImage { url }
          images(first: 10) {
            edges { node { url altText } }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                price
                compareAtPrice
                selectedOptions { name value }
                inventoryQuantity
              }
            }
          }
          collections(first: 10) {
            edges { node { title } }
          }
          metafields(first: 50, keys: [
            "enrichment.status",
            "enrichment.version",
            "enrichment.needs_review"
          ]) {
            edges {
              node { namespace key value type }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

// Shopify GraphQL query string builder
function buildQueryFilter(params: Record<string, string>): string {
  const parts: string[] = []

  // Status filter
  const status = params.status || ''
  if (status && status !== 'any') {
    parts.push(`status:${status}`)
  }

  // Tag filter
  const tags = params.tags || ''
  const tagMode = params.tag_mode || 'any' // 'any' = OR, 'all' = AND
  if (tags) {
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)
    if (tagList.length > 0) {
      if (tagMode === 'all') {
        parts.push(tagList.map((t) => `tag:'${t}'`).join(' AND '))
      } else {
        parts.push('(' + tagList.map((t) => `tag:'${t}'`).join(' OR ') + ')')
      }
    }
  }

  // Collection filter (collection_id based)
  const collectionId = params.collection_id || ''
  if (collectionId) {
    parts.push(`collection_id:${collectionId.replace('gid://shopify/Collection/', '')}`)
  }

  return parts.join(' AND ')
}

export const handler: Handler = async (event) => {
  const params = event.queryStringParameters || {}
  const after = params.after || null
  const enrichmentFilter = params.enrichment_filter || 'all' // all, missing, none, error

  try {
    const queryStr = buildQueryFilter(params)

    const data = await graphqlFetch<any>(PRODUCTS_QUERY, {
      first: 250,
      after: after || undefined,
      query: queryStr || undefined,
    })

    const edges = data.products.edges || []

    // Slim down products
    const products = edges.map((edge: any) => {
      const node = edge.node
      const metafields = (node.metafields?.edges || []).map((e: any) => e.node)
      const enrichmentStatus = metafields.find(
        (m: any) => m.namespace === 'enrichment' && m.key === 'status'
      )
      const enrichmentVersion = metafields.find(
        (m: any) => m.namespace === 'enrichment' && m.key === 'version'
      )
      const needsReview = metafields.find(
        (m: any) => m.namespace === 'enrichment' && m.key === 'needs_review'
      )

      return {
        id: node.id,
        numericId: node.id.replace('gid://shopify/Product/', ''),
        title: node.title,
        descriptionHtml: node.descriptionHtml || '',
        vendor: node.vendor,
        productType: node.productType,
        tags: node.tags || [],
        status: node.status?.toLowerCase() || 'active',
        featuredImage: node.featuredImage?.url || null,
        images: (node.images?.edges || []).map((e: any) => e.node.url),
        variants: (node.variants?.edges || []).map((e: any) => ({
          id: e.node.id,
          numericId: e.node.id.replace('gid://shopify/ProductVariant/', ''),
          title: e.node.title,
          sku: e.node.sku || '',
          price: e.node.price,
          compareAtPrice: e.node.compareAtPrice,
          options: e.node.selectedOptions || [],
          inventoryQuantity: e.node.inventoryQuantity,
        })),
        collections: (node.collections?.edges || []).map((e: any) => e.node.title),
        enrichment: {
          status: enrichmentStatus ? JSON.parse(enrichmentStatus.value) : null,
          version: enrichmentVersion?.value || null,
          needsReview: needsReview?.value === 'true',
        },
      }
    })

    // Client-side enrichment filter
    let filtered = products
    if (enrichmentFilter === 'none') {
      filtered = products.filter((p: any) => !p.enrichment.status)
    } else if (enrichmentFilter === 'error') {
      filtered = products.filter((p: any) => p.enrichment.needsReview)
    } else if (enrichmentFilter === 'missing') {
      // Has enrichment but some fields missing — will need client-side logic
      filtered = products.filter((p: any) => {
        if (!p.enrichment.status) return true
        const s = p.enrichment.status
        return s.errors > 0 || s.fields_filled < 20
      })
    }

    const pageInfo = data.products.pageInfo

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: filtered,
        pageInfo: {
          hasNextPage: pageInfo.hasNextPage,
          endCursor: pageInfo.endCursor,
        },
        totalFetched: edges.length,
      }),
    }
  } catch (err: any) {
    console.error('[get-products-graphql] Hata:', err.message)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
