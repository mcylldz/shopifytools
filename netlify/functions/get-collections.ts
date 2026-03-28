import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

const QUERY = `
  query GetCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          productsCount { count }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

export const handler: Handler = async () => {
  try {
    const allCollections: { id: string; title: string; productsCount: number }[] = []
    let after: string | null = null

    // Tüm koleksiyonları çek (paginate)
    while (true) {
      const data = await graphqlFetch<any>(QUERY, { first: 250, after })
      const edges = data.collections.edges || []

      for (const edge of edges) {
        allCollections.push({
          id: edge.node.id,
          title: edge.node.title,
          productsCount: edge.node.productsCount?.count ?? 0,
        })
      }

      if (!data.collections.pageInfo.hasNextPage) break
      after = data.collections.pageInfo.endCursor
    }

    // Alfabetik sırala
    allCollections.sort((a, b) => a.title.localeCompare(b.title, 'tr'))

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collections: allCollections }),
    }
  } catch (err: any) {
    console.error('[get-collections] Hata:', err.message)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
