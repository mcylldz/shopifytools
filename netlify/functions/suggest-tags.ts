import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })

const TAG_CATEGORIES = `Kıyafet Türleri: dresses, blouses, bodysuits, cardigans, jumpsuits, jeans, skirts, shorts, blazers, hoodies, sweaters, lingerie, swimwear, activewear, coats, jackets, tops, bottoms, pants, kimonos & cover ups, cloaks, jumper, bikini, rompers
Alt Kategori: bodycon, crop top, maxi, midi, mini, long dress, halter neck, backless, corset, strapless, asymmetrical, cutout, high waist, low cut, baggy tops, cropped pants, cargo, flare leg, matching sets, bikini tops, bikini bottoms, bikini sets, cover ups, down coats, denim jackets & coats, denim shorts, denim skirts, denim tops, knit dresses, knit tops, active tops, active bottoms, active sets
Kumaş: cotton, linen, denim, chiffon, satin, lace, mesh, knit, corduroy, fleece, faux leather, faux fur, acrylic, jersey, sequin, jacquard, modal, cotton blends, linen blend, feather, velvet
Desen: floral, animal print, leopard, geometric, colorblock, embroidered, graphic, monochrome, ditsy floral, marbling, botanical pattern, checkerboard, color block, fringe, metallic
Kol & Yaka: long sleeve, half sleeve, bell sleeve, cold shoulder, halter, crew neck, mock neck, cowl neck, high neck, collar, hooded, bishop sleeve, funnel neck, adjustable straps, collarless, button-down collar, criss cross
Bel & Fit: high waist, mid waist, low waist, elastic waist, elastic waistband, belted, drawstring, non belted, high stretch, medium stretch, non-stretch
Renk: black, white, blue, green, red, pink, beige, brown, burgundy, grey, navy, ivory, khaki, gold, apricot, camel, chocolate, champagne, coffee, nude, mustard, fuchsia, hot pink, dark green, dark brown, lightblue
Stil: casual, elegant, formal, date night, going out, holiday, business, boho, athleisure, bridal, festival, daily, comfy, bohemian, french style, corpcore, dolce vita, chic essential, leisure, feminine, effortlessly flattering, streetwear
Aksesuar: bags, belts, earrings, necklaces, bracelets, hats, glasses, gloves, hair accessories, jewellery, scarves`

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY eksik' }) }
  }

  try {
    const { imageUrl, title, description } = JSON.parse(event.body || '{}')

    if (!imageUrl && !title) {
      return { statusCode: 400, body: JSON.stringify({ error: 'imageUrl veya title gerekli' }) }
    }

    const parts: any[] = []

    if (imageUrl && imageUrl.startsWith('http')) {
      parts.push({
        type: 'image',
        source: { type: 'url', url: imageUrl },
      })
    }

    parts.push({
      type: 'text',
      text: `Analyze this fashion product and select the most relevant tags from ONLY the categories and tags listed below. Do NOT invent new tags — use ONLY the exact tags from this list.

Product Title: ${title || 'N/A'}
${description ? `Product Description: ${description.substring(0, 500)}` : ''}

AVAILABLE TAGS:
${TAG_CATEGORIES}

RULES:
1. Select ONLY tags that clearly apply to this specific product.
2. Choose 8-15 tags maximum across all categories.
3. Always include at least one tag from: Kıyafet Türleri, Renk, and Stil.
4. Return ONLY a comma-separated list of the selected tags, nothing else.
5. Do NOT add any explanation or prefix — just the tag list.`,
    })

    console.log(`[suggest-tags] Analyzing: ${title || imageUrl?.substring(0, 60)}`)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: parts }],
    })

    const textBlock = response.content.find((b: any) => b.type === 'text')
    const rawTags = (textBlock as any)?.text || ''

    // Temizle
    const tags = rawTags
      .split(',')
      .map((t: string) => t.trim().toLowerCase())
      .filter((t: string) => t.length > 0 && t.length < 50)

    console.log(`[suggest-tags] Suggested ${tags.length} tags: ${tags.join(', ')}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, tags }),
    }
  } catch (err: any) {
    console.error(`[suggest-tags] Error: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
