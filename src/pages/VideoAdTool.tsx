import { useState, useRef, useCallback } from 'react'
import type { ToastData } from '../components/Toast'
import { useCostTracker } from '../hooks/useCostTracker'
import CostPanel from '../components/CostPanel'

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

// ═══════════ Video Ad Modes (Higgsfield-Style Presets) ═══════════
type VideoMode =
  | 'simple-ugc' | 'clean-minimal' | 'luxury' | 'product-story' | 'cozy-morning' | 'elegant-minimal'
  | 'showcase-spin' | 'model-walk' | 'lifestyle-scene' | 'detail-zoom' | 'before-after-reveal'

interface ModePreset {
  id: VideoMode
  emoji: string
  label: string
  desc: string
  category: 'higgsfield' | 'classic'
  color: string
  preview: string // short visual hint
}

const VIDEO_MODES: ModePreset[] = [
  // Higgsfield-Style Presets
  { id: 'simple-ugc', emoji: '📱', label: 'Simple UGC', desc: 'Otantik, telefon cekim havasi, dogal ve samimi', category: 'higgsfield', color: '#f97316', preview: 'Handheld / Dogal isik / Casual' },
  { id: 'clean-minimal', emoji: '⬜', label: 'Clean Minimal', desc: 'Beyaz/notr arka plan, urun odakli, modern', category: 'higgsfield', color: '#94a3b8', preview: 'Beyaz studio / Tek golge / Sharp' },
  { id: 'luxury', emoji: '💎', label: 'Luxury', desc: 'Dramatik isik, slow motion, premium his', category: 'higgsfield', color: '#a855f7', preview: 'Chiaroscuro / Dolly-in / Moody' },
  { id: 'product-story', emoji: '📖', label: 'Product Story', desc: 'Flat-lay\'den giyime gecis, mini hikaye', category: 'higgsfield', color: '#ec4899', preview: 'Flat-lay > Unfold > Styled' },
  { id: 'cozy-morning', emoji: '☕', label: 'Cozy Morning', desc: 'Sicak isik, yumusak tonlar, rahat atmosfer', category: 'higgsfield', color: '#f59e0b', preview: 'Golden hour / Bokeh / Hygge' },
  { id: 'elegant-minimal', emoji: '🪶', label: 'Elegant Minimal', desc: 'Rafine, sofistike, incelikli hareket', category: 'higgsfield', color: '#6366f1', preview: 'Notr ton / Tek jest / Editorial' },
  // Classic Styles
  { id: 'showcase-spin', emoji: '🔄', label: 'Showcase Spin', desc: '360 urun donus efekti', category: 'classic', color: '#22c55e', preview: '360 / Studio / Rotation' },
  { id: 'model-walk', emoji: '🚶‍♀️', label: 'Model Walk', desc: 'Runway/sokak yuruyusu', category: 'classic', color: '#14b8a6', preview: 'Tracking shot / Confident walk' },
  { id: 'lifestyle-scene', emoji: '🌅', label: 'Lifestyle Scene', desc: 'Dogal ortamda kullanim', category: 'classic', color: '#eab308', preview: 'Cafe / Beach / Golden hour' },
  { id: 'detail-zoom', emoji: '🔍', label: 'Detail Zoom', desc: 'Kumas/detay close-up', category: 'classic', color: '#3b82f6', preview: 'Macro / Shallow DOF / Texture' },
  { id: 'before-after-reveal', emoji: '✨', label: 'Before-After', desc: 'Flat lay → giyilmis gecis', category: 'classic', color: '#f43f5e', preview: 'Transform / Reveal / Magic' },
]

// ═══════════ Video Models ═══════════
type VideoModel = 'kling-video-v3-pro' | 'veo-2' | 'veo-3' | 'veo-3-fast' | 'minimax-hailuo' | 'sora-2' | 'sora-2-pro'

const VIDEO_MODELS: { id: VideoModel; emoji: string; label: string; provider: string; badge?: string }[] = [
  { id: 'kling-video-v3-pro', emoji: '🎬', label: 'Kling v3 Pro', provider: 'FAL', badge: 'I2V' },
  { id: 'veo-2', emoji: '🔵', label: 'Veo 2', provider: 'Google', badge: 'I2V' },
  { id: 'veo-3', emoji: '🔵', label: 'Veo 3', provider: 'Google', badge: 'I2V' },
  { id: 'veo-3-fast', emoji: '⚡', label: 'Veo 3 Fast', provider: 'Google', badge: 'I2V' },
  { id: 'minimax-hailuo', emoji: '🟣', label: 'MiniMax Hailuo', provider: 'FAL', badge: 'I2V' },
  { id: 'sora-2', emoji: '🟠', label: 'Sora 2', provider: 'OpenAI', badge: 'T2V' },
  { id: 'sora-2-pro', emoji: '🔶', label: 'Sora 2 Pro', provider: 'OpenAI', badge: 'T2V' },
]

