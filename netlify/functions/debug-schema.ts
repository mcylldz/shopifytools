import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

// Shopify ProductInput schema introspection
export const handler: Handler = async (event) => {
  try {
    // 1. ProductInput fields — productCategory var mı?
    const inputFields = await graphqlFetch<any>(`{
      __type(name: "ProductInput") {
        name
        inputFields { name type { name kind ofType { name kind } } }
      }
    }`)

    const fields = inputFields.__type?.inputFields || []
    const catRelated = fields.filter((f: any) =>
      f.name.toLowerCase().includes('categ') || f.name.toLowerCase().includes('taxon')
    )
    const allFieldNames = fields.map((f: any) => f.name)

    // 2. productSet mutation var mı?
    const mutationCheck = await graphqlFetch<any>(`{
      __schema {
        mutationType {
          fields { name }
        }
      }
    }`)
    const mutations = mutationCheck.__schema?.mutationType?.fields?.map((f: any) => f.name) || []
    const catMutations = mutations.filter((n: string) =>
      n.toLowerCase().includes('categ') || n.toLowerCase().includes('product')
    )

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productInputFields: allFieldNames,
        categoryRelatedFields: catRelated,
        categoryRelatedMutations: catMutations,
      }, null, 2),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
