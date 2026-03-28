import type { Handler } from '@netlify/functions'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' })

const SYSTEM_PROMPT = `Sen, Türk kadın moda e-ticareti konusunda uzmanlaşmış bir ürün veri mühendisisin.
Görevin, Shopify mağazasındaki ürünlerin Google Merchant Center ve Meta (Facebook/Instagram)
Catalog için gerekli tüm alt alanlarını doldurmaktır.

Mağaza: Svelte Chic (thesveltechic.com)
Sektör: Kadın giyim ve aksesuar
Pazar: Türkiye (birincil), uluslararası
Para birimi: TRY
Dil: Türkçe

KURALLAR:

1. BAŞLIK (title): Max 80 karakter, Türkçe, kısa ve öz.
   - Format: [Ana Ürün Adı] + [Öne Çıkan 1-2 Özellik] + [Renk]
   - Sonuna marka adı EKLEME ("— Svelte Chic" yazma! brand alanı zaten ayrıca dolu)
   - İngilizce terim kullanma: "Cami" → "Askılı", "Top" → "Üst", "Crop" → "Kısa Kesim"
   - Gereksiz sıfatları çıkar, tekrar etme
   - Örnek: ✅ "İnci Askılı Uzun Elbise Beyaz Arkası Açık" (42 kar.)
   - Örnek: ❌ "İnci Anahtar Deliği Yaka Cami Uzun Elbise Beyaz Arkasız Maxi — Svelte Chic" (çok uzun!)

2. AÇIKLAMA (description): Max 5000 karakter, Türkçe, ilk 160 karakterde en önemli bilgi (Google snippet), kumaş/kalıp/özellik/kombinleme önerileri

3. KISA AÇIKLAMA (short_description — Meta): Max 500 karakter, dikkat çekici, CTA içermeli

4. GOOGLE KATEGORİ: Sayısal Google Taksonomi ID'si (Elbiseler→2271, Bluzlar/Üstler→212, Etekler→3455, Pantolonlar→204, Ceketler→3066, Hırkalar→212, Atkı/Şal→179, Kolye→196, Yüzük→200, Küpe→194, Bileklik→191, Çanta→6551, Abiye→2271, Tulum→5322, Takım→203)

5. ÜRÜN TİPİ: Türkçe hiyerarşi, "Giyim > Elbiseler > Maxi Elbiseler" formatı

6. RENK: Türkçe, max 3 renk "/" ile (Siyah, Beyaz, Kırmızı, Mavi, Yeşil, Pembe, Mor, Turuncu, Sarı, Kahverengi, Gri, Bej, Bordo, Lacivert, Haki, Altın, Gümüş, Pudra, Ekru)

7. MATERYAL: Türkçe (Pamuk, Polyester, Viskon, Yün, İpek, Saten, Şifon, Kadife, Deri, Suni Deri, Keten, Denim, Triko, Örme, Dantel, Tül, Akrilik)

8. DESEN: Türkçe (Düz, Çizgili, Ekose, Çiçekli, Puantiyeli, Geometrik, Hayvan Deseni, Kamuflaj, Paisley, Batik, Renk Bloklu)

9. CUSTOM LABELS:
   - custom_label_0 (Sezon): winter→"Kış 2025", spring→"İlkbahar 2026", summer→"Yaz 2026", fall→"Sonbahar 2025"
   - custom_label_1 (Fiyat): 0-500→"Budget", 501-1500→"Mid-Range", 1501-3000→"Premium", 3001+→"Luxury"
   - custom_label_2 (Koleksiyon): tag/collection'dan "Yeni Gelenler", "Trend", "Klasik"
   - custom_label_3 (Performans): "Regular"
   - custom_label_4 (Marj): compare_at_price varsa marj>%60→"High Margin", %40-60→"Standard", <%40→"Low Margin"

10. MPN: Öncelik SKU, boşsa "{product_id}_{variant_id}"

11. BODY_HTML: 200 karakterden uzunsa EZMEYİN, SEO iyileştirme yapın. Kısaysa/boşsa sıfırdan oluşturun.

12. GÜVEN SKORU: Her alan için 0-1, güven<0.6 varsa needs_review=true

13. PRODUCT HIGHLIGHT: Max 10 madde, her biri max 150 karakter

GÖRSEL ANALİZ varsa renk/materyal/desen tespitlerinde görsel verisini metin verisinin ÜZERİNE yaz. Güven skoru düşük vision tespitlerini göz ardı et.

RESPONSE FORMAT: Her ürün için JSON döndür, hiçbir alanı boş bırakma. Array olarak döndür.

[
  {
    "product_id": "gid://shopify/Product/123",
    "google": {
      "title": "...",
      "description": "...",
      "google_product_category": 2271,
      "product_type": "Giyim > Elbiseler > Maxi Elbiseler",
      "condition": "new",
      "brand": "Svelte Chic",
      "identifier_exists": false,
      "gender": "female",
      "age_group": "adult",
      "color": "Siyah",
      "size": "S",
      "material": "Polyester",
      "pattern": "Düz",
      "size_system": "TR",
      "size_type": "regular",
      "item_group_id": "123",
      "mpn": "SKU_VALUE",
      "shipping_weight": "250 g",
      "custom_label_0": "Kış 2025",
      "custom_label_1": "Premium",
      "custom_label_2": "Yeni Gelenler",
      "custom_label_3": "Regular",
      "custom_label_4": "High Margin",
      "product_highlight": ["Özellik 1", "Özellik 2", "Özellik 3"]
    },
    "meta": {
      "short_description": "...",
      "rich_text_description": "...",
      "fb_product_category": "...",
      "additional_variant_attribute": "Kumaş: Pamuk, Kalıp: Regular Fit",
      "inventory": "Sınırlı stok",
      "return_policy_days": "15",
      "custom_label_0": "Kış 2025",
      "custom_label_1": "Premium",
      "custom_label_2": "Yeni Gelenler",
      "custom_label_3": "Regular",
      "custom_label_4": "High Margin"
    },
    "confidence": {
      "google_product_category": 0.95,
      "material": 0.7,
      "pattern": 0.85,
      "color": 0.9
    },
    "needs_review": false
  }
]`

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY env variable eksik' }) }
  }

  let products: any[]
  let mode: string
  try {
    const body = JSON.parse(event.body || '{}')
    products = body.products || []
    mode = body.mode || 'fill_empty' // fill_empty | overwrite | dry_run
    if (!products.length) throw new Error('Ürün verisi gerekli')
    if (products.length > 3) throw new Error('Max 3 ürün/batch')
  } catch (e: any) {
    return { statusCode: 400, body: JSON.stringify({ error: e.message }) }
  }

  try {
    // User prompt oluştur
    const userPrompt = `Aşağıdaki ${products.length} ürünü zenginleştir. Her ürün için tüm Google Shopping ve Meta Catalog alanlarını doldur. JSON array formatında döndür.

ÜRÜNLER:

${JSON.stringify(products, null, 2)}

ÖNEMLI: Her ürün için eksiksiz JSON döndür. Hiçbir alanı atlama. Sadece JSON döndür, başka metin ekleme.`

    console.log(`[enrich] ${products.length} ürün işleniyor, mode=${mode}`)

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    // Parse response
    const textBlock = response.content.find((c) => c.type === 'text')
    const text = textBlock?.type === 'text' ? textBlock.text : ''

    // JSON array çıkar
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('Claude response JSON parse edilemedi')
    }

    const results = JSON.parse(jsonMatch[0])

    // Validasyon
    const validated = results.map((r: any) => ({
      ...r,
      validation: validateResult(r),
    }))

    console.log(`[enrich] ${validated.length} ürün sonucu alındı`)

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        results: validated,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      }),
    }
  } catch (err: any) {
    console.error(`[enrich] Hata: ${err.message}`)
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    }
  }
}

// Validasyon
function validateResult(r: any): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const g = r.google || {}
  const m = r.meta || {}

  if (!g.title || g.title.length > 150) errors.push('google.title: eksik veya >150 karakter')
  if (!g.description || g.description.length > 5000) errors.push('google.description: eksik veya >5000')
  if (!Number.isInteger(g.google_product_category) || g.google_product_category <= 0)
    errors.push('google.google_product_category: geçersiz')
  if (!['new', 'refurbished', 'used'].includes(g.condition))
    errors.push('google.condition: geçersiz')
  if (!g.color) errors.push('google.color: eksik')
  if (!g.material) errors.push('google.material: eksik')
  if (!g.mpn) errors.push('google.mpn: eksik')
  if (!m.short_description || m.short_description.length > 500)
    errors.push('meta.short_description: eksik veya >500')

  return { valid: errors.length === 0, errors }
}
