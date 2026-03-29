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
    color?: string
    price: string
    compareAtPrice?: string
  }[]
  vendor?: string
  productType?: string
}

// Adım 1: Ürün oluştur (variant + option yok)
const PRODUCT_CREATE = `
  mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        handle
        status
        variants(first: 1) {
          nodes { id title price }
        }
      }
      userErrors { field message }
    }
  }
`

// Adım 2: Variant set (options + variants birlikte)
const PRODUCT_VARIANT_BULK = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
      productVariants {
        id
        title
        price
      }
      userErrors { field message }
    }
  }
`

// Option ekleme
const PRODUCT_OPTIONS_UPDATE = `
  mutation productUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id }
      userErrors { field message }
    }
  }
`

// Varsayılan variant silme
const VARIANT_DELETE = `
  mutation productVariantDelete($id: ID!) {
    productVariantDelete(id: $id) {
      deletedProductVariantId
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

    const hasSizes = body.variants?.some((v) => v.size)

    // ── Adım 1: Ürün oluştur ──
    const product: any = {
      title: body.title,
      descriptionHtml: body.descriptionHtml || '',
      handle: body.handle || undefined,
      tags: body.tags || [],
      status: 'DRAFT',
    }

    if (body.vendor) product.vendor = body.vendor
    if (body.productType) product.productType = body.productType

    // Media
    const media = (body.images || [])
      .filter((u) => u.startsWith('http'))
      .map((url, i) => ({
        originalSource: url,
        alt: `${body.title} - ${i + 1}`,
        mediaContentType: 'IMAGE',
      }))

    console.log(`[create-product] Creating: ${body.title}, images: ${media.length}, variants: ${body.variants?.length}`)

    const createData = await graphqlFetch<any>(PRODUCT_CREATE, {
      product,
      media: media.length > 0 ? media : undefined,
    })

    const createErrors = createData.productCreate?.userErrors || []
    if (createErrors.length > 0) {
      console.error(`[create-product] Create errors:`, JSON.stringify(createErrors))
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, errors: createErrors }),
      }
    }

    const createdProduct = createData.productCreate?.product
    if (!createdProduct?.id) throw new Error('Ürün oluşturulamadı')

    console.log(`[create-product] Created: ${createdProduct.id}`)

    // Default variant'ın ID'si (sonra silinecek)
    const defaultVariantId = createdProduct.variants?.nodes?.[0]?.id

    // ── Adım 2: Variant'ları ekle ──
    if (hasSizes && body.variants && body.variants.length > 0) {
      // Önce variant'ları ekle
      const variantInputs = body.variants.map((v) => ({
        price: v.price,
        compareAtPrice: v.compareAtPrice || undefined,
        optionValues: [
          { optionName: 'Beden', name: v.size || v.title || 'Tek Beden' },
        ],
      }))

      console.log(`[create-product] Adding ${variantInputs.length} variants...`)

      const variantData = await graphqlFetch<any>(PRODUCT_VARIANT_BULK, {
        productId: createdProduct.id,
        variants: variantInputs,
        strategy: 'REMOVE_STANDALONE_VARIANT',
      })

      const variantErrors = variantData.productVariantsBulkCreate?.userErrors || []
      if (variantErrors.length > 0) {
        console.error(`[create-product] Variant errors:`, JSON.stringify(variantErrors))
      }

      const createdVariants = variantData.productVariantsBulkCreate?.productVariants || []
      console.log(`[create-product] ${createdVariants.length} variants created`)
    } else if (body.variants?.length === 1) {
      // Tek variant — fiyat güncelle
      if (defaultVariantId) {
        try {
          await graphqlFetch<any>(`
            mutation variantUpdate($input: ProductVariantInput!) {
              productVariantUpdate(input: $input) {
                productVariant { id price }
                userErrors { field message }
              }
            }
          `, {
            input: {
              id: defaultVariantId,
              price: body.variants[0].price,
              compareAtPrice: body.variants[0].compareAtPrice || undefined,
            },
          })
        } catch (e: any) {
          console.error(`[create-product] Variant update error: ${e.message}`)
        }
      }
    }

    // Son ürün bilgilerini çek
    const finalData = await graphqlFetch<any>(`
      query getProduct($id: ID!) {
        product(id: $id) {
          id title handle status
          variants(first: 50) {
            nodes { id title price }
          }
        }
      }
    `, { id: createdProduct.id })

    const finalProduct = finalData.product

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        product: {
          id: finalProduct?.id || createdProduct.id,
          title: finalProduct?.title || createdProduct.title,
          handle: finalProduct?.handle || createdProduct.handle,
          status: finalProduct?.status || 'DRAFT',
          variants: finalProduct?.variants?.nodes || [],
        },
      }),
    }
  } catch (err: any) {
    console.error(`[create-product] Fatal: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