// Sora size options
const SORA_SIZES = [
  { value: '720x1280', label: '720x1280 (9:16 Dikey)', aspect: '9:16' },
  { value: '1080x1920', label: '1080x1920 (9:16 Full HD)', aspect: '9:16' },
  { value: '1280x720', label: '1280x720 (16:9 Yatay)', aspect: '16:9' },
  { value: '1920x1080', label: '1920x1080 (16:9 Full HD)', aspect: '16:9' },
]

type JobStatus = 'idle' | 'generating-prompt' | 'submitting' | 'polling' | 'done' | 'error'

// Safe JSON parser
async function safeJson(res: Response): Promise<any> {
  const text = await res.text()
  if (!text || text.trim() === '') throw new Error('Sunucu bos yanit dondu')
  try { return JSON.parse(text) } catch { throw new Error(`Gecersiz yanit: ${text.substring(0, 200)}`) }
}

// ═══════════ History (localStorage) ═══════════
interface VideoHistoryItem {
  id: string
  url: string
  model: string
  mode: string
  prompt: string
  timestamp: number
  productTitle?: string
}

const HISTORY_KEY = 'video_ad_history'

function loadHistory(): VideoHistoryItem[] {
  try {
    const stored = localStorage.getItem(HISTORY_KEY)
    return stored ? JSON.parse(stored) : []
  } catch { return [] }
}

function saveHistory(items: VideoHistoryItem[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 50))) } catch {}
}

