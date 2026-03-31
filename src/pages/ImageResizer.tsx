import { useState } from 'react'
import type { ToastData } from '../components/Toast'

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

interface ResizeResult {
  id: string
  originalUrl: string
  resultUrl: string // data URL
  aspectRatio: string
  status: 'pending' | 'processing' | 'done' | 'error'
  progress: string
  error?: string
}

const ASPECT_RATIOS = [
  { value: '1:1', label: '1:1', desc: 'Kare', icon: '⬜' },
  { value: '3:4', label: '3:4', desc: 'Portre', icon: '📱' },
  { value: '4:3', label: '4:3', desc: 'Yatay', icon: '🖥️' },
  { value: '9:16', label: '9:16', desc: 'Story/Reels', icon: '📲' },
  { value: '16:9', label: '16:9', desc: 'Banner', icon: '🖼️' },
]

const GEMINI_MODELS = [
  { value: 'gemini-3.1-flash-image-preview', label: '🔵 Gemini 3.1 Flash Image' },
  { value: 'gemini-3-pro-image-preview', label: '🔵 Gemini 3 Pro Image' },
  { value: 'gemini-2.5-flash-image', label: '🔵 Gemini 2.5 Flash Image' },
]

export default function ImageResizer({ addToast }: Props) {
  const [productUrl, setProductUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState<string[]>([])
  const [productTitle, setProductTitle] = useState('')
  const [selectedImages, setSelectedImages] = useState<Set<number>>(new Set())
  const [targetRatio, setTargetRatio] = useState('3:4')
  const [geminiModel, setGeminiModel] = useState('gemini-3.1-flash-image-preview')
  const [results, setResults] = useState<ResizeResult[]>([])
  const [processing, setProcessing] = useState(false)

  // Push state
  const [pushingId, setPushingId] = useState<string | null>(null)
  const [pushProductUrl, setPushProductUrl] = useState('')
  const [pushMode, setPushMode] = useState<'replace' | 'add'>('replace')
  const [pushPosition, setPushPosition] = useState('1')
  const [pushLoading, setPushLoading] = useState(false)

  // ── Fetch images ──
  const fetchImages = async () => {
    if (!productUrl) return
    setLoading(true)
    try {
      const res = await fetch('/api/fetch-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl }),
      })
      const data = await res.json()
      if (data.needsHtml) { addToast({ type: 'info', message: '1688 desteklenmiyor, Shopify URL kullanın' }); return }
      if (!data.success) throw new Error(data.error)
      const imgs = data.product.images || []
      setImages(imgs)
      setProductTitle(data.product.title || '')
      setSelectedImages(new Set(imgs.map((_: string, i: number) => i)))
      addToast({ type: 'success', message: `${imgs.length} görsel çekildi` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally { setLoading(false) }
  }

  // ── Resize all selected ──
  const startResize = async () => {
    const selected = images.filter((_, i) => selectedImages.has(i))
    if (selected.length === 0) { addToast({ type: 'error', message: 'En az 1 görsel seçin' }); return }

    setProcessing(true)
    const newResults: ResizeResult[] = selected.map((url, i) => ({
      id: `r_${Date.now()}_${i}`,
      originalUrl: url,
      resultUrl: '',
      aspectRatio: targetRatio,
      status: 'pending' as const,
      progress: 'Bekliyor...',
    }))
    setResults(newResults)

    // Process sequentially
    for (let i = 0; i < newResults.length; i++) {
      const r = newResults[i]
      setResults(prev => prev.map(p => p.id === r.id ? { ...p, status: 'processing', progress: `🔄 ${i + 1}/${newResults.length} işleniyor...` } : p))

      try {
        const res = await fetch('/api/resize-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: r.originalUrl,
            aspectRatio: targetRatio,
            geminiModel,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error)

        const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`
        setResults(prev => prev.map(p => p.id === r.id ? { ...p, status: 'done', progress: '✅ Tamamlandı', resultUrl: dataUrl } : p))
      } catch (err: any) {
        setResults(prev => prev.map(p => p.id === r.id ? { ...p, status: 'error', progress: '❌ Hata', error: err.message } : p))
      }
    }
    setProcessing(false)
    addToast({ type: 'success', message: `${newResults.length} görsel resize edildi` })
  }

  // ── Push to Shopify ──
  const pushToShopify = async (result: ResizeResult) => {
    setPushLoading(true)
    try {
      const urlMatch = pushProductUrl.match(/products\/(\d+)/)
      const handleMatch = pushProductUrl.match(/products\/([a-z0-9-]+)/)
      const productId = urlMatch ? urlMatch[1] : handleMatch ? handleMatch[1] : null
      if (!productId) {
        addToast({ type: 'error', message: 'Admin URL kullanın' })
        setPushLoading(false); return
      }

      const payload: any = { productId, position: parseInt(pushPosition) || 1, pushMode }
      payload.imageBase64 = result.resultUrl

      const res = await fetch('/api/push-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      addToast({ type: 'success', message: pushMode === 'replace'
        ? `Görsel ${data.image.position}. sıradaki ile değiştirildi!`
        : `Görsel ${data.image.position}. sıraya eklendi!`
      })
      setPushingId(null)
      setPushProductUrl('')
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally { setPushLoading(false) }
  }

  // ── Download ──
  const downloadImage = (url: string, name: string) => {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
  }

  const doneResults = results.filter(r => r.status === 'done')

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">📐 Image Resizer</h1>
        <p className="page-subtitle">Ürün görsellerini AI ile istediğin boyuta dönüştür</p>
      </div>

      <div className="page-body">
        {/* URL + Fetch */}
        <div className="card">
          <div className="card-title" style={{ fontSize: 15 }}>🛍️ Ürün Görselleri</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input className="form-input" placeholder="Shopify ürün URL'i"
              value={productUrl} onChange={e => setProductUrl(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
            <button className="btn btn-primary" onClick={fetchImages} disabled={loading || !productUrl}
              style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
              {loading ? <><span className="spinner" /> Çek</> : '🔍 Çek'}
            </button>
          </div>
          {productTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{productTitle}</div>}

          {images.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedImages.size}/{images.length} seçili</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setSelectedImages(new Set(images.map((_, i) => i)))}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}>
                    Tümünü Seç
                  </button>
                  <button onClick={() => setSelectedImages(new Set())}
                    style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}>
                    Temizle
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))', gap: 8, maxHeight: 350, overflowY: 'auto', padding: 4 }}>
                {images.map((img, idx) => (
                  <div key={idx} onClick={() => {
                    setSelectedImages(prev => {
                      const next = new Set(prev)
                      next.has(idx) ? next.delete(idx) : next.add(idx)
                      return next
                    })
                  }} style={{
                    border: selectedImages.has(idx) ? '3px solid var(--primary)' : '2px solid var(--border)',
                    borderRadius: 8, overflow: 'hidden', cursor: 'pointer', position: 'relative',
                    opacity: selectedImages.has(idx) ? 1 : 0.4, transition: 'all .15s',
                  }}>
                    <img src={img} alt="" style={{ width: '100%', height: 110, objectFit: 'cover' }} />
                    {selectedImages.has(idx) && (
                      <div style={{ position: 'absolute', top: 4, right: 4, background: 'var(--primary)', color: '#fff', borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>✓</div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Resize Settings */}
        {images.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ fontSize: 15 }}>⚙️ Resize Ayarları</div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label" style={{ fontSize: 11 }}>📐 Hedef Boyut</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                {ASPECT_RATIOS.map(r => (
                  <button key={r.value} onClick={() => setTargetRatio(r.value)} style={{
                    padding: '10px 4px', borderRadius: 8, cursor: 'pointer', transition: 'all .15s', textAlign: 'center',
                    background: targetRatio === r.value ? 'var(--primary)' : 'var(--bg)',
                    color: targetRatio === r.value ? '#fff' : 'var(--text)',
                    border: targetRatio === r.value ? '2px solid var(--primary)' : '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 18 }}>{r.icon}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{r.label}</div>
                    <div style={{ fontSize: 10, opacity: 0.7 }}>{r.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label" style={{ fontSize: 11 }}>🤖 AI Model</label>
              <select className="form-input" value={geminiModel} onChange={e => setGeminiModel(e.target.value)}
                style={{ fontSize: 13, padding: '8px 10px' }}>
                {GEMINI_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            <button className="btn btn-primary" onClick={startResize} disabled={processing || selectedImages.size === 0}
              style={{ width: '100%', fontSize: 14, padding: '12px', fontWeight: 700 }}>
              {processing ? <><span className="spinner" /> İşleniyor...</> : `📐 ${selectedImages.size} Görseli Resize Et`}
            </button>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ fontSize: 15 }}>📊 Sonuçlar ({doneResults.length}/{results.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {results.map(r => (
                <div key={r.id} style={{
                  border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden',
                  background: 'var(--bg)', transition: 'all .15s',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <div style={{ position: 'relative' }}>
                      <img src={r.originalUrl} alt="" style={{ width: '100%', height: 140, objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 4 }}>Orijinal</div>
                    </div>
                    <div style={{ position: 'relative', background: r.status === 'done' ? 'transparent' : 'var(--bg-hover)' }}>
                      {r.status === 'done' ? (
                        <>
                          <img src={r.resultUrl} alt="" style={{ width: '100%', height: 140, objectFit: 'cover' }} />
                          <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,.7)', color: '#fff', fontSize: 9, padding: '2px 6px', borderRadius: 4 }}>{r.aspectRatio}</div>
                        </>
                      ) : (
                        <div style={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                          {r.status === 'processing' ? <span className="spinner" /> : r.status === 'error' ? '❌' : '⏳'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{r.progress}</div>
                    {r.error && <div style={{ fontSize: 10, color: 'var(--error)', marginBottom: 4 }}>{r.error}</div>}
                    {r.status === 'done' && (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => downloadImage(r.resultUrl, `resized_${r.aspectRatio.replace(':', 'x')}.jpg`)}
                          style={{ flex: 1, fontSize: 10, padding: '4px', borderRadius: 4, background: 'var(--bg)', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text)' }}>
                          💾 İndir
                        </button>
                        <button onClick={() => { setPushingId(r.id); setPushProductUrl(productUrl) }}
                          style={{ flex: 1, fontSize: 10, padding: '4px', borderRadius: 4, background: 'var(--primary)', border: 'none', cursor: 'pointer', color: '#fff' }}>
                          🚀 Push
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Push Modal */}
      {pushingId && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--card-bg)', borderRadius: 12, padding: 24, width: 400, maxWidth: '90vw' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 12 }}>🚀 Shopify'a Push</div>
            <div className="form-group" style={{ marginBottom: 10 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Admin URL</label>
              <input className="form-input" value={pushProductUrl} onChange={e => setPushProductUrl(e.target.value)}
                placeholder="admin.shopify.com/.../products/ID" style={{ fontSize: 12 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: 11 }}>Mod</label>
                <select className="form-input" value={pushMode} onChange={e => setPushMode(e.target.value as 'replace' | 'add')} style={{ fontSize: 12 }}>
                  <option value="replace">🔄 Değiştir</option>
                  <option value="add">➕ Ekle</option>
                </select>
              </div>
              <div className="form-group" style={{ width: 70 }}>
                <label className="form-label" style={{ fontSize: 11 }}>Sıra</label>
                <input className="form-input" type="number" min={1} value={pushPosition}
                  onChange={e => setPushPosition(e.target.value)} style={{ fontSize: 12 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPushingId(null)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', cursor: 'pointer', color: 'var(--text)' }}>İptal</button>
              <button onClick={() => {
                const r = results.find(x => x.id === pushingId)
                if (r) pushToShopify(r)
              }} disabled={pushLoading} style={{ flex: 1, padding: 10, borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                {pushLoading ? <><span className="spinner" /> Push</> : '🚀 Push'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
