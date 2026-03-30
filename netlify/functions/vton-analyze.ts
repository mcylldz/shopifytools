import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })

// ──────────────── Prompt Templates ────────────────

const PROMPTS = {
  // Standard VTON — Manken analizi
  model: `Describe this fashion model image for an AI image generator. Focus on:
1. The model's pose, gender, and visible physical traits (body type, hair, skin tone).
2. The clothing they are currently wearing (to be replaced).
3. The lighting, background, and camera angle.
Output a concise, descriptive prompt. Do NOT include introductory phrases.`,

  // Standard VTON — Ürün analizi
  garment: (productTitle: string, category: string, fabricInfo?: string) => `Act as a technical fashion designer. Analyze this garment image to create a high-fidelity prompt description for an AI image generator.

Focus STRICTLY on these attributes:
1. Garment Type & Fit: Exact category (e.g., cropped hoodie, maxi dress), silhouette (oversized, tailored, flowy), and cut.
2. Fabric & Texture: Specific material properties (e.g., chunky cable knit, sheer chiffon, rigid denim), surface finish (matte, satin, distressed), and fabric weight.
3. Neckline & Sleeves: Specific styles (crew neck, off-shoulder, puff sleeves, raglan, cuffs).
4. Design Details: Prints, patterns, embroidery, buttons, zippers, pockets, and seam placements.
5. Color: Precise color names (e.g., "crimson red" instead of "red").

Product Name: ${productTitle}
Product Category: ${category}
${fabricInfo ? `Fabric Info: ${fabricInfo}` : ''}

CRITICAL CONSTRAINTS:
- DO NOT describe the background, hanger, or the mannequin wearing it.
- DO NOT include introductory phrases like "Here is the description".
- OUTPUT ONLY a concise, comma-separated descriptive string ready for use in an image prompt.`,

  // Ghost Mode — Ürün analizi (ghost özel)
  ghost: (productTitle: string, category: string, fabricInfo?: string) => `Act as a technical fashion designer and expert product photographer.
Analyze the garment in this image to create a high-fidelity description for an AI image generator.

Your goal is to describe ONLY the garment so it can be recreated on an invisible ghost mannequin.

ANALYZE AND DESCRIBE STRICTLY:
1. Fabric & Physics: Exact material name (e.g., heavy french terry, sheer chiffon, rigid denim), texture weight, and how the fabric drapes or folds.
2. Construction Details: Visible seams, stitching types (e.g., contrast stitch, overlock), hem style (raw, ribbed, folded).
3. Neckline & Hardware: Collar shape, zippers, buttons, drawstrings, or metal accents.
4. Silhouette: Fit type (oversized, boxy, bodycon) and sleeve style (raglan, drop shoulder).
5. Color: Precise color shade (e.g., "heather grey" instead of "grey", "navy blue" instead of "blue").

Product Name: ${productTitle}
Product Category: ${category}
${fabricInfo ? `Fabric Info: ${fabricInfo}` : ''}

CRITICAL CONSTRAINTS:
- IGNORE the human model, skin, hair, face, and hands.
- IGNORE the background or any props.
- DO NOT use introductory phrases like "The image shows...".
- OUTPUT FORMAT: A single, concise, comma-separated string of descriptive keywords.`,
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY env variable eksik' }) }
  }

  try {
    const { imageUrl, mode, productTitle, garmentCategory, fabricInfo } = JSON.parse(event.body || '{}')

    if (!imageUrl) {
      return { statusCode: 400, body: JSON.stringify({ error: 'imageUrl gerekli' }) }
    }

    let prompt: string
    switch (mode) {
      case 'model':
        prompt = PROMPTS.model
        break
      case 'garment':
        prompt = PROMPTS.garment(productTitle || 'Fashion garment', garmentCategory || 'top', fabricInfo)
        break
      case 'ghost':
        prompt = PROMPTS.ghost(productTitle || 'Fashion garment', garmentCategory || 'top', fabricInfo)
        break
      default:
        prompt = PROMPTS.garment(productTitle || '', garmentCategory || '', fabricInfo)
    }

    console.log(`[vton-analyze] Mode: ${mode}, Image: ${imageUrl.substring(0, 80)}...`)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'url', url: imageUrl },
          },
          { type: 'text', text: prompt },
        ],
      }],
    })

    const textBlock = response.content.find((b: any) => b.type === 'text')
    const description = (textBlock as any)?.text || ''

    console.log(`[vton-analyze] Result (${mode}): ${description.substring(0, 120)}...`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, description }),
    }
  } catch (err: any) {
    console.error(`[vton-analyze] Error: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
