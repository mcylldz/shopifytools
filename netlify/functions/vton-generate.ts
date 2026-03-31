import type { Handler } from '@netlify/functions'

const FAL_KEY = process.env.FAL_KEY || ''
const FAL_QUEUE_URL = 'https://queue.fal.run/fal-ai/nano-banana-2/edit'

// ──────────────── Prompt Templates ────────────────

export const FINAL_PROMPTS = {
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

  ghost: (garmentDesc: string) =>
    `Professional studio product photography of a ${garmentDesc}. Invisible ghost mannequin effect: The garment is shown worn by an invisible form, creating a realistic 3D shape with natural volume, folds, and drape, as if floating. Details: Show only the clean inside fabric texture through the neck opening. Background: Pure, seamless flat white studio background. Lighting: Soft, even studio lighting to highlight fabric texture. View: Front view, centered. No: No visible mannequin, no hangers, no human models, no neck labels, no brand tags.`,

  fabric: (fabricInfo?: string) =>
    `Generate a high-resolution fabric texture close-up for a Shopify product page. Use the provided product image${fabricInfo ? ` and fabric information (${fabricInfo})` : ''} to recreate the fabric with natural realism.

The fabric surface should include gentle, authentic micro-folds and soft waves — similar to a garment slightly gathered or lightly bunched during a professional studio macro shoot. These waves must be subtle, clean, and consistent with the actual behavior of the material, avoiding dramatic draping.

The entire frame must remain fully sharp: no blur, no depth of field, no soft gradients, edge-to-edge clarity.

Lighting should be neutral and evenly distributed to highlight the weave pattern, fiber detail, and the three-dimensional surface without creating harsh shadows. Color accuracy and fabric structure must stay true to the original product.

Output should look like a premium e-commerce textile macro: realistic micro-folds, natural volume, full-frame sharpness, neutral lighting, and trustworthy material representation.`,
}

const authHeaders = { 'Authorization': `Key ${FAL_KEY}` }

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!FAL_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'FAL_KEY env variable eksik' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ═══════════ STATUS CHECK (hafif, <2s) ═══════════
    if (action === 'status') {
      const { statusUrl, responseUrl } = body
      if (!statusUrl) throw new Error('statusUrl gerekli')

      const sRes = await fetch(statusUrl, { headers: authHeaders })
      if (!sRes.ok) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, status: 'CHECKING', httpStatus: sRes.status }) }
      }

      const sData = await sRes.json()

      if (sData.status === 'COMPLETED' && responseUrl) {
        // Sonucu al
        const rRes = await fetch(responseUrl, { headers: authHeaders })
        if (rRes.ok) {
          const result = await rRes.json()
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true, status: 'COMPLETED', images: result.images || [] }) }
        }
      }

      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          status: sData.status || 'IN_PROGRESS',
          queuePosition: sData.queue_position,
        }) }
    }

    // ═══════════ SUBMIT (kuyrukla, <3s) ═══════════
    const { mode, modelDesc, garmentDesc, productTitle, garmentCategory, fabricInfo, imageUrls, resolution, aspectRatio } = body

    let prompt: string
    switch (mode) {
      case 'standard':
        prompt = FINAL_PROMPTS.standard(modelDesc || 'Fashion model', garmentDesc || 'Fashion garment', productTitle || '', garmentCategory || 'top')
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

    if (!imageUrls || imageUrls.length === 0) throw new Error('En az bir referans görsel URL gerekli')

    console.log(`[vton] Queue submit — mode: ${mode}, images: ${imageUrls.length}`)

    const submitRes = await fetch(FAL_QUEUE_URL, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        image_urls: imageUrls,
        resolution: resolution || '2K',
        aspect_ratio: aspectRatio || '9:16',
        num_images: 1,
        output_format: 'png',
        safety_tolerance: '6',
        limit_generations: true,
      }),
    })

    if (!submitRes.ok) {
      const errText = await submitRes.text()
      throw new Error(`FAL submit failed (${submitRes.status}): ${errText.substring(0, 200)}`)
    }

    const submitData = await submitRes.json()
    console.log(`[vton] Queued: id=${submitData.request_id}, pos=${submitData.queue_position}`)
    console.log(`[vton] status_url=${submitData.status_url}`)
    console.log(`[vton] response_url=${submitData.response_url}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        status: 'QUEUED',
        requestId: submitData.request_id,
        statusUrl: submitData.status_url,
        responseUrl: submitData.response_url,
        queuePosition: submitData.queue_position,
      }),
    }
  } catch (err: any) {
    console.error(`[vton] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
