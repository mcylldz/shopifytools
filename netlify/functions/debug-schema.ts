import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

export const handler: Handler = async (event) => {
  try {
    // Apparel & Accessories altını çek (aa = Apparel & Accessories)
    const data = await graphqlFetch<any>(`{
      taxonomy {
        categories(first: 250) {
          nodes {
            id
            name
            fullName
            level
            ancestorIds
            childrenIds
          }
        }
      }
    }`)

    const allNodes = data.taxonomy?.categories?.nodes || []
    
    // Apparel & Accessories GID'si: gid://shopify/TaxonomyCategory/aa
    // Tüm child kategorileri listele — ama API sadece first:250 dönüyor
    // Daha spesifik: childrenIds kullanarak aa altını bul
    
    const apparelNode = allNodes.find((n: any) => n.id === 'gid://shopify/TaxonomyCategory/aa')
    const childIds = apparelNode?.childrenIds || []

    // Şimdi childrenIds'ları çek
    const childQueries = childIds.slice(0, 20).map((id: string, i: number) => {
      const alias = `c${i}`
      return `${alias}: node(id: "${id}") { ... on TaxonomyCategory { id name fullName childrenIds } }`
    }).join('\n')

    const childData = await graphqlFetch<any>(`{ ${childQueries} }`)
    
    // Her child'ın da çocuklarını çek
    const level2Ids: string[] = []
    const level2Results: any[] = []
    
    for (const key of Object.keys(childData)) {
      const node = childData[key]
      if (node) {
        level2Results.push({ id: node.id, name: node.name, fullName: node.fullName })
        if (node.childrenIds) level2Ids.push(...node.childrenIds)
      }
    }

    // Level 3 — clothing sub-subcategories (Dresses, Tops, etc.)
    const l3Queries = level2Ids.slice(0, 50).map((id: string, i: number) => {
      const alias = `l${i}`
      return `${alias}: node(id: "${id}") { ... on TaxonomyCategory { id name fullName childrenIds } }`
    }).join('\n')

    let level3Results: any[] = []
    if (l3Queries) {
      const l3Data = await graphqlFetch<any>(`{ ${l3Queries} }`)
      for (const key of Object.keys(l3Data)) {
        const node = l3Data[key]
        if (node) level3Results.push({ id: node.id, name: node.name, fullName: node.fullName })
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apparelChildrenCount: childIds.length,
        level2: level2Results,
        level3: level3Results,
      }, null, 2),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
