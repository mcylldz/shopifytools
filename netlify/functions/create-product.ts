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

// Adım 1: Ürün oluştur
const PRODUCT_CREATE = `
  mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        title
        handle
        status
        variants(first: 1) {
          nodes { id title price compareAtPrice }
        }
      }
      userErrors { field message }
    }
  }
`

// Variant oluşturma (bulk)
const PRODUCT_VARIANT_BULK = `
  mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
      productVariants {
        id
        title
        price
        compareAtPrice
      }
      userErrors { field message }
    }
  }
`

// Variant güncelleme (tek variant)
const VARIANT_BULK_UPDATE = `
  mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id title price compareAtPrice
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

    // Variants analiz
    const variants = body.variants || []
    const hasSize = variants.some(v => v.size && v.size.trim() !== '')
    const hasColor = variants.some(v => v.color && v.color.trim() !== '')
    const hasMultipleVariants = hasSize || hasColor

    console.log(`[create-product] ─── START ───`)
    console.log(`[create-product] Title: ${body.title}`)
    console.log(`[create-product] Variants count: ${variants.length}, hasSize: ${hasSize}, hasColor: ${hasColor}`)
    console.log(`[create-product] Variant data:`, JSON.stringify(variants.slice(0, 5)))

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

    console.log(`[create-product] Product created: ${createdProduct.id}`)

    const defaultVariantId = createdProduct.variants?.nodes?.[0]?.id

    // ── Adım 2: Variant'ları ayarla ──
    if (hasMultipleVariants && variants.length > 0) {
      // Çoklu variant (size ve/veya color bazlı)
      const variantInputs = variants.map((v) => {
        const optionValues: { optionName: string; name: string }[] = []

        if (hasColor && v.color) {
          optionValues.push({ optionName: 'Renk', name: v.color })
        }
        if (hasSize && v.size) {
          optionValues.push({ optionName: 'Beden', name: v.size })
        }
        // Fallback — en az bir option olmalı
        if (optionValues.length === 0) {
          optionValues.push({ optionName: 'Beden', name: v.title || v.size || 'Tek Beden' })
        }

        const input: any = {
          price: v.price || '0',
          optionValues,
        }

        // compareAtPrice: sadece pozitif değer varsa gönder
        const cp = parseFloat(v.compareAtPrice || '0')
        if (cp > 0) {
          input.compareAtPrice = String(cp)
        }

        return input
      })

      console.log(`[create-product] Creating ${variantInputs.length} variants...`)
      console.log(`[create-product] Sample variant input:`, JSON.stringify(variantInputs[0]))

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
      if (createdVariants.length > 0) {
        console.log(`[create-product] First variant: ${createdVariants[0].title} = ${createdVariants[0].price}`)
      }

    } else if (defaultVariantId && variants.length > 0) {
      // Tek variant — default variant'ın fiyatını güncelle
      const v = variants[0]
      const price = v.price || '0'
      const cp = parseFloat(v.compareAtPrice || '0')

      console.log(`[create-product] Updating default variant: price=${price}, compare=${cp}`)

      const updateInput: any = {
        id: defaultVariantId,
        price,
      }
      if (cp > 0) {
        updateInput.compareAtPrice = String(cp)
      }

      try {
        const updateResult = await graphqlFetch<any>(VARIANT_BULK_UPDATE, {
          productId: createdProduct.id,
          variants: [updateInput],
        })

        const vErrors = updateResult.productVariantsBulkUpdate?.userErrors || []
        if (vErrors.length > 0) {
          console.error(`[create-product] Variant update errors:`, JSON.stringify(vErrors))
        } else {
          const updated = updateResult.productVariantsBulkUpdate?.productVariants?.[0]
          console.log(`[create-product] Default variant updated: price=${updated?.price}, compare=${updated?.compareAtPrice}`)
        }
      } catch (e: any) {
        console.error(`[create-product] Variant update error: ${e.message}`)
      }
    } else {
      console.log(`[create-product] No variants to process, defaultVariantId=${defaultVariantId}`)
    }

    // ── Son ürün bilgilerini çek ──
    const finalData = await graphqlFetch<any>(`
      query getProduct($id: ID!) {
        product(id: $id) {
          id title handle status
          variants(first: 100) {
            nodes { id title price compareAtPrice }
          }
        }
      }
    `, { id: createdProduct.id })

    const finalProduct = finalData.product

    console.log(`[create-product] Final variants:`, JSON.stringify(finalProduct?.variants?.nodes?.slice(0, 3)))
    console.log(`[create-product] ─── END ───`)

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
