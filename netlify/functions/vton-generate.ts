import type { Handler } from '@netlify/functions'
import { fal } from '@fal-ai/client'

const FAL_KEY = process.env.FAL_KEY || ''
const FAL_MODEL = 'fal-ai/nano-banana-2/edit'

// Configure FAL client
fal.config({ credentials: FAL_KEY })

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

  try {
    const body = JSON.parse(event.body || '{}')
    const { action, requestId } = body

    // ══════════════════════════════════════════════
    // ACTION: STATUS — Check request status via SDK
    // ══════════════════════════════════════════════
    if (action === 'status' && requestId) {
      console.log(`[vton] Checking status via SDK: ${requestId}`)

      try {
        // Önce status kontrol et
        const status = await fal.queue.status(FAL_MODEL, {
          requestId,
          logs: true,
        })

        console.log(`[vton] SDK status: ${JSON.stringify(status).substring(0, 300)}`)

        if (status.status === 'COMPLETED') {
          console.log(`[vton] COMPLETED — fetching result via SDK...`)

          // Result'ı al
          const result = await fal.queue.result(FAL_MODEL, { requestId })
          console.log(`[vton] SDK result keys: ${Object.keys(result?.data || {}).join(', ')}`)

          const data = result?.data as any
          const images = data?.images || []
          console.log(`[vton] Images found: ${images.length}`)

          if (images.length > 0) {
            console.log(`[vton] Image URL: ${images[0]?.url?.substring(0, 80)}`)
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

        // Henüz bitmedi
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            status: status.status || 'IN_PROGRESS',
            queuePosition: (status as any).queue_position,
          }),
        }
      } catch (statusErr: any) {
        console.error(`[vton] SDK status error: ${statusErr.message}`)

        // Status hatası — belki direkt result dene
        try {
          const result = await fal.queue.result(FAL_MODEL, { requestId })
          const data = result?.data as any
          const images = data?.images || []

          if (images.length > 0) {
            console.log(`[vton] Fallback result worked! Images: ${images.length}`)
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
        } catch (resultErr: any) {
          console.log(`[vton] Fallback result also failed: ${resultErr.message}`)
        }

        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, status: 'IN_PROGRESS' }),
        }
      }
    }

    // ══════════════════════════════════════════════
    // ACTION: SUBMIT — Submit job via SDK
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

    console.log(`[vton] Submitting via SDK — mode: ${mode}, images: ${imageUrls.length}`)

    const { request_id } = await fal.queue.submit(FAL_MODEL, {
      input: {
        prompt,
        image_urls: imageUrls,
        resolution: resolution || '2K',
        aspect_ratio: aspectRatio || '9:16',
        num_images: 1,
        output_format: 'png',
        safety_tolerance: '6',
        limit_generations: true,
      },
    })

    console.log(`[vton] Queued via SDK — request_id: ${request_id}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        status: 'QUEUED',
        requestId: request_id,
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
