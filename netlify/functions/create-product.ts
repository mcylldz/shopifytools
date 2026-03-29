import type { Handler } from '@netlify/functions'
import { graphqlFetch } from './shopify-auth'

interface CreateProductInput {
  title: string
  descriptionHtml: string
  handle: string
  tags: string[]
  images: string[]
  variants: {
    title?: string
    size?: string
    price: string
    compareAtPrice?: string
  }[]
  vendor?: string
  productType?: string
  metafields?: any[]
}

const PRODUCT_CREATE_MUTATION = `
  mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]!) {
    productCreate(input: $input, media: $media) {
      product {
        id
        title
        handle
        status
        variants(first: 50) {
          nodes { id title }
        }
      }
      userErrors { field message }
    }
  }
`

// Görselsiz ürün oluşturma (media ayrı)
const PRODUCT_CREATE_SIMPLE = `
  mutation productCreate($input: ProductInput!) {
    productCreate(input: $input) {
      product {
        id
        title
        handle
        status
        onlineStoreUrl
        variants(first: 50) {
          nodes { id title price }
        }
      }
      userErrors { field message }
    }
  }
`

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body: CreateProductInput = JSON.parse(event.body || '{}')

    if (!body.title) {
      return { statusCode: 400, body: JSON.stringify({ error: 'title gerekli' }) }
    }

    // Variant options oluştur
    const hasSizes = body.variants?.some((v) => v.size)

    // Product input
    const input: any = {
      title: body.title,
      descriptionHtml: body.descriptionHtml || '',
      handle: body.handle || undefined,
      tags: body.tags || [],
      status: 'DRAFT', // Varsayılan taslak
    }

    if (body.vendor) input.vendor = body.vendor
    if (body.productType) input.productType = body.productType

    // Variant'lar
    if (body.variants && body.variants.length > 0 && hasSizes) {
      input.options = ['Beden']
      input.variants = body.variants.map((v) => ({
        optionValues: [{ optionName: 'Beden', name: v.size || v.title }],
        price: v.price,
        compareAtPrice: v.compareAtPrice || undefined,
      }))
    } else if (body.variants && body.variants.length > 0) {
      // Tek variant, bedensiz
      input.variants = [{
        price: body.variants[0].price,
        compareAtPrice: body.variants[0].compareAtPrice || undefined,
      }]
    }

    // Görselleri media olarak ekle
    if (body.images && body.images.length > 0) {
      const media = body.images.map((url, i) => ({
        originalSource: url,
        alt: `${body.title} - ${i + 1}`,
        mediaContentType: 'IMAGE',
      }))

      const data = await graphqlFetch<any>(PRODUCT_CREATE_MUTATION, { input, media })
      const userErrors = data.productCreate?.userErrors || []

      if (userErrors.length > 0) {
        console.error(`[create-product] Errors:`, JSON.stringify(userErrors))
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, errors: userErrors }),
        }
      }

      const product = data.productCreate?.product
      console.log(`[create-product] Ürün oluşturuldu: ${product?.id} — ${product?.title}`)

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          product: {
            id: product?.id,
            title: product?.title,
            handle: product?.handle,
            status: product?.status,
            variants: product?.variants?.nodes || [],
          },
        }),
      }
    } else {
      // Görselsiz
      const data = await graphqlFetch<any>(PRODUCT_CREATE_SIMPLE, { input })
      const userErrors = data.productCreate?.userErrors || []

      if (userErrors.length > 0) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: false, errors: userErrors }),
        }
      }

      const product = data.productCreate?.product
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          product: {
            id: product?.id,
            title: product?.title,
            handle: product?.handle,
            status: product?.status,
            variants: product?.variants?.nodes || [],
          },
        }),
      }
    }
  } catch (err: any) {
    console.error(`[create-product] Fatal: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
