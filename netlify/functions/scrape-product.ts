import type { Handler } from '@netlify/functions'

interface ScrapedProduct {
  source: 'shopify' | '1688'
  title: string
  description: string
  images: string[]
  sizes: string[]
  colors: string[]
  price: { amount: number; currency: string }
  priceTRY: number
  variants: { title: string; size?: string; color?: string; price: number; sku?: string }[]
  vendor?: string
  productType?: string
  tags?: string
  handle?: string
  rawOptions?: any[]
}

// Döviz kurları
const CNY_TO_TRY = 7
const USD_TO_TRY = 45

function parseShopifyUrl(url: string): { store: string; handle: string } | null {
  // https://thecommense.com/products/lace-strapless-corset-top-1
  // https://thecommense.com/collections/new/products/lace-strapless-corset-top-1
  const match = url.match(/https?:\/\/([^/]+)\/(?:.*\/)?products\/([^/?#]+)/)
  if (match) return { store: match[1], handle: match[2] }
  return null
}

async function scrapeShopify(url: string): Promise<ScrapedProduct> {
  const parsed = parseShopifyUrl(url)
  if (!parsed) throw new Error('Geçersiz Shopify URL formatı')

  const jsonUrl = `https://${parsed.store}/products/${parsed.handle}.json`
  const res = await fetch(jsonUrl)
  if (!res.ok) throw new Error(`Shopify ürün alınamadı: ${res.status}`)

  const { product } = await res.json()

  // Sizes ve colors çıkar
  const sizeOption = product.options?.find((o: any) =>
    ['size', 'beden', 'boyut'].includes(o.name.toLowerCase())
  )
  const colorOption = product.options?.find((o: any) =>
    ['color', 'colour', 'renk'].includes(o.name.toLowerCase())
  )

  const sizes = sizeOption?.values || []
  const colors = colorOption?.values || []

  // İlk variant fiyatı
  const firstPrice = parseFloat(product.variants?.[0]?.price || '0')
  const currency = product.variants?.[0]?.price_currency || 'USD'
  const priceTRY = currency === 'USD' ? firstPrice * USD_TO_TRY
    : currency === 'CNY' ? firstPrice * CNY_TO_TRY
    : firstPrice

  // Görseller
  const images = (product.images || []).map((img: any) => img.src)

  // Variants
  const variants = (product.variants || []).map((v: any) => ({
    title: v.title,
    size: v.option2 || v.option1,
    color: colorOption ? v.option1 : undefined,
    price: parseFloat(v.price || '0'),
    sku: v.sku,
  }))

  return {
    source: 'shopify',
    title: product.title,
    description: product.body_html || '',
    images,
    sizes,
    colors,
    price: { amount: firstPrice, currency },
    priceTRY: Math.round(priceTRY),
    variants,
    vendor: product.vendor,
    productType: product.product_type,
    tags: product.tags,
    handle: product.handle,
    rawOptions: product.options,
  }
}

function parse1688Html(html: string): ScrapedProduct {
  // Başlık
  let title = ''
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    || html.match(/"subject"\s*:\s*"([^"]+)"/)
    || html.match(/data-title="([^"]+)"/)
  if (titleMatch) title = titleMatch[1].replace(/-.*$/, '').trim()

  // Görseller
  const images: string[] = []
  // 1688 görselleri genelde data attribute veya JSON'da
  const imgRegex = /https?:\/\/cbu01\.alicdn\.com\/[^\s"']+\.(?:jpg|png|jpeg|webp)/gi
  const imgMatches = html.match(imgRegex) || []
  const seen = new Set<string>()
  for (const img of imgMatches) {
    const clean = img.replace(/_.+x.+\./, '.').split('?')[0]
    if (!seen.has(clean) && !clean.includes('icon') && !clean.includes('logo')) {
      seen.add(clean)
      images.push(clean)
    }
  }

  // Fiyat (CNY)
  let priceCNY = 0
  const priceMatch = html.match(/"price"\s*:\s*"?([\d.]+)"?/i)
    || html.match(/¥\s*([\d.]+)/)
    || html.match(/price.*?([\d]+\.[\d]+)/)
  if (priceMatch) priceCNY = parseFloat(priceMatch[1])

  // Bedenler — sadece harf bedenleri
  const sizes: string[] = []
  const sizeRegex = /\b(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)\b/g
  // Tüm HTML'de ara
  const allSizeMatches = html.match(sizeRegex) || []
  for (const s of allSizeMatches) {
    const upper = s.toUpperCase()
    if (!sizes.includes(upper)) sizes.push(upper)
  }
  // Sıralama
  const sizeOrder = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL', '5XL']
  sizes.sort((a, b) => sizeOrder.indexOf(a) - sizeOrder.indexOf(b))
  if (sizes.length === 0) {
    sizes.push('S', 'M', 'L', 'XL')
  }

  // Açıklama
  let description = ''
  const descMatch = html.match(/"description"\s*:\s*"([^"]+)"/)
  if (descMatch) description = descMatch[1]

  // CNY fiyat: (CNY × 7 + 1400) formülü — 3x çarpma frontend'de
  const priceTRY = Math.round(priceCNY * CNY_TO_TRY + 1400)

  const variants = sizes.map((s) => ({
    title: s,
    size: s,
    price: priceCNY,
    sku: '',
  }))

  return {
    source: '1688',
    title,
    description,
    images,
    sizes,
    colors: [],
    price: { amount: priceCNY, currency: 'CNY' },
    priceTRY,
    variants,
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { url, html } = JSON.parse(event.body || '{}')

    if (!url && !html) {
      return { statusCode: 400, body: JSON.stringify({ error: 'url veya html gerekli' }) }
    }

    let product: ScrapedProduct

    if (url && url.includes('1688.com')) {
      // 1688 — html gerekli (login wall)
      if (!html) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: false,
            needsHtml: true,
            message: '1688 sayfasının HTML kaynağını yapıştırın (sağ tık → Sayfa kaynağını görüntüle)',
          }),
        }
      }
      product = parse1688Html(html)
    } else if (url) {
      // Shopify
      product = await scrapeShopify(url)
    } else {
      // Raw HTML — 1688 varsay
      product = parse1688Html(html)
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, product }),
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
