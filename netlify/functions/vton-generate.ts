import type { Handler } from '@netlify/functions'

const FAL_KEY = process.env.FAL_KEY || ''

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

// ──────────────── Helper: FAL'a fetch ────────────────
async function falFetch(url: string, options: RequestInit = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  console.log(`[FAL] ${options.method || 'GET'} ${url} → ${res.status} | ${text.substring(0, 500)}`)
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) }
  } catch {
    return { ok: res.ok, status: res.status, data: { raw: text } }
  }
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!FAL_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'FAL_KEY env variable eksik' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action, requestId, statusUrl, responseUrl } = body

    // ══════════════════════════════════════════════════════
    //  STATUS CHECK — FAL'ın verdiği URL'leri birebir kullan
    // ══════════════════════════════════════════════════════
    if (action === 'status' && requestId) {
      console.log(`[FAL] === STATUS CHECK === requestId: ${requestId}`)

      // 1) Status kontrol
      const sUrl = statusUrl || `https://queue.fal.run/fal-ai/nano-banana-2/edit/requests/${requestId}/status`
      const statusResult = await falFetch(sUrl)

      if (!statusResult.ok) {
        // Status endpoint hata → debug bilgisi dön
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: 'IN_PROGRESS',
            debug: { statusEndpoint: sUrl, httpStatus: statusResult.status, response: statusResult.data },
          }),
        }
      }

      const falStatus = statusResult.data?.status
      console.log(`[FAL] Status: ${falStatus}`)

      // Henüz bitmedi
      if (falStatus !== 'COMPLETED') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: falStatus || 'IN_PROGRESS',
            debug: { statusData: statusResult.data },
          }),
        }
      }

      // 2) COMPLETED → Sonucu al
      const rUrl = responseUrl || `https://queue.fal.run/fal-ai/nano-banana-2/edit/requests/${requestId}/response`
      console.log(`[FAL] COMPLETED! Fetching result from: ${rUrl}`)
      const resultResult = await falFetch(rUrl)

      if (!resultResult.ok) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: 'COMPLETED',
            images: [],
            debug: { responseEndpoint: rUrl, httpStatus: resultResult.status, response: resultResult.data },
          }),
        }
      }

      const images = resultResult.data?.images || []
      console.log(`[FAL] Got ${images.length} images`)

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          status: 'COMPLETED',
          images,
        }),
      }
    }

    // ══════════════════════════════════════════════════════
    //  SUBMIT — Yeni job gönder
    // ══════════════════════════════════════════════════════
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

    console.log(`[FAL] === SUBMIT === mode: ${mode}, images: ${imageUrls.length}`)

    const submitResult = await falFetch('https://queue.fal.run/fal-ai/nano-banana-2/edit', {
      method: 'POST',
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

    if (!submitResult.ok) {
      throw new Error(`FAL submit failed (${submitResult.status}): ${JSON.stringify(submitResult.data)}`)
    }

    const rid = submitResult.data.request_id
    const sUrl = submitResult.data.status_url
    const rUrl = submitResult.data.response_url

    console.log(`[FAL] Queued: request_id=${rid}`)
    console.log(`[FAL] status_url=${sUrl}`)
    console.log(`[FAL] response_url=${rUrl}`)

    // Sync result (bazı modeller hemen döner)
    if (submitResult.data.images?.length > 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          status: 'COMPLETED',
          images: submitResult.data.images,
        }),
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        status: 'QUEUED',
        requestId: rid,
        statusUrl: sUrl,
        responseUrl: rUrl,
      }),
    }
  } catch (err: any) {
    console.error(`[FAL] Error: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}
