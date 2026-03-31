import { useState } from 'react'
import type { ToastData } from '../components/Toast'

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

interface VtonPair {
  id: string
  modelImg: string
  garmentImg: string
  category: string
  mode: 'standard' | 'ghost' | 'fabric'
  fabricInfo: string
  aiProvider: string
  falModel: string
  status: 'pending' | 'analyzing' | 'generating' | 'polling' | 'done' | 'error'
  progress: string
  resultUrl?: string
  error?: string
}

const CATEGORIES = [
  { value: 'dress', label: 'Dress' },
  { value: 'top', label: 'Top' },
  { value: 'jacket', label: 'Jacket' },
  { value: 'blouse', label: 'Blouse' },
  { value: 'bottom', label: 'Bottoms' },
  { value: 'skirt', label: 'Skirts' },
  { value: 'knitwear', label: 'Knitwear' },
  { value: 'swimwear', label: 'Swimwear' },
]

const AI_PROVIDERS = [
  { value: 'fal:nano-banana-2', label: '🟢 FAL — Nano Banana 2' },
  { value: 'fal:nano-banana-pro', label: '🟢 FAL — Nano Banana Pro' },
  { value: 'fal:nano-banana', label: '🟢 FAL — Nano Banana (Original)' },
  { value: 'gemini:gemini-2.0-flash-exp', label: '🔵 Gemini 2.0 Flash' },
  { value: 'gemini:gemini-2.5-flash-preview-05-20', label: '🔵 Gemini 2.5 Flash' },
]

