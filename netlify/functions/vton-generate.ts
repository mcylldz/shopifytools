import type { Handler } from '@netlify/functions'
import https from 'https'

const FAL_KEY = process.env.FAL_KEY || ''
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''

function httpsRequest(options: https.RequestOptions, payload?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: string) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode || 500, body: data }))
    })
    req.on('error', reject)
    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Request timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// ──────────────── Prompt Templates ────────────────

const PROMPTS = {
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
    `Generate a high-resolution fabric texture close-up for a Shopify product page. Use the provided product image${fabricInfo ? ` and fabric information (${fabricInfo})` : ''} to recreate the fabric with natural realism. The fabric surface should include gentle, authentic micro-folds and soft waves. The entire frame must remain fully sharp: no blur, no depth of field, no soft gradients, edge-to-edge clarity. Lighting should be neutral and evenly distributed to highlight the weave pattern, fiber detail, and the three-dimensional surface. Output should look like a premium e-commerce textile macro.`,
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ═══════════ FAL SUBMIT ═══════════
    if (action === 'fal_submit') {
      if (!FAL_KEY) throw new Error('FAL_KEY eksik')

      const payload = JSON.stringify(body.payload)
      console.log(`[vton] fal_submit, payload size: ${payload.length}`)

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: '/fal-ai/nano-banana-2/edit',
        method: 'POST',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, payload)

      console.log(`[vton] fal_submit response: ${result.status}`)
      return {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json' },
        body: result.body,
      }
    }

    // ═══════════ FAL STATUS / RESULT (GET) ═══════════
    if (action === 'fal_status') {
      if (!FAL_KEY) throw new Error('FAL_KEY eksik')
      if (!body.path) throw new Error('path gerekli')

      console.log(`[vton] fal_status GET: ${body.path}`)

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: body.path,
        method: 'GET',
        headers: {
          'Authorization': `Key ${FAL_KEY}`,
          'Content-Type': 'application/json',
        },
      })

      console.log(`[vton] fal_status response: ${result.status}, body: ${result.body.substring(0, 200)}`)
      return {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json' },
        body: result.body,
      }
    }

    // ═══════════ CLAUDE VISION ANALYZE ═══════════
    if (action === 'analyze') {
      if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY eksik')

      const { imageUrl, mode, productTitle, garmentCategory, fabricInfo } = body

      let systemPrompt = ''
      if (mode === 'model') {
        systemPrompt = `Describe this fashion model image for an AI image generator. Focus on:
1. The model's pose, gender, and visible physical traits.
2. The clothing they are currently wearing (to be replaced).
3. The lighting, background, and camera angle.
Output a concise, descriptive prompt.`
      } else {
        const fabricHint = fabricInfo ? `\n\nUSER PROVIDED FABRIC INFO: ${fabricInfo}` : ''
        systemPrompt = `Act as a technical fashion designer. Analyze this garment image to create a high-fidelity prompt description for an AI image generator.
Focus STRICTLY on: Garment Type & Fit, Fabric & Texture, Neckline & Sleeves, Design Details, Color.${fabricHint}
${mode === 'ghost' ? '\nIGNORE the human model, skin, hair, face, and hands. IGNORE the background.' : ''}
Product: ${productTitle || 'Fashion garment'}, Category: ${garmentCategory || 'top'}
OUTPUT ONLY a concise, comma-separated descriptive string.`
      }

      const payload = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: systemPrompt },
            { type: 'image', source: { type: 'url', url: imageUrl } },
          ],
        }],
      })

      const result = await httpsRequest({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      }, payload)

      if (result.status !== 200) {
        console.error(`[vton] Claude error: ${result.body.substring(0, 300)}`)
        throw new Error(`Claude API error (${result.status})`)
      }

      const data = JSON.parse(result.body)
      const description = data.content?.[0]?.text || ''

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, description }),
      }
    }

    // ═══════════ GENERATE (eski uyumluluk) ═══════════
    const { mode, modelDesc, garmentDesc, productTitle, garmentCategory, fabricInfo, imageUrls } = body
    let prompt: string

    switch (mode) {
      case 'standard':
        prompt = PROMPTS.standard(modelDesc || '', garmentDesc || '', productTitle || '', garmentCategory || 'top')
        break
      case 'ghost':
        prompt = PROMPTS.ghost(garmentDesc || '')
        break
      case 'fabric':
        prompt = PROMPTS.fabric(fabricInfo)
        break
      default:
        throw new Error(`Geçersiz mod: ${mode}`)
    }

    if (!imageUrls?.length) throw new Error('Görsel URL gerekli')

    const payload = JSON.stringify({
      prompt,
      image_urls: imageUrls,
      resolution: '2K',
      aspect_ratio: '9:16',
      num_images: 1,
      output_format: 'png',
      safety_tolerance: '6',
    })

    const result = await httpsRequest({
      hostname: 'queue.fal.run',
      path: '/fal-ai/nano-banana-2/edit',
      method: 'POST',
      headers: {
        'Authorization': `Key ${FAL_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, payload)

    if (result.status >= 400) throw new Error(`FAL error (${result.status}): ${result.body.substring(0, 200)}`)

    const data = JSON.parse(result.body)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        status: 'QUEUED',
        requestId: data.request_id,
        statusUrl: data.status_url,
        responseUrl: data.response_url,
        queuePosition: data.queue_position,
      }),
    }
  } catch (err: any) {
    console.error(`[vton] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
