import type { Handler } from '@netlify/functions'

const FAL_KEY = process.env.FAL_KEY || ''
const FAL_MODEL = 'fal-ai/nano-banana-2/edit'
const FAL_QUEUE_BASE = `https://queue.fal.run/${FAL_MODEL}`

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

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!FAL_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'FAL_KEY env variable eksik' }) }
  }

  const headers = {
    'Authorization': `Key ${FAL_KEY}`,
    'Content-Type': 'application/json',
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action, requestId } = body

    // ══════════════════════════════════════════════
    // ACTION: STATUS — Check request status
    // ══════════════════════════════════════════════
    if (action === 'status' && requestId) {
      console.log(`[vton] Checking status: ${requestId}`)

      // 1. Status endpoint
      const statusUrl = `${FAL_QUEUE_BASE}/requests/${requestId}/status`
      console.log(`[vton] Status URL: ${statusUrl}`)

      const statusRes = await fetch(statusUrl, {
        method: 'GET',
        headers: { 'Authorization': `Key ${FAL_KEY}` },
      })

      console.log(`[vton] Status response: ${statusRes.status}`)

      if (!statusRes.ok) {
        const errText = await statusRes.text()
        console.log(`[vton] Status error body: ${errText}`)
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, status: 'IN_PROGRESS' }),
        }
      }

      const statusData = await statusRes.json()
      console.log(`[vton] Status data: ${JSON.stringify(statusData)}`)

      // Not completed yet
      if (statusData.status !== 'COMPLETED') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: statusData.status || 'IN_PROGRESS',
            queuePosition: statusData.queue_position,
          }),
        }
      }

      // 2. COMPLETED — fetch result from /response endpoint
      console.log(`[vton] COMPLETED! Fetching result...`)
      const responseUrl = `${FAL_QUEUE_BASE}/requests/${requestId}/response`
      console.log(`[vton] Response URL: ${responseUrl}`)

      const resultRes = await fetch(responseUrl, {
        method: 'GET',
        headers: { 'Authorization': `Key ${FAL_KEY}` },
      })

      console.log(`[vton] Result response: ${resultRes.status}`)

      if (!resultRes.ok) {
        const errText = await resultRes.text()
        console.log(`[vton] Result error: ${errText}`)
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, status: 'COMPLETED_NO_RESULT' }),
        }
      }

      const result = await resultRes.json()
      console.log(`[vton] Result keys: ${Object.keys(result).join(', ')}`)

      const images = result.images || []
      console.log(`[vton] Images count: ${images.length}`)
      if (images.length > 0) {
        console.log(`[vton] First image URL: ${images[0].url?.substring(0, 80)}`)
      }

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          status: 'COMPLETED',
          images: images,
        }),
      }
    }

    // ══════════════════════════════════════════════
    // ACTION: SUBMIT — Submit new job to queue
    // ══════════════════════════════════════════════
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

    if (!imageUrls || imageUrls.length === 0) {
      throw new Error('En az bir referans görsel URL gerekli')
    }

    console.log(`[vton] Submit — mode: ${mode}, images: ${imageUrls.length}`)

    const submitRes = await fetch(FAL_QUEUE_BASE, {
      method: 'POST',
      headers,
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
      throw new Error(`FAL submit failed (${submitRes.status}): ${errText}`)
    }

    const submitData = await submitRes.json()
    console.log(`[vton] Submit response: ${JSON.stringify(submitData).substring(0, 300)}`)

    // FAL queue response: { request_id, response_url, status_url, cancel_url, queue_position }
    const rid = submitData.request_id
    if (!rid) {
      // Sync result — images directly in response
      if (submitData.images?.length > 0) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: 'COMPLETED',
            images: submitData.images,
          }),
        }
      }
      throw new Error('FAL: No request_id or images in response')
    }

    console.log(`[vton] Queued — request_id: ${rid}, position: ${submitData.queue_position}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        status: 'QUEUED',
        requestId: rid,
        statusUrl: submitData.status_url,
        responseUrl: submitData.response_url,
      }),
    }
  } catch (err: any) {
    console.error(`[vton] Error: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