export default function VtonTool({ addToast }: Props) {
  const [garmentUrl, setGarmentUrl] = useState('')
  const [modelUrl, setModelUrl] = useState('')
  const [garmentImages, setGarmentImages] = useState<string[]>([])
  const [modelImages, setModelImages] = useState<string[]>([])
  const [garmentTitle, setGarmentTitle] = useState('')
  const [modelTitle, setModelTitle] = useState('')
  const [fetchingGarment, setFetchingGarment] = useState(false)
  const [fetchingModel, setFetchingModel] = useState(false)

  const [selectedGarment, setSelectedGarment] = useState(0)
  const [selectedModel, setSelectedModel] = useState(0)
  const [category, setCategory] = useState('dress')
  const [mode, setMode] = useState<'standard' | 'ghost' | 'fabric'>('standard')
  const [fabricInfo, setFabricInfo] = useState('')
  const [aiProvider, setAiProvider] = useState('fal:nano-banana-2')

  const [pairs, setPairs] = useState<VtonPair[]>([])
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<{ id: string; url: string; mode: string; isBase64?: boolean }[]>([])

  // ── Shopify URL'den görsel çek ──
  const fetchImages = async (side: 'garment' | 'model') => {
    const url = side === 'garment' ? garmentUrl : modelUrl
    if (!url) return

    const setLoading = side === 'garment' ? setFetchingGarment : setFetchingModel
    setLoading(true)

    try {
      const res = await fetch('/api/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()

      if (data.needsHtml) {
        addToast({ type: 'info', message: '1688 desteklenmiyor, Shopify URL kullanın' })
        return
      }
      if (!data.success) throw new Error(data.error)

      const imgs = data.product.images || []
      if (side === 'garment') {
        setGarmentImages(imgs)
        setGarmentTitle(data.product.title || '')
        setSelectedGarment(0)
      } else {
        setModelImages(imgs)
        setModelTitle(data.product.title || '')
        setSelectedModel(0)
      }
      addToast({ type: 'success', message: `${imgs.length} görsel çekildi` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setLoading(false)
    }
  }

  // ── Pair ekle ──
  const addPair = () => {
    if (mode === 'standard' && (!garmentImages.length || !modelImages.length)) {
      addToast({ type: 'error', message: 'Standart mod için hem ürün hem model görseli gerekli' })
      return
    }
    if ((mode === 'ghost' || mode === 'fabric') && !garmentImages.length) {
      addToast({ type: 'error', message: 'Ürün görseli gerekli' })
      return
    }

    const [provider, model] = aiProvider.split(':')
    const pair: VtonPair = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      modelImg: mode === 'standard' ? modelImages[selectedModel] : '',
      garmentImg: garmentImages[selectedGarment],
      category,
      mode,
      fabricInfo,
      aiProvider: provider,
      falModel: model,
      status: 'pending',
      progress: 'Bekliyor',
    }
    setPairs((prev) => [...prev, pair])
  }

  const removePair = (id: string) => {
    setPairs((prev) => prev.filter((p) => p.id !== id))
  }

  // ── Build prompt ──
  const buildPrompt = (pair: VtonPair, modelDesc: string, garmentDesc: string) => {
    if (pair.mode === 'standard') {
      return `Professional editorial fashion photography. The exact same model from image 1 wearing a ${garmentDesc}. The model description: ${modelDesc}. IDENTITY & FACE: Maintain exact facial features. TECHNICAL: Realistic fabric physics, 8k resolution, photorealistic.`
    } else if (pair.mode === 'ghost') {
      return `Professional studio product photography of a ${garmentDesc}. Invisible ghost mannequin effect. Pure white background. Soft studio lighting.`
    } else {
      return `High-resolution fabric texture close-up. ${pair.fabricInfo ? `Fabric: ${pair.fabricInfo}.` : ''} Natural micro-folds, edge-to-edge clarity, neutral lighting.`
    }
  }

  // ── Tek pair işle ──
  const processPair = async (pair: VtonPair) => {
    const update = (u: Partial<VtonPair>) => setPairs((prev) => prev.map((p) => p.id === pair.id ? { ...p, ...u } : p))

    try {
      let modelDesc = ''
      let garmentDesc = ''

      // Analiz adımı
      if (pair.mode === 'standard' || pair.mode === 'ghost') {
        update({ status: 'analyzing', progress: '🔍 AI analiz...' })

        if (pair.mode === 'standard') {
          const [mRes, gRes] = await Promise.all([
            fetch('/api/vton-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'analyze', imageUrl: pair.modelImg, mode: 'model' }),
            }).then((r) => r.json()),
            fetch('/api/vton-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'analyze', imageUrl: pair.garmentImg, mode: 'garment',
                productTitle: garmentTitle, garmentCategory: pair.category, fabricInfo: pair.fabricInfo,
              }),
            }).then((r) => r.json()),
          ])
          if (!mRes.success) throw new Error(mRes.error || 'Model analiz başarısız')
          if (!gRes.success) throw new Error(gRes.error || 'Ürün analiz başarısız')
          modelDesc = mRes.description
          garmentDesc = gRes.description
        } else {
          const gRes = await fetch('/api/vton-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'analyze', imageUrl: pair.garmentImg, mode: 'ghost',
              productTitle: garmentTitle, garmentCategory: pair.category, fabricInfo: pair.fabricInfo,
            }),
          }).then((r) => r.json())
          if (!gRes.success) throw new Error(gRes.error || 'Analiz başarısız')
          garmentDesc = gRes.description
        }
      }

      const prompt = buildPrompt(pair, modelDesc, garmentDesc)
      const imageUrls = pair.mode === 'standard' ? [pair.modelImg, pair.garmentImg] : [pair.garmentImg]

      // ═══ GEMINI DIRECT ═══
      if (pair.aiProvider === 'gemini') {
        update({ status: 'generating', progress: '🔵 Gemini üretiyor...' })

        const geminiRes = await fetch('/api/vton-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'gemini_generate',
            prompt,
            imageUrls,
            geminiModel: pair.falModel,
          }),
        }).then((r) => r.json())

        if (!geminiRes.success) throw new Error(geminiRes.error || 'Gemini üretim başarısız')

        const dataUrl = `data:${geminiRes.mimeType};base64,${geminiRes.imageBase64}`
        update({ status: 'done', progress: '✅ Tamamlandı', resultUrl: dataUrl })
        setResults((prev) => [...prev, { id: pair.id, url: dataUrl, mode: pair.mode, isBase64: true }])
        return
      }

      // ═══ FAL QUEUE ═══
      update({ status: 'generating', progress: '🟢 FAL kuyruğa gönderiliyor...' })

      const submitRes = await fetch('/api/vton-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'fal_submit',
          model: pair.falModel,
          payload: {
            prompt,
            image_urls: imageUrls,
            resolution: '2K',
            aspect_ratio: '9:16',
            num_images: 1,
            output_format: 'png',
            safety_tolerance: '6',
          },
        }),
      }).then((r) => r.json())

      const requestId = submitRes.request_id
      if (!requestId) throw new Error('request_id alınamadı: ' + JSON.stringify(submitRes).substring(0, 200))

      // FAL model path for polling
      const falModelPath = pair.falModel.includes('pro') ? 'nano-banana-pro' : pair.falModel.includes('2') ? 'nano-banana-2' : 'nano-banana'

      // Polling
      update({ status: 'polling', progress: '⏳ Sonuç bekleniyor...' })

      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 5000))
        const elapsed = (attempt + 1) * 5

        const statusRes = await fetch('/api/vton-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fal_status',
            path: `/fal-ai/${falModelPath}/requests/${requestId}/status`,
          }),
        }).then((r) => r.json())

        if (statusRes.status === 'COMPLETED') {
          const resultRes = await fetch('/api/vton-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'fal_status',
              path: `/fal-ai/${falModelPath}/requests/${requestId}`,
            }),
          }).then((r) => r.json())

          const imageUrl = resultRes.images?.[0]?.url
          if (imageUrl) {
            update({ status: 'done', progress: '✅ Tamamlandı', resultUrl: imageUrl })
            setResults((prev) => [...prev, { id: pair.id, url: imageUrl, mode: pair.mode }])
            return
          }
          throw new Error('Görsel bulunamadı')
        }

        if (statusRes.status === 'FAILED' || statusRes.status === 'ERROR') {
          throw new Error('FAL üretim başarısız')
        }

        const pos = statusRes.queue_position
        update({ progress: pos !== undefined ? `⏳ Kuyruk (sıra: ${pos}) — ${elapsed}s` : `⏳ Polling... (${elapsed}s)` })
      }

      throw new Error('Timeout (10 dk)')
    } catch (err: any) {
      update({ status: 'error', error: err.message, progress: '❌ Hata' })
    }
  }

  // ── Batch ──
  const runBatch = async () => {
    const pending = pairs.filter((p) => p.status === 'pending')
    if (!pending.length) { addToast({ type: 'info', message: 'İşlenecek pair yok' }); return }
    setRunning(true)

    const semaphore = { count: 0, max: 3 }
    const queue = [...pending]

    const runNext = async (): Promise<void> => {
      while (queue.length > 0) {
        if (semaphore.count >= semaphore.max) { await new Promise((r) => setTimeout(r, 500)); continue }
        const pair = queue.shift()
        if (!pair) break
        semaphore.count++
        processPair(pair).finally(() => { semaphore.count-- })
      }
    }

    await Promise.all(Array.from({ length: semaphore.max }, () => runNext()))
    while (semaphore.count > 0) { await new Promise((r) => setTimeout(r, 500)) }
    setRunning(false)
    addToast({ type: 'success', message: 'Batch tamamlandı!' })
  }

  const providerLabel = AI_PROVIDERS.find((p) => p.value === aiProvider)?.label || aiProvider

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">👗 Virtual Try-On</h1>
        <p className="page-desc">Shopify ürün görselleri ile AI destekli sanal deneme</p>
      </div>

      <div className="page-body">
        {/* Split Panel */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
          {/* SOL: Ürün */}
          <div className="card">
            <div className="card-title" style={{ fontSize: 15 }}>🛍️ Ürün Görselleri</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input className="form-input" placeholder="Shopify URL veya Admin URL"
                value={garmentUrl} onChange={(e) => setGarmentUrl(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-primary" onClick={() => fetchImages('garment')} disabled={fetchingGarment || !garmentUrl}
                style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
                {fetchingGarment ? <><span className="spinner" /> Çekiliyor</> : '🔍 Çek'}
              </button>
            </div>
            {garmentTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{garmentTitle}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))', gap: 8, maxHeight: 350, overflowY: 'auto', padding: 4 }}>
              {garmentImages.map((img, idx) => (
                <div key={idx} onClick={() => setSelectedGarment(idx)} style={{
                  border: selectedGarment === idx ? '3px solid var(--primary)' : '2px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                  opacity: selectedGarment === idx ? 1 : 0.6, transition: 'all .15s',
                }}><img src={img} alt="" style={{ width: '100%', height: 110, objectFit: 'cover' }} /></div>
              ))}
            </div>
          </div>

          {/* SAĞ: Model */}
          <div className="card">
            <div className="card-title" style={{ fontSize: 15 }}>👤 Model Görselleri</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input className="form-input" placeholder="Shopify URL veya Admin URL"
                value={modelUrl} onChange={(e) => setModelUrl(e.target.value)} style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-primary" onClick={() => fetchImages('model')} disabled={fetchingModel || !modelUrl}
                style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}>
                {fetchingModel ? <><span className="spinner" /> Çekiliyor</> : '🔍 Çek'}
              </button>
            </div>
            {modelTitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>{modelTitle}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))', gap: 8, maxHeight: 350, overflowY: 'auto', padding: 4 }}>
              {modelImages.map((img, idx) => (
                <div key={idx} onClick={() => setSelectedModel(idx)} style={{
                  border: selectedModel === idx ? '3px solid var(--primary)' : '2px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                  opacity: selectedModel === idx ? 1 : 0.6, transition: 'all .15s',
                }}><img src={img} alt="" style={{ width: '100%', height: 110, objectFit: 'cover' }} /></div>
              ))}
            </div>
          </div>
        </div>

        {/* Pair Kontrolü */}
        <div className="card">
          <div className="card-title" style={{ fontSize: 15 }}>🔗 Pair Oluştur</div>

          {/* AI Provider */}
          <div className="form-group" style={{ marginBottom: 12 }}>
            <label className="form-label" style={{ fontSize: 11 }}>🤖 AI Sağlayıcı</label>
            <select className="form-input" value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}
              style={{ fontSize: 13, padding: '8px 10px', fontWeight: 600 }}>
              {AI_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
            <div className="form-group" style={{ flex: 1, minWidth: 120 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Kategori</label>
              <select className="form-input" value={category} onChange={(e) => setCategory(e.target.value)}
                style={{ fontSize: 12, padding: '6px 8px' }}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Fabric (opsiyonel)</label>
              <input className="form-input" placeholder="Cotton, Polyester..." value={fabricInfo}
                onChange={(e) => setFabricInfo(e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {(['standard', 'ghost', 'fabric'] as const).map((m) => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
                <input type="radio" name="vton-mode" checked={mode === m} onChange={() => setMode(m)} />
                {m === 'standard' ? '🤖 Standard VTON' : m === 'ghost' ? '👻 Ghost Mode' : '🧵 Fabric Mode'}
              </label>
            ))}
            <button className="btn btn-primary" onClick={addPair} style={{ marginLeft: 'auto', fontSize: 13, padding: '8px 20px' }}>
              + Pair Ekle ({providerLabel})
            </button>
          </div>

          {/* Pair tablosu */}
          {pairs.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ padding: 8, textAlign: 'left' }}>Model</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>Ürün</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>Mod</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>AI</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>Durum</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>Aksiyon</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: 8 }}>
                        {p.modelImg ? <img src={p.modelImg} alt="" style={{ width: 50, height: 65, objectFit: 'cover', borderRadius: 6 }} /> : '—'}
                      </td>
                      <td style={{ padding: 8 }}>
                        <img src={p.garmentImg} alt="" style={{ width: 50, height: 65, objectFit: 'cover', borderRadius: 6 }} />
                      </td>
                      <td style={{ padding: 8, fontSize: 11 }}>{p.mode}</td>
                      <td style={{ padding: 8, fontSize: 10 }}>
                        {p.aiProvider === 'gemini' ? '🔵' : '🟢'} {p.falModel}
                      </td>
                      <td style={{ padding: 8 }}>
                        <span style={{
                          padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: p.status === 'done' ? '#e8f5e9' : p.status === 'error' ? '#ffebee' : p.status === 'pending' ? '#f5f5f5' : '#fff3e0',
                          color: p.status === 'done' ? '#1b5e20' : p.status === 'error' ? '#c62828' : p.status === 'pending' ? '#666' : '#e65100',
                        }}>{p.progress}</span>
                        {p.error && <div style={{ fontSize: 10, color: '#c62828', marginTop: 2 }}>{p.error}</div>}
                      </td>
                      <td style={{ padding: 8 }}>
                        {p.status === 'pending' && (
                          <button className="btn btn-sm" onClick={() => removePair(p.id)}
                            style={{ background: 'var(--danger)', color: '#fff', fontSize: 11, padding: '3px 10px' }}>Sil</button>
                        )}
                        {p.resultUrl && (
                          <a href={p.resultUrl} target="_blank" rel="noopener"
                            style={{ fontSize: 11, color: 'var(--primary)' }}>Görüntüle ↗</a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button className="btn btn-primary" onClick={runBatch} disabled={running || !pairs.some((p) => p.status === 'pending')}
                style={{ width: '100%', marginTop: 16, fontSize: 14, padding: '12px 20px' }}>
                {running ? <><span className="spinner" /> Çalışıyor...</> : '🚀 Batch Çalıştır'}
              </button>
            </div>
          )}
        </div>

        {/* Sonuçlar */}
        {results.length > 0 && (
          <div className="card">
            <div className="card-title" style={{ fontSize: 15 }}>🖼️ Sonuçlar ({results.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              {results.map((r) => (
                <div key={r.id} style={{ borderRadius: 8, overflow: 'hidden', border: '2px solid var(--border)' }}>
                  <a href={r.url} target="_blank" rel="noopener">
                    <img src={r.url} alt="" style={{ width: '100%', height: 220, objectFit: 'cover' }} />
                  </a>
                  <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {r.mode === 'standard' ? '🤖 VTON' : r.mode === 'ghost' ? '👻 Ghost' : '🧵 Fabric'}
                    {r.isBase64 && ' (Gemini)'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
