import type { Handler } from '@netlify/functions'
import https from 'https'

const FAL_KEY = process.env.FAL_KEY || ''
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || ''
const GEMINI_KEY = process.env.GEMINI_API_KEY || ''

// ═══════════ FAL Models ═══════════
const FAL_MODELS: Record<string, string> = {
  'nano-banana-2': '/fal-ai/nano-banana-2/edit',
  'nano-banana-pro': '/fal-ai/nano-banana-pro/edit',
  'nano-banana': '/fal-ai/nano-banana/edit',
}

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

      const modelKey = body.model || 'nano-banana-2'
      const modelPath = FAL_MODELS[modelKey]
      if (!modelPath) throw new Error(`Geçersiz FAL model: ${modelKey}`)

      const payload = JSON.stringify(body.payload)
      console.log(`[vton] fal_submit model=${modelKey} path=${modelPath}`)

      const result = await httpsRequest({
        hostname: 'queue.fal.run',
        path: modelPath,
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

      return {
        statusCode: result.status,
        headers: { 'Content-Type': 'application/json' },
        body: result.body,
      }
    }

    // ═══════════ GEMINI GENERATE (direct) ═══════════
    if (action === 'gemini_generate') {
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')

      const { prompt, imageUrls, geminiModel } = body
      const model = geminiModel || 'gemini-2.0-flash-exp'

      // Build parts: text prompt + image URLs
      const parts: any[] = [{ text: prompt }]

      // Fetch images and convert to inline data
      for (const imgUrl of (imageUrls || [])) {
        try {
          const imgRes = await fetch(imgUrl)
          if (!imgRes.ok) continue
          const buffer = await imgRes.arrayBuffer()
          const base64 = Buffer.from(buffer).toString('base64')
          const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
          parts.push({
            inline_data: { mime_type: mimeType, data: base64 }
          })
        } catch (e) {
          console.warn(`[vton] Image fetch failed: ${imgUrl}`)
        }
      }

      const geminiPayload = JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 1,
        },
      })

      const geminiPath = `/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`

      const result = await httpsRequest({
        hostname: 'generativelanguage.googleapis.com',
        path: geminiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(geminiPayload),
        },
      }, geminiPayload)

      if (result.status !== 200) {
        console.error(`[vton] Gemini error: ${result.body.substring(0, 300)}`)
        throw new Error(`Gemini API error (${result.status}): ${result.body.substring(0, 200)}`)
      }

      // Parse response — Gemini returns images as inline_data or inlineData
      const geminiData = JSON.parse(result.body)
      const candidates = geminiData.candidates || []
      const responseParts = candidates[0]?.content?.parts || []

      console.log(`[vton] Gemini parts count: ${responseParts.length}`)
      for (let i = 0; i < responseParts.length; i++) {
        const keys = Object.keys(responseParts[i])
        console.log(`[vton] Part ${i} keys: ${keys.join(', ')}`)
      }

      // Find image part — check both camelCase and snake_case
      const imagePart = responseParts.find((p: any) => p.inline_data || p.inlineData)
      if (imagePart) {
        const imgData = imagePart.inline_data || imagePart.inlineData
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            imageBase64: imgData.data,
            mimeType: imgData.mime_type || imgData.mimeType || 'image/png',
          }),
        }
      }

      // Maybe file_data or fileData format
      const filePart = responseParts.find((p: any) => p.file_data || p.fileData)
      if (filePart) {
        const fd = filePart.file_data || filePart.fileData
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            fileUri: fd.file_uri || fd.fileUri,
            mimeType: fd.mime_type || fd.mimeType || 'image/png',
          }),
        }
      }

      // No image found
      const textPart = responseParts.find((p: any) => p.text)
      const fullBody = JSON.stringify(responseParts).substring(0, 500)
      console.error(`[vton] Gemini no image found. Parts dump: ${fullBody}`)
      throw new Error(`Gemini görsel üretemedi. Text: ${textPart?.text?.substring(0, 100) || 'yok'}. Raw: ${fullBody}`)
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

    return { statusCode: 400, body: JSON.stringify({ error: `Geçersiz action: ${action}` }) }

  } catch (err: any) {
    console.error(`[vton] Error: ${err.message}`)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
