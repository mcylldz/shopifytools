import type { Handler } from '@netlify/functions'

const FAL_KEY = process.env.FAL_KEY || ''
const FAL_MODEL = 'fal-ai/nano-banana-2/edit'
const FAL_BASE = `https://queue.fal.run/${FAL_MODEL}`

// ──────────────── Prompt Templates ────────────────

export const FINAL_PROMPTS = {
  // Standard VTON — combined prompt
  standard: (modelDesc: string, garmentDesc: string, productTitle: string, category: string) =>
    `Professional editorial fashion photography. The exact same model from image 1 wearing a ${garmentDesc}. The model description: ${modelDesc}.

IDENTITY & FACE:
- Maintain exact facial features, bone structure, and expression of the model in image 1. Keep the angle, background, and environment exactly as shown in image 1.
- Do not alter face shape, eye color, or skin texture.

TECHNICAL REQUIREMENTS:
- The garment fits perfectly with realistic fabric physics, natural folds, and heavy draping.
- High-fidelity texture rendering, studio lighting, 8k resolution, sharp focus.
- Masterpiece quality, photorealistic, volumetric lighting.
- Accurate body proportions, realistic hands, natural pose.

CONTEXT:
- Product Name: ${productTitle}
- Product Type: ${category}`,

  // Ghost Mode prompt
  ghost: (garmentDesc: string) =>
    `Professional studio product photography of a ${garmentDesc}. Invisible ghost mannequin effect: The garment is shown worn by an invisible form, creating a realistic 3D shape with natural volume, folds, and drape, as if floating. Details: Show only the clean inside fabric texture through the neck opening. Background: Pure, seamless flat white studio background. Lighting: Soft, even studio lighting to highlight fabric texture. View: Front view, centered. No: No visible mannequin, no hangers, no human models, no neck labels, no brand tags.`,

  // Fabric Mode prompt
  fabric: (fabricInfo?: string) =>
    `Generate a high-resolution fabric texture close-up for a Shopify product page. Use the provided product image${fabricInfo ? ` and fabric information (${fabricInfo})` : ''} to recreate the fabric with natural realism.

The fabric surface should include gentle, authentic micro-folds and soft waves — similar to a garment slightly gathered or lightly bunched during a professional studio macro shoot. These waves must be subtle, clean, and consistent with the actual behavior of the material, avoiding dramatic draping.

The entire frame must remain fully sharp: no blur, no depth of field, no soft gradients, edge-to-edge clarity.

Lighting should be neutral and evenly distributed to highlight the weave pattern, fiber detail, and the three-dimensional surface without creating harsh shadows. Color accuracy and fabric structure must stay true to the original product.

Output should look like a premium e-commerce textile macro: realistic micro-folds, natural volume, full-frame sharpness, neutral lighting, and trustworthy material representation.`,
}

// ──────────────── FAL AI Queue ────────────────

async function falSubmit(prompt: string, imageUrls: string[], resolution = '2K', aspectRatio = '9:16') {
  const res = await fetch(FAL_BASE, {
    method: 'POST',
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_urls: imageUrls,
      resolution,
      aspect_ratio: aspectRatio,
      num_images: 1,
      output_format: 'png',
      safety_tolerance: '6',
      limit_generations: true,
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`FAL submit failed (${res.status}): ${errText}`)
  }

  return await res.json()
}

async function falStatus(requestId: string) {
  const res = await fetch(`${FAL_BASE}/requests/${requestId}/status`, {
    headers: { 'Authorization': `Key ${FAL_KEY}` },
  })
  if (!res.ok) throw new Error(`FAL status failed: ${res.status}`)
  return await res.json()
}

async function falResult(requestId: string) {
  const res = await fetch(`${FAL_BASE}/requests/${requestId}`, {
    headers: { 'Authorization': `Key ${FAL_KEY}` },
  })
  if (!res.ok) throw new Error(`FAL result failed: ${res.status}`)
  return await res.json()
}

// Poll with timeout
async function falPoll(requestId: string, maxWaitMs = 120000): Promise<any> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const status = await falStatus(requestId)
    if (status.status === 'COMPLETED') {
      return await falResult(requestId)
    }
    if (status.status === 'FAILED') {
      throw new Error(`FAL generation failed: ${JSON.stringify(status)}`)
    }
    // Wait 3 seconds
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('FAL generation timeout (2 dakika)')
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!FAL_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'FAL_KEY env variable eksik' }) }
  }

  try {
    const {
      mode,           // 'standard' | 'ghost' | 'fabric'
      modelDesc,      // model description (from vton-analyze)
      garmentDesc,    // garment description (from vton-analyze)
      productTitle,   // ürün adı
      garmentCategory, // kategori
      fabricInfo,     // opsiyonel kumaş bilgisi
      imageUrls,      // referans görseller [modelUrl, garmentUrl] veya [garmentUrl]
      resolution,     // '1K' | '2K' | '4K'
      aspectRatio,    // '9:16' | '1:1' etc
    } = JSON.parse(event.body || '{}')

    let prompt: string
    switch (mode) {
      case 'standard':
        prompt = FINAL_PROMPTS.standard(
          modelDesc || 'Fashion model',
          garmentDesc || 'Fashion garment',
          productTitle || '',
          garmentCategory || 'top'
        )
        break
      case 'ghost':
        prompt = FINAL_PROMPTS.ghost(garmentDesc || 'Fashion garment')
        break
      case 'fabric':
        prompt = FINAL_PROMPTS.fabric(fabricInfo)
        break
      default:
        throw new Error(`Geçersiz mod: ${mode}`)
    }

    if (!imageUrls || imageUrls.length === 0) {
      throw new Error('En az bir referans görsel URL gerekli')
    }

    console.log(`[vton-generate] Mode: ${mode}, Images: ${imageUrls.length}, Resolution: ${resolution || '2K'}`)
    console.log(`[vton-generate] Prompt: ${prompt.substring(0, 150)}...`)

    // Submit to FAL AI
    const submitResult = await falSubmit(prompt, imageUrls, resolution || '2K', aspectRatio || '9:16')
    const requestId = submitResult.request_id

    if (!requestId) {
      // Sync mode — result returned directly
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          images: submitResult.images || [],
          description: submitResult.description || '',
        }),
      }
    }

    console.log(`[vton-generate] Submitted, request_id: ${requestId}`)

    // Poll for result
    const result = await falPoll(requestId)

    console.log(`[vton-generate] ✅ Completed, ${result.images?.length || 0} images`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        images: result.images || [],
        description: result.description || '',
        requestId,
      }),
    }
  } catch (err: any) {
    console.error(`[vton-generate] Error: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
