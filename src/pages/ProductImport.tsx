import { useState, useRef } from 'react'
import type { ToastData } from '../components/Toast'

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

interface ScrapedProduct {
  source: 'shopify' | '1688'
  title: string
  description: string
  images: string[]
  sizes: string[]
  colors: string[]
  price: { amount: number; currency: string }
  priceTRY: number
  variants: { title: string; size?: string; color?: string; price: number; sku?: string }[]
  vendor?: string
  productType?: string
  tags?: string
  handle?: string
}

interface ImageItem {
  url: string
  selected: boolean
  order: number
}

const STEPS = [
  { id: 1, icon: '🔗', label: 'URL & Scrape' },
  { id: 2, icon: '🤖', label: 'AI Enrichment' },
  { id: 3, icon: '🖼️', label: 'Görseller' },
  { id: 4, icon: '💰', label: 'Fiyatlandırma' },
  { id: 5, icon: '🏷️', label: 'Etiketler' },
  { id: 6, icon: '🔗', label: 'Handle' },
  { id: 7, icon: '✅', label: 'Son Kontrol' },
]

function roundTo100(n: number): number {
  return Math.round(n / 100) * 100
}

function slugify(text: string): string {
  const tr: Record<string, string> = {
    ş: 's', Ş: 'S', ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G',
    ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ı: 'i', İ: 'I',
  }
  return text
    .replace(/[şŞçÇğĞüÜöÖıİ]/g, (c) => tr[c] || c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function ProductImport({ addToast }: Props) {
  const [step, setStep] = useState(1)

  // Step 1
  const [url, setUrl] = useState('')
  const [html1688, setHtml1688] = useState('')
  const [scraping, setScraping] = useState(false)
  const [product, setProduct] = useState<ScrapedProduct | null>(null)
  const [needs1688Html, setNeeds1688Html] = useState(false)

  // Step 2
  const [enrichment, setEnrichment] = useState<any>(null)
  const [enriching, setEnriching] = useState(false)
  const [enrichedTitle, setEnrichedTitle] = useState('')
  const [enrichedDesc, setEnrichedDesc] = useState('')

  // Step 3
  const [images, setImages] = useState<ImageItem[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // Step 4
  const [sellingPrice, setSellingPrice] = useState(0)
  const [comparePrice, setComparePrice] = useState(0)
  const [discountPct, setDiscountPct] = useState(0)

  // Step 5
  const [tags, setTags] = useState('')

  // Step 6
  const [handle, setHandle] = useState('')

  // Step 7
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<any>(null)

  // ─── Step 1: Scrape ───
  const handleScrape = async () => {
    if (!url && !html1688) return
    setScraping(true)
    setProduct(null)
    setNeeds1688Html(false)

    try {
      const body: any = {}
      if (url) body.url = url
      if (html1688) body.html = html1688

      const res = await fetch('/api/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.needsHtml) {
        setNeeds1688Html(true)
        addToast({ type: 'info', message: '1688 için HTML kaynağı yapıştırın' })
        return
      }

      if (!data.success) throw new Error(data.error)

      setProduct(data.product)
      // Görselleri hazırla
      setImages(data.product.images.map((url: string, i: number) => ({
        url, selected: true, order: i,
      })))
      // Fiyat hesapla
      calculatePrice(data.product)
      // Handle oluştur
      setHandle(slugify(data.product.title))
      // Tags
      setTags(data.product.tags || '')
      addToast({ type: 'success', message: `${data.product.source === 'shopify' ? 'Shopify' : '1688'} ürünü çekildi!` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setScraping(false)
    }
  }

  const calculatePrice = (p: ScrapedProduct) => {
    let baseTRY = p.priceTRY
    if (p.source === 'shopify') {
      // USD: amount × 45 × 3 → en yakın 100
      baseTRY = p.price.amount * 45
    }
    const selling = roundTo100(baseTRY * 3)
    setSellingPrice(selling)

    // Random indirim: %40, %50, %60
    const discounts = [0.4, 0.5, 0.6]
    const disc = discounts[Math.floor(Math.random() * discounts.length)]
    setDiscountPct(Math.round(disc * 100))
    // compareAt = selling / (1 - disc) → yani selling, compareAt'ın disc% indirimi
    const compare = roundTo100(selling / (1 - disc))
    setComparePrice(compare)
  }

  // ─── Step 2: Enrichment ───
  const handleEnrich = async () => {
    if (!product) return
    setEnriching(true)

    try {
      // Vision
      let visionData: any = null
      if (product.images[0]) {
        const vRes = await fetch('/api/vision-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: product.images[0] }),
        })
        const vData = await vRes.json()
        if (vData.success) visionData = vData.vision
      }

      // Enrich
      const eRes = await fetch('/api/enrich-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: [{
            product_id: 'import_new',
            title: product.title,
            body_html: product.description,
            tags: product.tags || '',
            vendor: product.vendor || '',
            product_type: product.productType || '',
            images: product.images.slice(0, 3),
            variants: product.variants.map((v) => ({
              id: 'new',
              title: v.title,
              sku: v.sku || '',
              price: String(sellingPrice),
              option1: v.size || v.title,
            })),
            ...(visionData && { vision_analysis: visionData }),
          }],
          mode: 'overwrite',
        }),
      })
      const eData = await eRes.json()
      if (!eData.success) throw new Error(eData.error)

      const result = eData.results?.[0]
      setEnrichment(result)
      setEnrichedTitle(result?.google?.title || product.title)
      setEnrichedDesc(result?.google?.description || product.description)
      addToast({ type: 'success', message: 'AI enrichment tamamlandı!' })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setEnriching(false)
    }
  }

  // ─── Step 3: Image helpers ───
  const toggleImage = (idx: number) => {
    setImages((prev) => prev.map((img, i) =>
      i === idx ? { ...img, selected: !img.selected } : img
    ))
  }

  const moveImage = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= images.length) return
    setImages((prev) => {
      const arr = [...prev]
      ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
      return arr.map((img, i) => ({ ...img, order: i }))
    })
  }

  const addImageUrl = () => {
    const url = prompt('Görsel URL girin:')
    if (url) setImages((prev) => [...prev, { url, selected: true, order: prev.length }])
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        setImages((prev) => [...prev, { url: dataUrl, selected: true, order: prev.length }])
      }
      reader.readAsDataURL(file)
    }
  }

  // ─── Step 7: Push to Shopify ───
  const handlePush = async () => {
    if (!product) return
    setPushing(true)
    setPushResult(null)

    try {
      const selectedImages = images.filter((i) => i.selected).sort((a, b) => a.order - b.order)

      const res = await fetch('/api/create-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: enrichedTitle || product.title,
          descriptionHtml: enrichedDesc || product.description,
          handle,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          images: selectedImages.map((i) => i.url).filter((u) => u.startsWith('http')),
          variants: product.sizes.length > 0
            ? product.sizes.map((s) => ({
                size: s,
                price: String(sellingPrice),
                compareAtPrice: String(comparePrice),
              }))
            : [{ price: String(sellingPrice), compareAtPrice: String(comparePrice) }],
          vendor: product.vendor || 'Svelte Chic',
          productType: product.productType || '',
        }),
      })
      const data = await res.json()

      if (!data.success) {
        const errMsg = data.errors?.map((e: any) => `${e.field}: ${e.message}`).join(', ')
        throw new Error(errMsg || 'Ürün oluşturulamadı')
      }

      setPushResult(data.product)
      addToast({ type: 'success', message: `✅ Ürün oluşturuldu: ${data.product.title}` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setPushing(false)
    }
  }

  const goTo = (s: number) => setStep(s)
  const next = () => setStep((s) => Math.min(s + 1, 7))
  const prev = () => setStep((s) => Math.max(s - 1, 1))

  // ─── Render ───
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">📦 Ürün Import</h1>
        <p className="page-desc">1688 veya Shopify mağazasından ürün çekip mağazanıza ekler</p>
      </div>

      <div className="page-body">
        {/* Stepper */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, overflowX: 'auto' }}>
          {STEPS.map((s) => (
            <button
              key={s.id}
              onClick={() => product && goTo(s.id)}
              style={{
                flex: 1,
                padding: '10px 8px',
                border: 'none',
                borderRadius: 8,
                background: step === s.id ? 'var(--primary)' : s.id < step ? 'var(--success)' : 'var(--bg-card)',
                color: step === s.id || s.id < step ? '#fff' : 'var(--text-muted)',
                fontSize: 12,
                fontWeight: step === s.id ? 700 : 400,
                cursor: product ? 'pointer' : 'default',
                transition: 'all .2s',
                whiteSpace: 'nowrap',
              }}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* ─── Step 1: URL & Scrape ─── */}
        {step === 1 && (
          <div className="card">
            <div className="card-title">🔗 Ürün Bağlantısı</div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Ürün URL'si</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="form-input"
                  placeholder="https://store.com/products/... veya https://detail.1688.com/..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn btn-primary" onClick={handleScrape} disabled={scraping || (!url && !html1688)}>
                  {scraping ? <><span className="spinner" /> Çekiliyor...</> : '🔍 Çek'}
                </button>
              </div>
            </div>

            {needs1688Html && (
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">1688 Sayfa HTML'i (sağ tık → Sayfa kaynağını görüntüle)</label>
                <textarea
                  className="form-input"
                  rows={6}
                  placeholder="HTML kaynağını buraya yapıştırın..."
                  value={html1688}
                  onChange={(e) => setHtml1688(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                />
                <button className="btn btn-primary" onClick={handleScrape} disabled={scraping || !html1688}
                  style={{ marginTop: 8 }}>
                  {scraping ? <><span className="spinner" /> Parse ediliyor...</> : '📋 Parse Et'}
                </button>
              </div>
            )}

            {product && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                  {product.images[0] && (
                    <img src={product.images[0]} alt="" style={{ width: 120, height: 160, objectFit: 'cover', borderRadius: 8 }} />
                  )}
                  <div>
                    <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{product.title}</h3>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 4px' }}>
                      Kaynak: <strong>{product.source === 'shopify' ? 'Shopify' : '1688'}</strong>
                    </p>
                    <p style={{ fontSize: 13, margin: '0 0 4px' }}>
                      Fiyat: <strong>
                        {product.price.amount} {product.price.currency}
                        {product.price.currency !== 'TRY' && ` → ₺${product.priceTRY}`}
                      </strong>
                    </p>
                    <p style={{ fontSize: 13, margin: '0 0 4px' }}>
                      Bedenler: <strong>{product.sizes.join(', ') || 'Tek beden'}</strong>
                    </p>
                    <p style={{ fontSize: 13, margin: 0 }}>
                      Görseller: <strong>{product.images.length}</strong>
                    </p>
                  </div>
                </div>

                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={next}>
                  Devam → AI Enrichment
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 2: Enrichment ─── */}
        {step === 2 && product && (
          <div className="card">
            <div className="card-title">🤖 AI Enrichment</div>

            {!enrichment ? (
              <div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                  Claude AI ile ürün detayları oluşturulacak (başlık, açıklama, meta veriler).
                </p>
                <button className="btn btn-primary" onClick={handleEnrich} disabled={enriching}>
                  {enriching ? <><span className="spinner" /> Enrichment yapılıyor...</> : '🧠 Enrichment Başlat'}
                </button>
              </div>
            ) : (
              <div>
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Önerilen Başlık</label>
                  <input className="form-input" value={enrichedTitle}
                    onChange={(e) => setEnrichedTitle(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Önerilen Açıklama</label>
                  <textarea className="form-input" rows={6} value={enrichedDesc}
                    onChange={(e) => setEnrichedDesc(e.target.value)} />
                </div>

                {enrichment.google && (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Google Shopping Verileri</div>
                    <div style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {Object.entries(enrichment.google).slice(0, 12).map(([k, v]) => (
                        <div key={k}><span style={{ color: 'var(--text-muted)' }}>{k}:</span> {String(v).slice(0, 50)}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={prev}>← Geri</button>
                  <button className="btn btn-primary" onClick={next}>Devam → Görseller</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 3: Görseller ─── */}
        {step === 3 && product && (
          <div className="card">
            <div className="card-title">🖼️ Görsel Yönetimi</div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
              Görselleri sıralayın, istemediğinizi kaldırın, yeni ekleyin. Seçili görseller Shopify'a gönderilir.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              {images.map((img, idx) => (
                <div key={idx} style={{
                  border: img.selected ? '2px solid var(--primary)' : '2px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', opacity: img.selected ? 1 : 0.4,
                  position: 'relative', transition: 'all .2s',
                }}>
                  <img src={img.url} alt="" style={{ width: '100%', height: 180, objectFit: 'cover' }} />
                  <div style={{ padding: 6, display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" onClick={() => moveImage(idx, -1)} title="Yukarı">↑</button>
                    <button className="btn btn-sm" onClick={() => moveImage(idx, 1)} title="Aşağı">↓</button>
                    <button className="btn btn-sm" onClick={() => toggleImage(idx)}
                      style={{ background: img.selected ? 'var(--danger)' : 'var(--success)', color: '#fff' }}>
                      {img.selected ? '✕' : '✓'}
                    </button>
                    <a href={img.url} target="_blank" rel="noreferrer" className="btn btn-sm" title="İndir">⬇</a>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 10, padding: '0 4px 4px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                    #{idx + 1}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn" onClick={addImageUrl}>🔗 URL ile Ekle</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>📁 Dosya Yükle</button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleFileUpload} />
            </div>

            {/* Download URLs */}
            <details style={{ marginBottom: 16 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-muted)' }}>📋 Görsel URL'leri</summary>
              <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 8, marginTop: 8, fontSize: 11, fontFamily: 'monospace' }}>
                {images.filter((i) => i.selected).map((img, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    <a href={img.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', wordBreak: 'break-all' }}>
                      {img.url.slice(0, 100)}...
                    </a>
                  </div>
                ))}
              </div>
            </details>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Fiyatlandırma</button>
            </div>
          </div>
        )}

        {/* ─── Step 4: Fiyatlandırma ─── */}
        {step === 4 && product && (
          <div className="card">
            <div className="card-title">💰 Fiyatlandırma</div>

            <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Kaynak Fiyat</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {product.price.amount} {product.price.currency}
                {product.price.currency !== 'TRY' && (
                  <span style={{ fontSize: 14, color: 'var(--text-muted)' }}> → ₺{product.priceTRY}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Hesaplama: {product.price.amount} × {product.price.currency === 'USD' ? '45' : '7'} × 3 → en yakın 100'e yuvarla
              </div>
            </div>

            <div className="form-row" style={{ marginBottom: 16 }}>
              <div className="form-group">
                <label className="form-label">Satış Fiyatı (₺)</label>
                <input className="form-input" type="number" step={100} value={sellingPrice}
                  onChange={(e) => setSellingPrice(Number(e.target.value))}
                  style={{ fontSize: 20, fontWeight: 700 }} />
              </div>
              <div className="form-group">
                <label className="form-label">Karşılaştırma Fiyatı (₺) — %{discountPct} indirim görüntüsü</label>
                <input className="form-input" type="number" step={100} value={comparePrice}
                  onChange={(e) => setComparePrice(Number(e.target.value))}
                  style={{ fontSize: 20, fontWeight: 700, textDecoration: 'line-through', color: 'var(--text-muted)' }} />
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 16, textAlign: 'center' }}>
              <span style={{ fontSize: 24, fontWeight: 700, textDecoration: 'line-through', color: 'var(--text-muted)', marginRight: 12 }}>
                ₺{comparePrice}
              </span>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--danger)' }}>₺{sellingPrice}</span>
              {comparePrice > 0 && (
                <span style={{ fontSize: 14, color: 'var(--success)', marginLeft: 8 }}>
                  %{Math.round((1 - sellingPrice / comparePrice) * 100)} indirim
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Etiketler</button>
            </div>
          </div>
        )}

        {/* ─── Step 5: Tags ─── */}
        {step === 5 && (
          <div className="card">
            <div className="card-title">🏷️ Etiketler</div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Etiketler (virgülle ayırın)</label>
              <textarea className="form-input" rows={3} value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="elbise, siyah, kadın, yaz" />
            </div>
            {tags && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                  <span key={t} className="tag-chip">{t}</span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Handle</button>
            </div>
          </div>
        )}

        {/* ─── Step 6: Handle ─── */}
        {step === 6 && (
          <div className="card">
            <div className="card-title">🔗 URL Handle</div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Ürün Handle (URL slug)</label>
              <input className="form-input" value={handle}
                onChange={(e) => setHandle(e.target.value)} />
              <span className="form-hint">Mağaza URL'si: sveltechic.com/products/{handle}</span>
            </div>
            <button className="btn btn-sm" style={{ marginBottom: 16 }}
              onClick={() => setHandle(slugify(enrichedTitle || product?.title || ''))}>
              🔄 Otomatik Oluştur
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Son Kontrol</button>
            </div>
          </div>
        )}

        {/* ─── Step 7: Final Review ─── */}
        {step === 7 && product && (
          <div className="card">
            <div className="card-title">✅ Son Kontrol</div>

            <div style={{ display: 'grid', gap: 12, marginBottom: 20 }}>
              {/* Summary rows */}
              {[
                { label: '📝 Başlık', value: enrichedTitle || product.title, step: 2 },
                { label: '🖼️ Görseller', value: `${images.filter((i) => i.selected).length} adet seçili`, step: 3 },
                { label: '💰 Satış Fiyatı', value: `₺${sellingPrice}`, step: 4 },
                { label: '💰 Karşılaştırma', value: `₺${comparePrice}`, step: 4 },
                { label: '🏷️ Etiketler', value: tags || '(boş)', step: 5 },
                { label: '🔗 Handle', value: handle, step: 6 },
                { label: '📏 Bedenler', value: product.sizes.join(', ') || 'Tek beden', step: 1 },
              ].map((row) => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8,
                }}>
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.label}</span>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{row.value}</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => goTo(row.step)}>Düzenle</button>
                </div>
              ))}
            </div>

            {/* Preview images */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginBottom: 20, paddingBottom: 8 }}>
              {images.filter((i) => i.selected).sort((a, b) => a.order - b.order).map((img, i) => (
                <img key={i} src={img.url} alt="" style={{ width: 80, height: 100, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
              ))}
            </div>

            {pushResult ? (
              <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Ürün Oluşturuldu!</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {pushResult.title} — {pushResult.status}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  ID: {pushResult.id}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={prev}>← Geri</button>
                <button className="btn btn-primary" onClick={handlePush} disabled={pushing}
                  style={{ flex: 1, fontSize: 16, padding: '14px 20px' }}>
                  {pushing ? <><span className="spinner" /> Shopify'a gönderiliyor...</> : '🚀 Shopify\'a Gönder'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
