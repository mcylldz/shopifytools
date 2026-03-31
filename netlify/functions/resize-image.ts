import https from 'https'

const GEMINI_KEY = process.env.GEMINI_API_KEY || ''

function httpsRequest(options: https.RequestOptions, postData?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks).toString() }))
    })
    req.on('error', reject)
    if (postData) req.write(postData)
    req.end()
  })
}

export const handler = async (event: any) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  try {
    if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY eksik')

    const body = JSON.parse(event.body || '{}')
    const { imageUrl, imageBase64, aspectRatio, geminiModel } = body

    if (!imageUrl && !imageBase64) throw new Error('imageUrl veya imageBase64 gerekli')
    if (!aspectRatio) throw new Error('aspectRatio gerekli')

    const model = geminiModel || 'gemini-3.1-flash-image-preview'

    // Build parts
    const parts: any[] = [
      { text: `Resize this image to ${aspectRatio} aspect ratio. Extend the background naturally using AI outpainting. Keep the subject (garment, model, product) EXACTLY the same — do not modify, crop, or distort. Only extend or adjust the canvas/background to fit the new aspect ratio. Maintain the same lighting, style, and quality.` }
    ]

    // Image part
    if (imageBase64) {
      const match = imageBase64.match(/^data:(image\/\w+);base64,(.+)$/)
      if (match) {
        parts.push({ inline_data: { mime_type: match[1], data: match[2] } })
      } else {
        parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } })
      }
    } else {
      // Fetch image and convert to base64
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`Görsel indirilemedi: ${imgRes.status}`)
      const buffer = await imgRes.arrayBuffer()
      const base64 = Buffer.from(buffer).toString('base64')
      const mimeType = imgRes.headers.get('content-type') || 'image/jpeg'
      parts.push({ inline_data: { mime_type: mimeType, data: base64 } })
    }

    const payload = JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        temperature: 0.4,
        aspectRatio,
      },
    })

    const path = `/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`
    const result = await httpsRequest({
      hostname: 'generativelanguage.googleapis.com',
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, payload)

    if (result.status !== 200) {
      console.error(`[resize] Gemini error: ${result.body.substring(0, 300)}`)
      throw new Error(`Gemini API error (${result.status})`)
    }

    const parsed = JSON.parse(result.body)
    const candidates = parsed.candidates || []
    const responseParts = candidates[0]?.content?.parts || []
    const imagePart = responseParts.find((p: any) => p.inline_data || p.inlineData)

    if (!imagePart) throw new Error('Gemini görsel üretemedi')

    const imgData = imagePart.inline_data || imagePart.inlineData
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        imageBase64: imgData.data,
        mimeType: imgData.mime_type || imgData.mimeType || 'image/png',
      }),
    }
  } catch (err: any) {
    console.error('[resize] Error:', err.message)
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, error: err.message }) }
  }
}
