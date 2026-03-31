import type { Handler } from '@netlify/functions'
import { getAccessToken } from './shopify-auth'

const SHOPIFY_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN || ''

interface VariantInput {
  title?: string
  size?: string
  color?: string
  price: string
  compareAtPrice?: string
}

interface CreateProductInput {
  title: string
  descriptionHtml: string
  handle: string
  tags: string[]
  images: string[]
  variants: VariantInput[]
  vendor?: string
  productType?: string
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body: CreateProductInput = JSON.parse(event.body || '{}')
    if (!body.title) {
      return { statusCode: 400, body: JSON.stringify({ error: 'title gerekli' }) }
    }

    const token = await getAccessToken()
    const variants = body.variants || []

    // Variant analiz
    const hasSize = variants.some(v => v.size && v.size.trim() !== '')
    const hasColor = variants.some(v => v.color && v.color.trim() !== '')

    console.log(`[create-product] ─── START ───`)
    console.log(`[create-product] Title: ${body.title}`)
    console.log(`[create-product] Variants: ${variants.length}, hasSize: ${hasSize}, hasColor: ${hasColor}`)
    console.log(`[create-product] Sample:`, JSON.stringify(variants.slice(0, 3)))

    // ── REST API ile tek çağrıda ürün oluştur ──
    const product: any = {
      title: body.title,
      body_html: body.descriptionHtml || '',
      handle: body.handle || undefined,
      tags: (body.tags || []).join(', '),
      status: 'draft',
    }

    if (body.vendor) product.vendor = body.vendor
    if (body.productType) product.product_type = body.productType

    // Options
    if (hasColor && hasSize) {
      product.options = [{ name: 'Renk' }, { name: 'Beden' }]
    } else if (hasSize) {
      product.options = [{ name: 'Beden' }]
    } else if (hasColor) {
      product.options = [{ name: 'Renk' }]
    }

    // Variants
    if (variants.length > 0) {
      product.variants = variants.map(v => {
        const rv: any = {
          price: v.price || '0',
        }

        // compareAtPrice: sadece pozitif değer
        const cp = parseFloat(v.compareAtPrice || '0')
        if (cp > 0) rv.compare_at_price = String(cp)

        // Option values
        if (hasColor && hasSize) {
          rv.option1 = v.color || 'Varsayılan'
          rv.option2 = v.size || 'Tek Beden'
        } else if (hasSize) {
          rv.option1 = v.size || 'Tek Beden'
        } else if (hasColor) {
          rv.option1 = v.color || 'Varsayılan'
        }

        return rv
      })
    } else {
      // Hiç variant yoksa en azından fiyat set et
      product.variants = [{ price: '0' }]
    }

    // Images
    const images = (body.images || [])
      .filter(u => u.startsWith('http'))
      .map(url => ({ src: url }))

    if (images.length > 0) {
      product.images = images
    }

    console.log(`[create-product] Sending REST API request with ${product.variants?.length} variants, ${images.length} images`)
    console.log(`[create-product] First variant:`, JSON.stringify(product.variants?.[0]))

    const res = await fetch(`https://${SHOPIFY_DOMAIN}/admin/api/2025-01/products.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ product }),
    })

    if (!res.ok) {
      const errorText = await res.text()
      console.error(`[create-product] REST API error ${res.status}:`, errorText)
      throw new Error(`Shopify API error: ${res.status} - ${errorText.substring(0, 200)}`)
    }

    const data = await res.json()
    const created = data.product

    console.log(`[create-product] Product created: ${created.id}`)
    console.log(`[create-product] Variants created: ${created.variants?.length}`)
    if (created.variants?.[0]) {
      console.log(`[create-product] First variant: ${created.variants[0].title}, price=${created.variants[0].price}, compare=${created.variants[0].compare_at_price}`)
    }
    console.log(`[create-product] ─── END ───`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        product: {
          id: `gid://shopify/Product/${created.id}`,
          title: created.title,
          handle: created.handle,
          status: (created.status || 'draft').toUpperCase(),
          variants: (created.variants || []).map((v: any) => ({
            id: `gid://shopify/ProductVariant/${v.id}`,
            title: v.title,
            price: v.price,
            compareAtPrice: v.compare_at_price,
          })),
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