export default function VideoAdTool({ addToast }: Props) {
  // ─ Steps
  const [activeStep, setActiveStep] = useState(1)

  // ─ URL & Images
  const [productUrl, setProductUrl] = useState('')
  const [productImages, setProductImages] = useState<string[]>([])
  const [productTitle, setProductTitle] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [selectedImage, setSelectedImage] = useState(0)
  const [selectedImages, setSelectedImages] = useState<number[]>([0]) // multi-select for consistency
  const [fetchingImages, setFetchingImages] = useState(false)

  // ─ Video Mode
  const [videoMode, setVideoMode] = useState<VideoMode>('simple-ugc')

  // ─ Prompt
  const [prompt, setPrompt] = useState('')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [generatingPrompt, setGeneratingPrompt] = useState(false)
  const [showNegPrompt, setShowNegPrompt] = useState(false)

  // ─ Video Model & Params
  const [videoModel, setVideoModel] = useState<VideoModel>('kling-video-v3-pro')
  const [klingDuration, setKlingDuration] = useState('5')
  const [klingCfgScale, setKlingCfgScale] = useState('0.5')
  const [minimaxPromptOptimizer, setMinimaxPromptOptimizer] = useState(true)
  const [soraSeconds, setSoraSeconds] = useState('4')
  const [soraSize, setSoraSize] = useState('720x1280')

  // ─ Job Status
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle')
  const [statusText, setStatusText] = useState('')
  const [resultVideos, setResultVideos] = useState<VideoHistoryItem[]>(() => loadHistory())
  const cancelRef = useRef(false)

  // ─ Cost tracker
  const { addCost, session: costSession, persistent: costPersistent } = useCostTracker('video')

  // ═══════════ Step Navigation ═══════════
  const goStep = (n: number) => setActiveStep(n)

  // ═══════════ Fetch Product Images ═══════════
  const fetchImages = async () => {
    if (!productUrl) return
    setFetchingImages(true)
    try {
      const res = await fetch('/api/scrape-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl }),
      })
      const data = await safeJson(res)
      if (data.needsHtml) { addToast({ type: 'info', message: '1688 desteklenmiyor, Shopify URL kullanin' }); return }
      if (!data.success) throw new Error(data.error)
      const imgs = data.product.images || []
      setProductImages(imgs)
      setProductTitle(data.product.title || '')
      setProductDescription(data.product.description?.replace(/<[^>]*>/g, '').substring(0, 200) || '')
      setSelectedImage(0)
      setSelectedImages([0])
      addToast({ type: 'success', message: `${imgs.length} gorsel cekildi` })
      if (imgs.length > 0) goStep(2) // auto-advance
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setFetchingImages(false)
    }
  }

  // ═══════════ Generate Prompt (Claude) ═══════════
  const handleGeneratePrompt = async () => {
    if (!productImages.length) {
      addToast({ type: 'error', message: 'Once urun gorsellerini cekin' }); return
    }
    setGeneratingPrompt(true)
    try {
      // Send all selected images for consistency analysis
      const imageUrls = selectedImages.map(idx => productImages[idx]).filter(Boolean)
      const res = await fetch('/api/video-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_prompt',
          imageUrl: productImages[selectedImage], // primary
          imageUrls, // all selected
          videoMode,
          videoModel,
          productTitle,
          productDescription,
        }),
      })
      const data = await safeJson(res)
      if (!data.success) throw new Error(data.error || 'Prompt olusturulamadi')
      setPrompt(data.prompt)
      if (data.negativePrompt) setNegativePrompt(data.negativePrompt)
      if (data.usage) {
        addCost(data.usage.model || 'claude-opus-4-20250514', 'Video Prompt', data.usage.input_tokens, data.usage.output_tokens)
      }
      addToast({ type: 'success', message: 'Prompt olusturuldu!' })
      goStep(4) // auto-advance to model selection
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setGeneratingPrompt(false)
    }
  }

  // ═══════════ Cancel Job ═══════════
  const handleCancel = useCallback(() => {
    cancelRef.current = true
    setJobStatus('idle')
    setStatusText('')
    addToast({ type: 'info', message: 'Video uretimi iptal edildi' })
  }, [addToast])

  // ═══════════ Download Video (via backend proxy) ═══════════
  const downloadVideo = async (url: string, name: string) => {
    try {
      let blobUrl: string

      if (url.startsWith('data:')) {
        // data: URL — convert to blob directly
        const res = await fetch(url)
        const blob = await res.blob()
        blobUrl = URL.createObjectURL(blob)
      } else {
        // Cross-origin URL — use backend proxy
        addToast({ type: 'info', message: 'Video indiriliyor...' })
        const proxyRes = await fetch('/api/video-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'download_proxy', videoUrl: url }),
        })
        const proxyData = await safeJson(proxyRes)
        if (!proxyData.success) throw new Error('Indirme basarisiz')
        const res2 = await fetch(proxyData.videoUrl)
        const blob = await res2.blob()
        blobUrl = URL.createObjectURL(blob)
      }

      const a = document.createElement('a')
      a.href = blobUrl
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
    } catch (err: any) {
      addToast({ type: 'error', message: `Indirme hatasi: ${err.message}` })
    }
  }

  // ═══════════ Submit Video Generation ═══════════
  const handleSubmitVideo = async () => {
    if (!prompt.trim()) { addToast({ type: 'error', message: 'Prompt bos olamaz' }); return }
    if (!productImages.length) { addToast({ type: 'error', message: 'Urun gorseli gerekli' }); return }

    cancelRef.current = false
    const imageUrl = productImages[selectedImage]
    setJobStatus('submitting')
    setStatusText('Video modeline gonderiliyor...')

    try {
      // ═══ Google Veo ═══
      if (videoModel === 'veo-2' || videoModel === 'veo-3' || videoModel === 'veo-3-fast') {
        const veoModelMap: Record<string, string> = {
          'veo-2': 'veo-2.0-generate-001',
          'veo-3': 'veo-3.0-generate-001',
          'veo-3-fast': 'veo-3.0-fast-generate-001',
        }
        const veoModelId = veoModelMap[videoModel]
        const modelLabel = VIDEO_MODELS.find(m => m.id === videoModel)?.label || videoModel
        setStatusText(`${modelLabel} uretiyor...`)

        const veoRes = await fetch('/api/video-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'veo_generate',
            prompt,
            imageUrl,
            veoModel: veoModelId,
            aspectRatio: '9:16', // Always vertical for Meta
          }),
        })
        const veoData = await safeJson(veoRes)
        if (!veoData.success) throw new Error(veoData.error || 'Veo uretim basarisiz')

        setJobStatus('polling')
        const opName = veoData.operationName
        if (!opName) throw new Error('Operation name alinamadi')

        for (let attempt = 0; attempt < 120; attempt++) {
          if (cancelRef.current) return
          await new Promise(r => setTimeout(r, 10000))
          setStatusText(`${modelLabel} uretiyor... (${(attempt + 1) * 10}s)`)

          const pollRes = await fetch('/api/video-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'veo_poll', operationName: opName }),
          })
          const pollData = await safeJson(pollRes)
          if (!pollData.success) throw new Error(pollData.error || 'Veo poll hatasi')

          if (pollData.done) {
            const videoUri = pollData.videoUri
            if (!videoUri) throw new Error('Video URL bulunamadi')

            // Proxy through backend to avoid exposing API key
            setStatusText('Video indiriliyor...')
            const proxyRes = await fetch('/api/video-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'veo_proxy', videoUri }),
            })
            const proxyData = await safeJson(proxyRes)
            if (!proxyData.success) throw new Error('Video proxy hatasi')

            addCost(veoModelId, `${modelLabel} Video`)
            finishJob(proxyData.videoUrl)
            return
          }
        }
        throw new Error('Veo timeout (20 dk)')
      }

      // ═══ OpenAI Sora ═══
      if (videoModel === 'sora-2' || videoModel === 'sora-2-pro') {
        const soraModelId = videoModel === 'sora-2-pro' ? 'sora-2-pro' : 'sora-2'
        setStatusText(`Sora ${soraModelId} gonderiliyor...`)

        const soraRes = await fetch('/api/video-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sora_submit',
            prompt,
            soraModel: soraModelId,
            size: soraSize,
            seconds: soraSeconds,
          }),
        })
        const soraData = await safeJson(soraRes)
        if (!soraData.success) throw new Error(soraData.error || 'Sora submit basarisiz')

        const videoId = soraData.id
        if (!videoId) throw new Error('Sora video ID alinamadi')

        setJobStatus('polling')
        for (let attempt = 0; attempt < 120; attempt++) {
          if (cancelRef.current) return
          await new Promise(r => setTimeout(r, 5000))
          setStatusText(`Sora uretiyor... (${(attempt + 1) * 5}s)`)

          const pollRes = await fetch('/api/video-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sora_poll', videoId }),
          })
          const pollData = await safeJson(pollRes)
          if (!pollData.success) throw new Error(pollData.error || 'Sora poll hatasi')

          if (pollData.done) {
            let videoUrl = pollData.videoUrl

            // Download video via sora_download (handles binary + redirects)
            // Retry up to 6 times with increasing delay — video may not be instantly available
            if (!videoUrl) {
              setStatusText('Sora video indiriliyor...')
              for (let dlAttempt = 0; dlAttempt < 6; dlAttempt++) {
                if (cancelRef.current) return
                const waitSec = (dlAttempt + 1) * 5 // 5s, 10s, 15s, 20s, 25s, 30s
                if (dlAttempt > 0) {
                  setStatusText(`Sora video indiriliyor... (deneme ${dlAttempt + 1}/6, ${waitSec}s bekleniyor)`)
                  await new Promise(r => setTimeout(r, waitSec * 1000))
                }
                try {
                  const dlRes = await fetch('/api/video-generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'sora_download', videoId }),
                  })
                  const dlData = await safeJson(dlRes)
                  if (dlData.success && dlData.videoUrl) { videoUrl = dlData.videoUrl; break }
                  if (dlData.retriable) continue // not ready yet, retry
                  if (!dlData.success && !dlData.retriable) throw new Error(dlData.error || 'Download basarisiz')
                } catch (dlErr: any) {
                  if (dlAttempt === 5) throw dlErr
                }
              }
            }

            if (!videoUrl) throw new Error('Sora video indirilemedi — 6 deneme yapildi')
            addCost(soraModelId, 'Sora Video')
            finishJob(videoUrl)
            return
          }
        }
        throw new Error('Sora timeout (10 dk)')
      }

      // ═══ FAL Models (Kling / MiniMax) ═══
      const model = videoModel
      let falPayload: any = {}

      if (model === 'kling-video-v3-pro') {
        falPayload = {
          prompt,
          image_url: imageUrl,
          duration: parseInt(klingDuration),
          cfg_scale: parseFloat(klingCfgScale),
          negative_prompt: negativePrompt || undefined,
          aspect_ratio: '9:16',
        }
      } else if (model === 'minimax-hailuo') {
        falPayload = {
          prompt,
          image_url: imageUrl,
          prompt_optimizer: minimaxPromptOptimizer,
        }
      }

      setStatusText('FAL kuyruga gonderiliyor...')
      const submitRes = await fetch('/api/video-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fal_video_submit', model, payload: falPayload }),
      })
      const submitData = await safeJson(submitRes)
      if (!submitData.success) throw new Error(submitData.error || 'FAL submit hatasi')
      const requestId = submitData.request_id
      if (!requestId) throw new Error('request_id alinamadi')

      const FAL_PATHS: Record<string, string> = {
        'kling-video-v3-pro': 'kling-video/v3/pro/image-to-video',
        'minimax-hailuo': 'minimax/video-01/image-to-video',
      }

      setJobStatus('polling')
      const basePath = FAL_PATHS[model]

      for (let attempt = 0; attempt < 180; attempt++) {
        if (cancelRef.current) return
        await new Promise(r => setTimeout(r, 5000))
        const elapsed = (attempt + 1) * 5
        setStatusText(`Video uretiyor... (${elapsed}s)`)

        const statusRes = await fetch('/api/video-generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'fal_video_status',
            path: `/fal-ai/${basePath}/requests/${requestId}/status`,
          }),
        })
        const statusData = await safeJson(statusRes)

        if (statusData.status === 'COMPLETED') {
          const resultRes = await fetch('/api/video-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'fal_video_status',
              path: `/fal-ai/${basePath}/requests/${requestId}`,
            }),
          })
          const resultData = await safeJson(resultRes)
          const videoUrl = resultData.video?.url || resultData.data?.video?.url
          if (videoUrl) {
            addCost(`fal:${model}`, 'FAL Video')
            finishJob(videoUrl)
            return
          }
          throw new Error('Video URL bulunamadi')
        }

        if (statusData.status === 'FAILED' || statusData.status === 'ERROR') {
          throw new Error('Video uretim basarisiz: ' + (statusData.error || 'Bilinmeyen hata'))
        }

        const pos = statusData.queue_position
        if (pos !== undefined) {
          setStatusText(`Kuyruk (sira: ${pos}) — ${elapsed}s`)
        }
      }
      throw new Error('Timeout (15 dk)')

    } catch (err: any) {
      if (cancelRef.current) return
      setJobStatus('error')
      setStatusText(err.message)
      addToast({ type: 'error', message: err.message })
    }
  }

  const finishJob = (videoUrl: string) => {
    const newVideo: VideoHistoryItem = {
      id: `v_${Date.now()}`,
      url: videoUrl,
      model: VIDEO_MODELS.find(m => m.id === videoModel)?.label || videoModel,
      mode: VIDEO_MODES.find(s => s.id === videoMode)?.label || videoMode,
      prompt: prompt.substring(0, 200),
      timestamp: Date.now(),
      productTitle,
    }
    setJobStatus('done')
    setStatusText('Video hazir!')
    setResultVideos(prev => {
      const updated = [newVideo, ...prev]
      saveHistory(updated)
      return updated
    })
    addToast({ type: 'success', message: 'Video basariyla olusturuldu!' })
  }

  const deleteVideo = (id: string) => {
    setResultVideos(prev => {
      const updated = prev.filter(v => v.id !== id)
      saveHistory(updated)
      return updated
    })
  }

  const isProcessing = jobStatus === 'submitting' || jobStatus === 'polling'
  const currentMode = VIDEO_MODES.find(m => m.id === videoMode)

  // ═══════════ RENDER ═══════════
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Video Reklam</h1>
        <p className="page-desc">Shopify urun gorselleri ile Meta Andromeda uyumlu reklam videolari olusturun</p>
      </div>

      <div className="page-body">
        {/* ═══ STEP INDICATORS ═══ */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {[
            { n: 1, label: 'Gorsel', icon: '1' },
            { n: 2, label: 'Mod', icon: '2' },
            { n: 3, label: 'Prompt', icon: '3' },
            { n: 4, label: 'Model', icon: '4' },
            { n: 5, label: 'Olustur', icon: '5' },
          ].map(step => (
            <button
              key={step.n}
              onClick={() => goStep(step.n)}
              style={{
                flex: 1,
                padding: '10px 8px',
                borderRadius: 10,
                border: activeStep === step.n ? '2px solid var(--accent)' : '1px solid var(--border)',
                background: activeStep === step.n ? 'var(--accent)' : step.n < activeStep ? 'rgba(34,197,94,0.1)' : 'var(--bg-surface)',
                color: activeStep === step.n ? '#fff' : step.n < activeStep ? 'var(--success)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
                transition: 'all .2s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <span style={{ fontSize: 14 }}>{step.n < activeStep ? '✓' : step.icon}</span>
              {step.label}
            </button>
          ))}
        </div>

        {/* ═══ STEP 1: URL & Image Selection ═══ */}
        {activeStep === 1 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Urun Gorselleri</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <input
                className="form-input"
                placeholder="Shopify urun URL'si yapistirin"
                value={productUrl}
                onChange={e => setProductUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchImages()}
                style={{ flex: 1, fontSize: 12 }}
              />
              <button
                className="btn btn-primary"
                onClick={fetchImages}
                disabled={fetchingImages || !productUrl}
                style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
              >
                {fetchingImages ? <><span className="spinner" /> Cekiliyor</> : 'Gorselleri Cek'}
              </button>
            </div>

            {productTitle && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10, fontWeight: 600 }}>
                {productTitle}
              </div>
            )}

            {productImages.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Ana gorsel icin tiklayin. Tutarlilik icin birden fazla gorsel secmek isterseniz Ctrl/Cmd+tiklama yapin.
                  Secili: <strong style={{ color: 'var(--accent)' }}>{selectedImages.length} gorsel</strong>
                  {selectedImages.length > 1 && ' (Claude tum gorselleri analiz edecek)'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 10, marginBottom: 14 }}>
                  {productImages.map((img, idx) => {
                    const isSelected = selectedImages.includes(idx)
                    const isPrimary = selectedImage === idx
                    return (
                      <div
                        key={idx}
                        onClick={(e) => {
                          if (e.ctrlKey || e.metaKey) {
                            // Multi-select toggle
                            setSelectedImages(prev =>
                              prev.includes(idx) ? (prev.length > 1 ? prev.filter(i => i !== idx) : prev) : [...prev, idx]
                            )
                          } else {
                            // Single select — set as primary + reset multi
                            setSelectedImage(idx)
                            setSelectedImages([idx])
                          }
                        }}
                        style={{
                          border: isPrimary ? '3px solid var(--accent)' : isSelected ? '2px solid var(--success)' : '2px solid var(--border)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          cursor: 'pointer',
                          opacity: isSelected ? 1 : 0.4,
                          transition: 'all .2s',
                          position: 'relative',
                        }}
                      >
                        <img src={img} alt="" style={{ width: '100%', height: 130, objectFit: 'cover' }} />
                        {isPrimary && (
                          <div style={{
                            position: 'absolute', top: 6, right: 6,
                            background: 'var(--accent)', color: '#fff', borderRadius: '50%',
                            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 800,
                          }}>1</div>
                        )}
                        {isSelected && !isPrimary && (
                          <div style={{
                            position: 'absolute', top: 6, right: 6,
                            background: 'var(--success)', color: '#fff', borderRadius: '50%',
                            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 800,
                          }}>+</div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <button className="btn btn-primary" onClick={() => goStep(2)} style={{ fontSize: 13, padding: '10px 28px' }}>
                  Devam →
                </button>
              </>
            )}
          </div>
        )}

        {/* ═══ STEP 2: Video Mode Selection (Higgsfield-Style) ═══ */}
        {activeStep === 2 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Video Modu Sec</div>

            {/* Higgsfield Presets */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Click-to-Ad Presets
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10, marginBottom: 20 }}>
              {VIDEO_MODES.filter(m => m.category === 'higgsfield').map(mode => (
                <div
                  key={mode.id}
                  onClick={() => setVideoMode(mode.id)}
                  style={{
                    padding: '16px 14px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    transition: 'all .25s',
                    background: videoMode === mode.id
                      ? `linear-gradient(135deg, ${mode.color}22, ${mode.color}44)`
                      : 'var(--bg-surface)',
                    border: videoMode === mode.id
                      ? `2px solid ${mode.color}`
                      : '1px solid var(--border)',
                    boxShadow: videoMode === mode.id
                      ? `0 4px 24px ${mode.color}33`
                      : 'none',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {videoMode === mode.id && (
                    <div style={{
                      position: 'absolute', top: 8, right: 8,
                      width: 20, height: 20, borderRadius: '50%',
                      background: mode.color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800,
                    }}>✓</div>
                  )}
                  <div style={{ fontSize: 28, marginBottom: 8 }}>{mode.emoji}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3, color: videoMode === mode.id ? mode.color : 'var(--text-primary)' }}>
                    {mode.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, lineHeight: 1.4 }}>{mode.desc}</div>
                  <div style={{
                    fontSize: 9, padding: '2px 8px', borderRadius: 4,
                    background: `${mode.color}15`, color: mode.color,
                    fontWeight: 600, display: 'inline-block',
                  }}>
                    {mode.preview}
                  </div>
                </div>
              ))}
            </div>

            {/* Classic Styles */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Classic Styles
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
              {VIDEO_MODES.filter(m => m.category === 'classic').map(mode => (
                <div
                  key={mode.id}
                  onClick={() => setVideoMode(mode.id)}
                  style={{
                    padding: '12px 12px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    transition: 'all .2s',
                    background: videoMode === mode.id
                      ? `linear-gradient(135deg, ${mode.color}22, ${mode.color}33)`
                      : 'var(--bg-surface)',
                    border: videoMode === mode.id
                      ? `2px solid ${mode.color}`
                      : '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{mode.emoji}</div>
                  <div style={{ fontWeight: 700, fontSize: 12, color: videoMode === mode.id ? mode.color : 'var(--text-primary)' }}>
                    {mode.label}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{mode.desc}</div>
                </div>
              ))}
            </div>

            {/* Selected Mode Preview */}
            {currentMode && (
              <div style={{
                padding: '14px 18px', borderRadius: 12,
                background: `linear-gradient(135deg, ${currentMode.color}08, ${currentMode.color}15)`,
                border: `1px solid ${currentMode.color}33`,
                marginBottom: 14,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: currentMode.color, marginBottom: 4 }}>
                  {currentMode.emoji} {currentMode.label} secildi
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {currentMode.desc} — {currentMode.preview}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => goStep(1)} style={{ fontSize: 12, padding: '8px 16px' }}>
                ← Geri
              </button>
              <button className="btn btn-primary" onClick={() => goStep(3)} style={{ fontSize: 13, padding: '10px 28px' }}>
                Devam →
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Prompt Generation ═══ */}
        {activeStep === 3 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ fontSize: 15 }}>AI Prompt</div>

            {/* Selected mode reminder */}
            {currentMode && (
              <div style={{
                padding: '8px 12px', borderRadius: 8, marginBottom: 12,
                background: `${currentMode.color}10`, border: `1px solid ${currentMode.color}22`,
                fontSize: 11, color: currentMode.color, fontWeight: 600,
              }}>
                {currentMode.emoji} {currentMode.label} — {currentMode.preview}
              </div>
            )}

            {/* Selected image thumbnail */}
            {productImages[selectedImage] && (
              <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                  src={productImages[selectedImage]}
                  alt=""
                  style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '2px solid var(--border)' }}
                />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{productTitle || 'Urun'}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Secili gorsel #{selectedImage + 1}</div>
                </div>
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleGeneratePrompt}
              disabled={generatingPrompt || !productImages.length}
              style={{ marginBottom: 12, fontSize: 13, padding: '10px 24px' }}
            >
              {generatingPrompt ? <><span className="spinner" /> Prompt Olusturuluyor...</> : 'Prompt Olustur (Claude Opus 4)'}
            </button>

            {prompt && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Video prompt ({prompt.length} karakter)</span>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 4,
                    background: prompt.length > 100 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    color: prompt.length > 100 ? 'var(--success)' : 'var(--danger)',
                    fontWeight: 600,
                  }}>
                    {prompt.length > 100 ? 'Iyi uzunluk' : 'Kisa olabilir'}
                  </span>
                </div>
                <textarea
                  className="form-input"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={6}
                  style={{ fontSize: 12, lineHeight: 1.6, fontFamily: 'monospace', resize: 'vertical', minHeight: 120, marginBottom: 8 }}
                />

                {/* Negative Prompt */}
                <div>
                  <button
                    onClick={() => setShowNegPrompt(!showNegPrompt)}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-muted)',
                      fontSize: 11, cursor: 'pointer', padding: '4px 0', fontWeight: 600,
                    }}
                  >
                    {showNegPrompt ? '▼' : '▶'} Negative Prompt {negativePrompt ? `(${negativePrompt.split(',').length} terim)` : ''}
                  </button>
                  {showNegPrompt && (
                    <textarea
                      className="form-input"
                      value={negativePrompt}
                      onChange={e => setNegativePrompt(e.target.value)}
                      rows={2}
                      placeholder="blur, distortion, low quality, watermark..."
                      style={{ fontSize: 11, lineHeight: 1.5, fontFamily: 'monospace', resize: 'vertical', marginTop: 4 }}
                    />
                  )}
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => goStep(2)} style={{ fontSize: 12, padding: '8px 16px' }}>
                ← Geri
              </button>
              {prompt && (
                <button className="btn btn-primary" onClick={() => goStep(4)} style={{ fontSize: 13, padding: '10px 28px' }}>
                  Devam →
                </button>
              )}
            </div>
          </div>
        )}

        {/* ═══ STEP 4: Model Selection & Params ═══ */}
        {activeStep === 4 && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Video Modeli & Ayarlar</div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label" style={{ fontSize: 11 }}>Video Modeli</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                {VIDEO_MODELS.map(model => (
                  <button
                    key={model.id}
                    onClick={() => setVideoModel(model.id)}
                    style={{
                      padding: '12px 10px',
                      borderRadius: 10,
                      cursor: 'pointer',
                      transition: 'all .2s',
                      background: videoModel === model.id ? 'var(--accent)' : 'var(--bg-surface)',
                      color: videoModel === model.id ? '#fff' : 'var(--text-primary)',
                      border: videoModel === model.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                      fontSize: 12,
                      fontWeight: 600,
                      textAlign: 'center',
                      position: 'relative',
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>{model.emoji}</div>
                    {model.label}
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>{model.provider}</div>
                    {model.badge && (
                      <span style={{
                        position: 'absolute', top: 4, right: 4,
                        fontSize: 8, padding: '1px 5px', borderRadius: 3,
                        background: videoModel === model.id ? 'rgba(255,255,255,0.2)' : 'rgba(91,110,245,0.1)',
                        color: videoModel === model.id ? '#fff' : 'var(--accent)',
                        fontWeight: 700,
                      }}>{model.badge}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Kling Params ── */}
            {videoModel === 'kling-video-v3-pro' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: 10 }}>Sure (sn)</label>
                  <select className="form-input" value={klingDuration} onChange={e => setKlingDuration(e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }}>
                    <option value="5">5 saniye</option>
                    <option value="10">10 saniye</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: 10 }}>CFG Scale</label>
                  <input className="form-input" type="number" min="0.1" max="1.0" step="0.1"
                    value={klingCfgScale} onChange={e => setKlingCfgScale(e.target.value)}
                    style={{ fontSize: 12, padding: '6px 8px' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }}>
                  9:16 dikey format otomatik uygulanir. Meta Andromeda icin 5 sn onerilir.
                </div>
              </div>
            )}

            {/* ── Veo Info ── */}
            {(videoModel === 'veo-2' || videoModel === 'veo-3' || videoModel === 'veo-3-fast') && (
              <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  9:16 dikey format ve otomatik sure. Prompt'ta kamera hareketlerini belirtebilirsiniz.
                </div>
              </div>
            )}

            {/* ── Sora Params ── */}
            {(videoModel === 'sora-2' || videoModel === 'sora-2-pro') && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: 10 }}>Sure (sn)</label>
                  <select className="form-input" value={soraSeconds} onChange={e => setSoraSeconds(e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }}>
                    <option value="4">4 saniye</option>
                    <option value="8">8 saniye</option>
                    <option value="12">12 saniye</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" style={{ fontSize: 10 }}>Cozunurluk</label>
                  <select className="form-input" value={soraSize} onChange={e => setSoraSize(e.target.value)} style={{ fontSize: 12, padding: '6px 8px' }}>
                    {SORA_SIZES.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)' }}>
                  Sora text-to-video modunda calisir (insan iceren gorselleri desteklemez). Claude prompt'a gorsel detaylarini otomatik ekler. Meta icin 4 sn / 9:16 onerilir.
                </div>
              </div>
            )}

            {/* ── MiniMax Params ── */}
            {videoModel === 'minimax-hailuo' && (
              <div style={{ padding: '12px 16px', background: 'var(--bg-surface)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={minimaxPromptOptimizer}
                    onChange={e => setMinimaxPromptOptimizer(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                  <span style={{ fontWeight: 600 }}>Prompt Optimizer</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>— MiniMax prompt'u otomatik optimize etsin</span>
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-secondary" onClick={() => goStep(3)} style={{ fontSize: 12, padding: '8px 16px' }}>
                ← Geri
              </button>
              <button className="btn btn-primary" onClick={() => goStep(5)} style={{ fontSize: 13, padding: '10px 28px' }}>
                Devam →
              </button>
            </div>
          </div>
        )}

        {/* ═══ STEP 5: Submit & Results ═══ */}
        {activeStep === 5 && (
          <>
            {/* Summary Card */}
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title" style={{ fontSize: 15 }}>Ozet & Olustur</div>

              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 12, marginBottom: 16 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Gorsel:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {productImages[selectedImage] && (
                    <img src={productImages[selectedImage]} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6 }} />
                  )}
                  <span>{productTitle || 'Gorsel secildi'}</span>
                </div>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Mod:</span>
                <span style={{ color: currentMode?.color }}>{currentMode?.emoji} {currentMode?.label}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Model:</span>
                <span>{VIDEO_MODELS.find(m => m.id === videoModel)?.emoji} {VIDEO_MODELS.find(m => m.id === videoModel)?.label}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Prompt:</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{prompt.substring(0, 80)}...</span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  onClick={handleSubmitVideo}
                  disabled={isProcessing || !prompt.trim() || !productImages.length}
                  style={{ flex: 1, fontSize: 15, padding: '14px 24px', fontWeight: 700 }}
                >
                  {isProcessing ? <><span className="spinner" /> {statusText}</> : 'Video Olustur'}
                </button>
                {isProcessing && (
                  <button
                    className="btn btn-secondary"
                    onClick={handleCancel}
                    style={{ fontSize: 13, padding: '14px 20px', fontWeight: 600, color: 'var(--danger)' }}
                  >
                    Iptal
                  </button>
                )}
              </div>

              {jobStatus !== 'idle' && !isProcessing && (
                <div style={{
                  marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  background: jobStatus === 'done' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  color: jobStatus === 'done' ? 'var(--success)' : 'var(--danger)',
                  border: `1px solid ${jobStatus === 'done' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                  {jobStatus === 'done' ? '✓' : '✕'} {statusText}
                </div>
              )}

              <button className="btn btn-secondary" onClick={() => goStep(4)} style={{ marginTop: 8, fontSize: 12, padding: '8px 16px' }}>
                ← Ayarlara don
              </button>
            </div>

            {/* Results */}
            {resultVideos.length > 0 && (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-title" style={{ fontSize: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Sonuclar ({resultVideos.length})</span>
                  {resultVideos.length > 0 && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>
                      Gecmis localStorage'da saklanir
                    </span>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                  {resultVideos.map(video => (
                    <div key={video.id} style={{
                      borderRadius: 12, overflow: 'hidden',
                      border: '1px solid var(--border)', background: 'var(--bg-surface)',
                    }}>
                      <video
                        src={video.url}
                        controls
                        playsInline
                        style={{ width: '100%', maxHeight: 400, background: '#000' }}
                      />
                      <div style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4,
                            background: 'var(--accent-dim)', color: 'var(--accent-hover)', fontWeight: 600,
                          }}>{video.model}</span>
                          <span style={{
                            fontSize: 10, padding: '2px 8px', borderRadius: 4,
                            background: 'var(--warning-dim)', color: 'var(--warning)', fontWeight: 600,
                          }}>{video.mode}</span>
                        </div>
                        {video.productTitle && (
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>{video.productTitle}</div>
                        )}
                        {video.timestamp && (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>
                            {new Date(video.timestamp).toLocaleString('tr-TR')}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => downloadVideo(video.url, `video-ad-${video.id}.mp4`)}
                            style={{ flex: 1, fontSize: 11, padding: '6px 10px' }}
                          >
                            Indir
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => deleteVideo(video.id)}
                            style={{ fontSize: 11, padding: '6px 10px', color: 'var(--danger)' }}
                          >
                            Sil
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <CostPanel session={costSession} persistent={costPersistent} title="Video" />
    </>
  )
}
