import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY env variable eksik' }) }
  }

  let imageUrl: string
  try {
    const body = JSON.parse(event.body || '{}')
    imageUrl = body.imageUrl
    if (!imageUrl) throw new Error('imageUrl gerekli')
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) }
  }

  try {
    // 1. Görseli fetch et
    console.log(`[vision] Görsel indiriliyor: ${imageUrl.slice(0, 80)}...`)
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) {
      throw new Error(`Görsel indirilemedi (${imgRes.status})`)
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const buffer = await imgRes.arrayBuffer()
    const base64 = Buffer.from(buffer).toString('base64')

    // Media type normalize
    let mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = 'image/jpeg'
    if (contentType.includes('png')) mediaType = 'image/png'
    else if (contentType.includes('webp')) mediaType = 'image/webp'
    else if (contentType.includes('gif')) mediaType = 'image/gif'

    console.log(`[vision] Görsel alındı: ${(buffer.byteLength / 1024).toFixed(0)}KB, ${mediaType}`)

    // 2. Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: `Bu ürün görselini analiz et. Türkçe yanıtla. Sadece JSON döndür, başka metin ekleme:
{
  "colors": ["Ana renk", "İkincil renk"],
  "material_guess": "Tahmin edilen kumaş tipi",
  "pattern": "Desen tipi (Düz, Çizgili, Çiçekli, Ekose, Geometrik, Puantiyeli, Hayvan Deseni, Batik, Renk Bloklu)",
  "style": "Stil (Casual, Elegant, Sporty, Bohemian, Minimalist, Vintage)",
  "details": {
    "neckline": "Yaka tipi veya null",
    "sleeve": "Kol tipi veya null",
    "length": "Boy (mini/midi/maxi/crop) veya null",
    "fit": "Kalıp (slim/regular/oversize/A-line) veya null"
  },
  "confidence": {
    "color": 0.0-1.0,
    "material": 0.0-1.0,
    "pattern": 0.0-1.0
  }
}

Renk adları Türkçe: Siyah, Beyaz, Kırmızı, Mavi, Yeşil, Pembe, Mor, Turuncu, Sarı, Kahverengi, Gri, Bej, Bordo, Lacivert, Haki, Altın, Gümüş, Pudra, Ekru.
Kumaş tahminleri: Pamuk, Polyester, Viskon, Yün, İpek, Saten, Şifon, Kadife, Deri, Suni Deri, Keten, Denim, Triko, Örme, Dantel, Tül, Akrilik.`,
          },
        ],
      }],
    })

    // 3. Parse response
    const textBlock = response.content.find((c) => c.type === 'text')
    const text = textBlock?.type === 'text' ? textBlock.text : ''

    // JSON çıkar (```json ... ``` veya direkt JSON)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('Claude Vision JSON parse edilemedi')
    }

    const visionResult = JSON.parse(jsonMatch[0])

    console.log(`[vision] Analiz tamamlandı: renk=${visionResult.colors?.join(', ')}, desen=${visionResult.pattern}`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        vision: visionResult,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      }),
    }
  } catch (err: any) {
    console.error(`[vision] Hata: ${err.message}`)
    return {
      statusCode: 200, // Frontend'de hata yönetimi için 200 döndür
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: err.message,
        vision: null,
      }),
    }
  }
}
