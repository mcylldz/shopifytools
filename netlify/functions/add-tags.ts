import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

const TAGS_ADD_MUTATION = `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { productId, tags } = JSON.parse(event.body || '{}')
    if (!productId || !tags?.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'productId ve tags[] gerekli' }) }
    }

    const data = await graphqlFetch<any>(TAGS_ADD_MUTATION, { id: productId, tags })
    const userErrors = data.tagsAdd?.userErrors || []

    if (userErrors.length > 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, errors: userErrors }),
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
