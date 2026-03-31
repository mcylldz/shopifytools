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

interface VariantItem {
  name: string
  sizes: string[]
  imageIndex: number | null
}

interface VtonResult {
  id: string
  mode: string
  imageUrl: string
  prompt: string
  selected: boolean // Shopify'a gönderilecek mi
}

const STEPS = [
  { id: 1, icon: '🔗', label: 'Scrape' },
  { id: 2, icon: '🖼️', label: 'Görseller' },
  { id: 3, icon: '💰', label: 'Fiyat' },
  { id: 4, icon: '🤖', label: 'AI Enrichment' },
  { id: 5, icon: '👗', label: 'VTON' },
  { id: 6, icon: '🎨', label: 'Varyantlar' },
  { id: 7, icon: '🏷️', label: 'Etiketler' },
  { id: 8, icon: '🔗', label: 'Handle' },
  { id: 9, icon: '✅', label: 'Son Kontrol' },
]

const GARMENT_CATEGORIES = [
  { value: 'top', label: 'Üst Giyim (T-shirt, Bluz, Gömlek)' },
  { value: 'bottom', label: 'Alt Giyim (Pantolon, Etek)' },
  { value: 'dress', label: 'Elbise' },
  { value: 'jacket', label: 'Ceket / Mont' },
  { value: 'knitwear', label: 'Triko / Kazak' },
  { value: 'activewear', label: 'Spor Giyim' },
  { value: 'swimwear', label: 'Mayo / Bikini' },
  { value: 'accessory', label: 'Aksesuar' },
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

  // Step 1 — Scrape
  const [url, setUrl] = useState('')
  const [html1688, setHtml1688] = useState('')
  const [scraping, setScraping] = useState(false)
  const [product, setProduct] = useState<ScrapedProduct | null>(null)
  const [needs1688Html, setNeeds1688Html] = useState(false)

  // Step 2 — Images
  const [images, setImages] = useState<ImageItem[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // Step 3 — Pricing
  const [sellingPrice, setSellingPrice] = useState(0)
  const [comparePrice, setComparePrice] = useState(0)
  const [discountPct, setDiscountPct] = useState(0)

  // Step 4 — Enrichment
  const [enrichment, setEnrichment] = useState<any>(null)
  const [enriching, setEnriching] = useState(false)
  const [enrichedTitle, setEnrichedTitle] = useState('')
  const [enrichedDesc, setEnrichedDesc] = useState('')
  const [visionImageIdx, setVisionImageIdx] = useState(0)

  // Step 5 — VTON
  const [vtonMode, setVtonMode] = useState<'standard' | 'ghost' | 'fabric'>('standard')
  const [garmentCategory, setGarmentCategory] = useState('top')
  const [fabricInfo, setFabricInfo] = useState('')
  const [modelUrl, setModelUrl] = useState('')
  const [modelImages, setModelImages] = useState<string[]>([])
  const [modelTitle, setModelTitle] = useState('')
  const [scrapingModel, setScrapingModel] = useState(false)
  const [selectedProductImg, setSelectedProductImg] = useState(0)
  const [selectedModelImg, setSelectedModelImg] = useState(0)
  const [vtonGenerating, setVtonGenerating] = useState(false)
  const [vtonResults, setVtonResults] = useState<VtonResult[]>([])
  const [vtonProgress, setVtonProgress] = useState('')

  // Step 6 — Variants
  const [useVariants, setUseVariants] = useState(false)
  const [variants, setVariants] = useState<VariantItem[]>([])
  const [sizes, setSizes] = useState<string[]>([])
  const [sizeInput, setSizeInput] = useState('')

  // Step 7 — Tags
  const [tags, setTags] = useState('')
  const [suggestingTags, setSuggestingTags] = useState(false)

  // Step 8 — Handle
  const [handle, setHandle] = useState('')

  // Step 9 — Push
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState<any>(null)

  // ────────────────── Step 1: Scrape ──────────────────
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

      const p: ScrapedProduct = data.product
      setProduct(p)
      setImages(p.images.map((url: string, i: number) => ({ url, selected: true, order: i })))
      setSizes([...p.sizes])
      calculatePrice(p)
      setHandle(slugify(p.title))
      setTags(p.tags || '')
      setEnrichedTitle(p.title)
      setEnrichedDesc('')
      setVariants([{ name: p.colors?.[0] || 'Varsayılan', sizes: [...p.sizes], imageIndex: 0 }])

      addToast({ type: 'success', message: `${p.source === 'shopify' ? 'Shopify' : '1688'} ürünü çekildi!` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setScraping(false)
    }
  }

  const calculatePrice = (p: ScrapedProduct) => {
    let baseTRY = p.priceTRY
    if (p.source === 'shopify') {
      baseTRY = p.price.amount * 45
    }
    const selling = roundTo100(baseTRY * 2)
    setSellingPrice(selling)
    const discounts = [0.4, 0.5, 0.6]
    const disc = discounts[Math.floor(Math.random() * discounts.length)]
    setDiscountPct(Math.round(disc * 100))
    setComparePrice(roundTo100(selling / (1 - disc)))
  }

  // ────────────────── Step 2: Image helpers ──────────────────
  const toggleImage = (idx: number) => {
    setImages((prev) => prev.map((img, i) => i === idx ? { ...img, selected: !img.selected } : img))
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
    const u = prompt('Görsel URL girin:')
    if (u) setImages((prev) => [...prev, { url: u, selected: true, order: prev.length }])
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (const file of Array.from(files)) {
      const reader = new FileReader()
      reader.onload = () => {
        setImages((prev) => [...prev, { url: reader.result as string, selected: true, order: prev.length }])
      }
      reader.readAsDataURL(file)
    }
  }

  // ────────────────── Step 3: Variant helpers ──────────────────
  const addVariant = () => {
    const name = window.prompt('Varyant adı (ör: Siyah, Beyaz):')
    if (name) setVariants((prev) => [...prev, { name, sizes: [...sizes], imageIndex: null }])
  }

  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx))
  }

  const setVariantImage = (vIdx: number, imgIdx: number) => {
    setVariants((prev) => prev.map((v, i) => i === vIdx ? { ...v, imageIndex: imgIdx } : v))
  }

  const addSize = () => {
    const s = sizeInput.trim().toUpperCase()
    if (s && !sizes.includes(s)) {
      setSizes((prev) => [...prev, s])
      setVariants((prev) => prev.map((v) => ({ ...v, sizes: [...v.sizes, s] })))
    }
    setSizeInput('')
  }

  const removeSize = (size: string) => {
    setSizes((prev) => prev.filter((s) => s !== size))
    setVariants((prev) => prev.map((v) => ({ ...v, sizes: v.sizes.filter((s) => s !== size) })))
  }

  // ────────────────── Step 6: Enrichment ──────────────────
  const handleEnrich = async () => {
    if (!product) return
    setEnriching(true)

    try {
      const selectedImgs = images.filter((i) => i.selected).sort((a, b) => a.order - b.order)
      const visionUrl = selectedImgs[visionImageIdx]?.url || selectedImgs[0]?.url

      let visionData: any = null
      if (visionUrl && visionUrl.startsWith('http')) {
        const vRes = await fetch('/api/vision-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl: visionUrl }),
        })
        const vData = await vRes.json()
        if (vData.success) visionData = vData.vision
      }

      const eRes = await fetch('/api/enrich-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: [{
            product_id: 'import_new',
            title: enrichedTitle || product.title,
            body_html: product.description,
            tags,
            vendor: product.vendor || '',
            product_type: product.productType || '',
            images: selectedImgs.slice(0, 3).map((i) => i.url),
            variants: sizes.map((s) => ({
              id: 'new', title: s, sku: '', price: String(sellingPrice), option1: s,
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
      if (result?.google?.title) setEnrichedTitle(result.google.title)
      if (result?.google?.description) setEnrichedDesc(result.google.description)
      addToast({ type: 'success', message: 'AI enrichment tamamlandı!' })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setEnriching(false)
    }
  }

  // ────────────────── Step 7: VTON ──────────────────
  const handleScrapeModel = async () => {
    if (!modelUrl) return
    setScrapingModel(true)
    setModelImages([])
    setModelTitle('')

    try {
      const res = await fetch('/api/scrape-model-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: modelUrl }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      setModelImages(data.images || [])
      setModelTitle(data.title || '')
      addToast({ type: 'success', message: `${data.images.length} manken görseli çekildi` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setScrapingModel(false)
    }
  }

  const handleVtonGenerate = async () => {
    if (!product) return
    const selectedImgs = images.filter((i) => i.selected).sort((a, b) => a.order - b.order)
    const productImg = selectedImgs[selectedProductImg]?.url
    if (!productImg) { addToast({ type: 'error', message: 'Ürün görseli seçin' }); return }

    if (vtonMode === 'standard' && !modelImages[selectedModelImg]) {
      addToast({ type: 'error', message: 'Manken görseli seçin' }); return
    }

    setVtonGenerating(true)
    setVtonProgress('Analiz yapılıyor...')

    try {
      let modelDesc = ''
      let garmentDesc = ''

      if (vtonMode === 'standard') {
        // Paralel: manken + ürün analizi
        setVtonProgress('🔍 Manken ve ürün analizi (paralel)...')
        const [modelRes, garmentRes] = await Promise.all([
          fetch('/api/vton-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: modelImages[selectedModelImg],
              mode: 'model',
            }),
          }).then((r) => r.json()),
          fetch('/api/vton-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageUrl: productImg,
              mode: 'garment',
              productTitle: enrichedTitle || product.title,
              garmentCategory,
              fabricInfo: fabricInfo || undefined,
            }),
          }).then((r) => r.json()),
        ])

        if (!modelRes.success) throw new Error(`Manken analizi: ${modelRes.error}`)
        if (!garmentRes.success) throw new Error(`Ürün analizi: ${garmentRes.error}`)

        modelDesc = modelRes.description
        garmentDesc = garmentRes.description
      } else if (vtonMode === 'ghost') {
        // Sadece ürün analizi
        setVtonProgress('🔍 Ürün analizi (ghost mode)...')
        const res = await fetch('/api/vton-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageUrl: productImg,
            mode: 'ghost',
            productTitle: enrichedTitle || product.title,
            garmentCategory,
            fabricInfo: fabricInfo || undefined,
          }),
        })
        const data = await res.json()
        if (!data.success) throw new Error(data.error)
        garmentDesc = data.description
      }
      // Fabric mode: analiz yok

      // FAL AI görsel üret — submit only
      setVtonProgress('🎨 Görsel üretiliyor (FAL AI)...')

      const imageUrls = vtonMode === 'standard'
        ? [modelImages[selectedModelImg], productImg]
        : [productImg]

      const genRes = await fetch('/api/vton-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: vtonMode,
          modelDesc,
          garmentDesc,
          productTitle: enrichedTitle || product.title,
          garmentCategory,
          fabricInfo: fabricInfo || undefined,
          imageUrls,
          resolution: '2K',
          aspectRatio: '9:16',
        }),
      })
      const genData = await genRes.json()
      if (!genData.success) throw new Error(genData.error)

      // Eğer sync dönüyorsa (images direkt var)
      if (genData.status === 'COMPLETED' && genData.images?.length > 0) {
        const newResults: VtonResult[] = genData.images.map((img: any, idx: number) => ({
          id: `vton_${Date.now()}_${idx}`,
          mode: vtonMode,
          imageUrl: img.url,
          prompt: vtonMode,
          selected: false,
        }))
        setVtonResults((prev) => [...newResults, ...prev])
        addToast({ type: 'success', message: '✅ VTON görseli üretildi!' })
      } else if (genData.requestId) {
        // Async — frontend polling (5sn aralık, 5dk timeout)
        setVtonProgress('⏳ Sonuç bekleniyor (5sn aralıklarla kontrol)...')
        const maxWait = 5 * 60 * 1000 // 5 dakika
        const interval = 5000 // 5 saniye
        const start = Date.now()

        while (Date.now() - start < maxWait) {
          await new Promise((r) => setTimeout(r, interval))
          const elapsed = Math.round((Date.now() - start) / 1000)
          setVtonProgress(`⏳ Sonuç bekleniyor... (${elapsed}s)`)

          try {
            const pollRes = await fetch('/api/vton-generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'status', requestId: genData.requestId }),
            })
            const pollData = await pollRes.json()

            if (pollData.status === 'COMPLETED' && pollData.images?.length > 0) {
              const newResults: VtonResult[] = pollData.images.map((img: any, idx: number) => ({
                id: `vton_${Date.now()}_${idx}`,
                mode: vtonMode,
                imageUrl: img.url,
                prompt: vtonMode,
                selected: false,
              }))
              setVtonResults((prev) => [...newResults, ...prev])
              addToast({ type: 'success', message: '✅ VTON görseli üretildi!' })
              break
            }

            if (pollData.status === 'FAILED') {
              throw new Error('FAL AI üretim başarısız oldu')
            }
          } catch (pollErr: any) {
            // Poll hatası — sadece logla, döngüye devam et
            console.warn('Poll error:', pollErr.message)
          }
        }
      } else {
        addToast({ type: 'info', message: 'Görsel üretilemedi' })
      }
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setVtonGenerating(false)
      setVtonProgress('')
    }
  }

  const toggleVtonResult = (id: string) => {
    setVtonResults((prev) => prev.map((r) =>
      r.id === id ? { ...r, selected: !r.selected } : r
    ))
  }

  const addVtonToImages = () => {
    const selected = vtonResults.filter((r) => r.selected)
    if (selected.length === 0) { addToast({ type: 'info', message: 'Hiçbir VTON görseli seçilmedi' }); return }

    setImages((prev) => {
      const newImages = selected.map((r, i) => ({
        url: r.imageUrl,
        selected: true,
        order: prev.length + i,
      }))
      return [...prev, ...newImages]
    })
    addToast({ type: 'success', message: `${selected.length} VTON görseli eklendi` })
  }

  // ────────────────── Step 7: Tag Suggestion ──────────────────
  const handleSuggestTags = async () => {
    if (!product) return
    setSuggestingTags(true)

    try {
      const selImgs = images.filter((i) => i.selected).sort((a, b) => a.order - b.order)
      const imgUrl = selImgs[0]?.url

      const res = await fetch('/api/suggest-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageUrl: imgUrl?.startsWith('http') ? imgUrl : undefined,
          title: enrichedTitle || product.title,
          description: enrichedDesc || product.description,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      // 1688 ise "1688 online" tag'ını ekle
      let allTags = [...(data.tags || [])]
      if (product.source === '1688' && !allTags.includes('1688 online')) {
        allTags.push('1688 online')
      }

      // Mevcut taglarla birleştir
      const existing = tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      const merged = [...new Set([...existing, ...allTags])]
      setTags(merged.join(', '))

      addToast({ type: 'success', message: `🏷️ ${data.tags.length} tag önerildi` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setSuggestingTags(false)
    }
  }

  // ────────────────── Step 9: Push ──────────────────
  const handlePush = async () => {
    if (!product) return
    setPushing(true)
    setPushResult(null)

    try {
      const selectedImages = images.filter((i) => i.selected).sort((a, b) => a.order - b.order)

      const finalVariants = useVariants && variants.length > 1
        ? variants.flatMap((v) => v.sizes.map((s) => ({
            title: `${v.name} / ${s}`,
            size: s,
            color: v.name,
            price: String(sellingPrice),
            compareAtPrice: String(comparePrice),
          })))
        : sizes.map((s) => ({
            size: s,
            price: String(sellingPrice),
            compareAtPrice: String(comparePrice),
          }))

      const res = await fetch('/api/create-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: enrichedTitle || product.title,
          descriptionHtml: enrichedDesc || product.description,
          handle,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
          images: selectedImages.map((i) => i.url).filter((u) => u.startsWith('http')),
          variants: finalVariants.length > 0 ? finalVariants : [{ price: String(sellingPrice), compareAtPrice: String(comparePrice) }],
          vendor: product.vendor || '',
          productType: product.productType || '',
        }),
      })
      const data = await res.json()

      if (!data.success) {
        const errMsg = data.errors?.map((e: any) => `${e.field}: ${e.message}`).join(', ')
        throw new Error(errMsg || 'Ürün oluşturulamadı')
      }

      setPushResult(data.product)

      if (enrichment) {
        try {
          await fetch('/api/save-metafields', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              productId: data.product.id,
              enrichment,
              updateTitle: false,
              updateDescription: false,
              addFinishTag: false,
            }),
          })
        } catch { /* opsiyonel */ }
      }

      addToast({ type: 'success', message: `✅ Ürün oluşturuldu: ${data.product.title}` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setPushing(false)
    }
  }

  const goTo = (s: number) => setStep(s)
  const next = () => setStep((s) => Math.min(s + 1, 9))
  const prev = () => setStep((s) => Math.max(s - 1, 1))

  const selectedImages = images.filter((i) => i.selected).sort((a, b) => a.order - b.order)

  // ═══════════════════ RENDER ═══════════════════
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">📦 Ürün Import</h1>
        <p className="page-desc">1688 veya Shopify mağazasından ürün çekip mağazanıza ekler</p>
      </div>

      <div className="page-body">
        {/* Stepper */}
        <div style={{ display: 'flex', gap: 3, marginBottom: 24, overflowX: 'auto' }}>
          {STEPS.map((s) => (
            <button
              key={s.id}
              onClick={() => product && goTo(s.id)}
              style={{
                flex: 1, padding: '8px 4px', border: 'none', borderRadius: 6,
                background: step === s.id ? 'var(--primary)' : s.id < step ? 'var(--success)' : 'var(--bg-card)',
                color: step === s.id || s.id < step ? '#fff' : 'var(--text-muted)',
                fontSize: 11, fontWeight: step === s.id ? 700 : 400,
                cursor: product ? 'pointer' : 'default', transition: 'all .2s', whiteSpace: 'nowrap',
              }}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </div>

        {/* ═══ STEP 1: URL & Scrape ═══ */}
        {step === 1 && (
          <div className="card">
            <div className="card-title">🔗 Ürün Bağlantısı</div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Ürün URL'si</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" placeholder="https://store.com/products/... veya https://detail.1688.com/..."
                  value={url} onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-primary" onClick={handleScrape} disabled={scraping || (!url && !html1688)}>
                  {scraping ? <><span className="spinner" /> Çekiliyor...</> : '🔍 Çek'}
                </button>
              </div>
            </div>

            {needs1688Html && (
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label className="form-label">1688 Sayfa HTML'i</label>
                <textarea className="form-input" rows={6} placeholder="HTML kaynağını yapıştırın..."
                  value={html1688} onChange={(e) => setHtml1688(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: 11 }} />
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
                  <div style={{ fontSize: 13 }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>{product.title}</h3>
                    <p style={{ margin: '0 0 4px' }}>Kaynak: <strong>{product.source === 'shopify' ? 'Shopify' : '1688'}</strong></p>
                    <p style={{ margin: '0 0 4px' }}>Fiyat: <strong>{product.price.amount} {product.price.currency} → ₺{product.priceTRY}</strong></p>
                    <p style={{ margin: '0 0 4px' }}>Bedenler: <strong>{product.sizes.join(', ') || 'Yok'}</strong></p>
                    <p style={{ margin: 0 }}>Görseller: <strong>{product.images.length}</strong></p>
                  </div>
                </div>
                <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={next}>Devam → Görseller</button>
              </div>
            )}
          </div>
        )}

        {/* ═══ STEP 2: Images ═══ */}
        {step === 2 && product && (
          <div className="card">
            <div className="card-title">🖼️ Görsel Yönetimi</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 16 }}>
              {images.map((img, idx) => (
                <div key={idx} style={{
                  border: img.selected ? '2px solid var(--primary)' : '2px solid var(--border)',
                  borderRadius: 8, overflow: 'hidden', opacity: img.selected ? 1 : 0.3,
                  position: 'relative', transition: 'all .2s',
                }}>
                  <img src={img.url} alt="" style={{ width: '100%', height: 160, objectFit: 'cover' }} />
                  <div style={{ padding: 4, display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className="btn btn-sm" onClick={() => moveImage(idx, -1)}>↑</button>
                    <button className="btn btn-sm" onClick={() => moveImage(idx, 1)}>↓</button>
                    <button className="btn btn-sm" onClick={() => toggleImage(idx)}
                      style={{ background: img.selected ? 'var(--danger)' : 'var(--success)', color: '#fff' }}>
                      {img.selected ? '✕' : '✓'}
                    </button>
                    <a href={img.url} target="_blank" rel="noreferrer" className="btn btn-sm">⬇</a>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 10, padding: '0 4px 4px', color: 'var(--text-muted)' }}>#{idx + 1}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn" onClick={addImageUrl}>🔗 URL ile Ekle</button>
              <button className="btn" onClick={() => fileRef.current?.click()}>📁 Dosya Yükle</button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={handleFileUpload} />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Fiyat</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 3: Pricing ═══ */}
        {step === 3 && product && (
          <div className="card">
            <div className="card-title">💰 Fiyatlandırma</div>

            <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Kaynak Fiyat</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {product.price.amount} {product.price.currency} → ₺{product.priceTRY}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {product.source === '1688'
                  ? `Formül: (${product.price.amount} × 7 + 1400) × 2 → en yakın 100`
                  : `Formül: ${product.price.amount} × 45 × 2 → en yakın 100`}
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
                <label className="form-label">Karşılaştırma Fiyatı (₺) — %{discountPct} indirim</label>
                <input className="form-input" type="number" step={100} value={comparePrice}
                  onChange={(e) => setComparePrice(Number(e.target.value))}
                  style={{ fontSize: 20, fontWeight: 700, textDecoration: 'line-through', color: 'var(--text-muted)' }} />
              </div>
            </div>

            <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 16, marginBottom: 16, textAlign: 'center' }}>
              <span style={{ fontSize: 24, fontWeight: 700, textDecoration: 'line-through', color: 'var(--text-muted)', marginRight: 12 }}>₺{comparePrice}</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--danger)' }}>₺{sellingPrice}</span>
              {comparePrice > sellingPrice && (
                <span style={{ fontSize: 14, color: 'var(--success)', marginLeft: 8 }}>
                  %{Math.round((1 - sellingPrice / comparePrice) * 100)} indirim
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → AI Enrichment</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 4: AI Enrichment ═══ */}
        {step === 4 && product && (
          <div className="card">
            <div className="card-title">🤖 AI Enrichment</div>

            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Vision Analizi için Görsel Seçin</label>
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8 }}>
                {selectedImages.map((img, idx) => (
                  <img key={idx} src={img.url} alt=""
                    onClick={() => setVisionImageIdx(idx)}
                    style={{
                      width: 70, height: 90, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                      border: visionImageIdx === idx ? '3px solid var(--primary)' : '2px solid var(--border)',
                    }} />
                ))}
              </div>
            </div>

            {!enrichment ? (
              <button className="btn btn-primary" onClick={handleEnrich} disabled={enriching}>
                {enriching ? <><span className="spinner" /> Enrichment yapılıyor...</> : '🧠 Enrichment Başlat'}
              </button>
            ) : (
              <div>
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Önerilen Başlık</label>
                  <input className="form-input" value={enrichedTitle} onChange={(e) => setEnrichedTitle(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label className="form-label">Önerilen Açıklama</label>
                  <textarea className="form-input" rows={5} value={enrichedDesc} onChange={(e) => setEnrichedDesc(e.target.value)} />
                </div>

                {enrichment.google && (
                  <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Google Shopping & Meta Verileri</div>
                    <div style={{ fontSize: 11, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      {Object.entries(enrichment.google).slice(0, 14).map(([k, v]) => (
                        <div key={k}><span style={{ color: 'var(--text-muted)' }}>{k}:</span> {String(v).slice(0, 50)}</div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" onClick={prev}>← Geri</button>
                  <button className="btn btn-primary" onClick={next}>Devam → VTON</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ STEP 5: VTON ═══ */}
        {step === 5 && product && (
          <div className="card">
            <div className="card-title">👗 Virtual Try-On (VTON)</div>

            {/* Mod & Kategori */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                <label className="form-label">Mod</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { v: 'standard' as const, icon: '👤', label: 'Standard VTON' },
                    { v: 'ghost' as const, icon: '👻', label: 'Ghost Mode' },
                    { v: 'fabric' as const, icon: '🧵', label: 'Fabric Mode' },
                  ].map((m) => (
                    <button key={m.v} className="btn btn-sm"
                      onClick={() => setVtonMode(m.v)}
                      style={{
                        background: vtonMode === m.v ? 'var(--primary)' : undefined,
                        color: vtonMode === m.v ? '#fff' : undefined,
                        fontSize: 11, flex: 1,
                      }}>
                      {m.icon} {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ flex: 1, minWidth: 200 }}>
                <label className="form-label">Ürün Kategorisi</label>
                <select className="form-input" value={garmentCategory}
                  onChange={(e) => setGarmentCategory(e.target.value)}>
                  {GARMENT_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Kumaş bilgisi */}
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Kumaş Bilgisi (opsiyonel)</label>
              <input className="form-input" placeholder="ör: %100 pamuk, kalın french terry, saten..."
                value={fabricInfo} onChange={(e) => setFabricInfo(e.target.value)} />
            </div>

            {/* Split Screen: Sol = Ürün, Sağ = Manken */}
            <div style={{ display: 'grid', gridTemplateColumns: vtonMode === 'standard' ? '1fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
              {/* SOL — Ürün Görselleri */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--primary)' }}>
                  📷 Ürün Görselleri — Birini seçin
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
                  {selectedImages.map((img, idx) => (
                    <img key={idx} src={img.url} alt=""
                      onClick={() => setSelectedProductImg(idx)}
                      style={{
                        width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, cursor: 'pointer',
                        border: selectedProductImg === idx ? '3px solid var(--primary)' : '2px solid var(--border)',
                      }} />
                  ))}
                </div>
              </div>

              {/* SAĞ — Manken Görselleri (Sadece standard modda) */}
              {vtonMode === 'standard' && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--success)' }}>
                    👤 Manken Görselleri — Birini seçin
                  </div>

                  {/* Manken URL Scrape */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input className="form-input" placeholder="https://store.com/products/model-urun"
                      value={modelUrl} onChange={(e) => setModelUrl(e.target.value)}
                      style={{ flex: 1, fontSize: 11 }} />
                    <button className="btn btn-sm" onClick={handleScrapeModel} disabled={scrapingModel || !modelUrl}>
                      {scrapingModel ? '⏳' : '🔍'}
                    </button>
                  </div>
                  {modelTitle && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>{modelTitle}</div>
                  )}

                  {modelImages.length > 0 ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
                      {modelImages.map((img, idx) => (
                        <img key={idx} src={img} alt=""
                          onClick={() => setSelectedModelImg(idx)}
                          style={{
                            width: '100%', height: 110, objectFit: 'cover', borderRadius: 6, cursor: 'pointer',
                            border: selectedModelImg === idx ? '3px solid var(--success)' : '2px solid var(--border)',
                          }} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12,
                      border: '2px dashed var(--border)', borderRadius: 8 }}>
                      Shopify ürün URL'si yapıştırıp manken görsellerini çekin
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Generate Button */}
            <button className="btn btn-primary" onClick={handleVtonGenerate} disabled={vtonGenerating}
              style={{ width: '100%', padding: '14px 20px', fontSize: 14, marginBottom: 16 }}>
              {vtonGenerating ? (
                <><span className="spinner" /> {vtonProgress || 'İşleniyor...'}</>
              ) : (
                vtonMode === 'standard' ? '🎨 VTON Üret (Manken + Ürün)' :
                vtonMode === 'ghost' ? '👻 Ghost Görsel Üret' :
                '🧵 Kumaş Makro Üret'
              )}
            </button>

            {/* Sonuçlar */}
            {vtonResults.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    🖼️ Üretilen Görseller ({vtonResults.length})
                  </div>
                  <button className="btn btn-sm" onClick={addVtonToImages}
                    style={{ background: 'var(--success)', color: '#fff' }}>
                    ✅ Seçilenleri Ürün Görsellerine Ekle ({vtonResults.filter((r) => r.selected).length})
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                  {vtonResults.map((r) => (
                    <div key={r.id} onClick={() => toggleVtonResult(r.id)}
                      style={{
                        border: r.selected ? '3px solid var(--success)' : '2px solid var(--border)',
                        borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                        opacity: r.selected ? 1 : 0.7, transition: 'all .2s', position: 'relative',
                      }}>
                      <img src={r.imageUrl} alt="" style={{ width: '100%', height: 200, objectFit: 'cover' }} />
                      <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{r.mode === 'standard' ? '👤' : r.mode === 'ghost' ? '👻' : '🧵'} {r.mode}</span>
                        <span>{r.selected ? '✅' : '☐'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Varyantlar</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 6: Variants ═══ */}
        {step === 6 && product && (
          <div className="card">
            <div className="card-title">🎨 Varyantlar</div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Bedenler</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {sizes.map((s) => (<span key={s} className="tag-chip">{s} <button onClick={() => removeSize(s)}>×</button></span>))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" placeholder="Beden ekle (ör: XS)" value={sizeInput}
                  onChange={(e) => setSizeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSize())}
                  style={{ width: 120 }} />
                <button className="btn btn-sm" onClick={addSize}>Ekle</button>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="checkbox-row">
                <input type="checkbox" checked={useVariants} onChange={(e) => setUseVariants(e.target.checked)} />
                Renk / model varyantları kullan
              </label>
            </div>
            {useVariants && (
              <>
                {variants.map((v, vIdx) => (
                  <div key={vIdx} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <input className="form-input" value={v.name}
                        onChange={(e) => setVariants((prev) => prev.map((item, i) => i === vIdx ? { ...item, name: e.target.value } : item))}
                        style={{ width: 200, fontWeight: 600 }} />
                      <button className="btn btn-sm" style={{ background: 'var(--danger)', color: '#fff' }} onClick={() => removeVariant(vIdx)}>Sil</button>
                    </div>
                    <label className="form-label" style={{ fontSize: 11 }}>Varyant Görseli</label>
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8 }}>
                      {selectedImages.map((img, imgIdx) => (
                        <img key={imgIdx} src={img.url} alt="" onClick={() => setVariantImage(vIdx, imgIdx)}
                          style={{ width: 60, height: 80, objectFit: 'cover', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                            border: v.imageIndex === imgIdx ? '3px solid var(--primary)' : '2px solid var(--border)' }} />
                      ))}
                    </div>
                  </div>
                ))}
                <button className="btn" onClick={addVariant} style={{ marginBottom: 16 }}>+ Varyant Ekle</button>
              </>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={prev}>← Geri</button>
              <button className="btn btn-primary" onClick={next}>Devam → Etiketler</button>
            </div>
          </div>
        )}

        {/* ═══ STEP 7: Tags ═══ */}
        {step === 7 && (
          <div className="card">
            <div className="card-title">🏷️ Etiketler</div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Etiketler (virgülle ayırın)</label>
              <textarea className="form-input" rows={3} value={tags}
                onChange={(e) => setTags(e.target.value)} placeholder="elbise, siyah, kadın, yaz" />
            </div>
            <button className="btn" onClick={handleSuggestTags} disabled={suggestingTags} style={{ marginBottom: 12 }}>
              {suggestingTags ? <><span className="spinner" /> AI öneriliyor...</> : '🤖 AI ile Tag Öner'}
            </button>
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

        {/* ═══ STEP 8: Handle ═══ */}
        {step === 8 && (
          <div className="card">
            <div className="card-title">🔗 URL Handle</div>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Ürün Handle (URL slug)</label>
              <input className="form-input" value={handle} onChange={(e) => setHandle(e.target.value)} />
              <span className="form-hint">URL: sveltechic.com/products/{handle}</span>
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

        {/* ═══ STEP 9: Final Review ═══ */}
        {step === 9 && product && (
          <div className="card">
            <div className="card-title">✅ Son Kontrol</div>

            <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
              {[
                { label: '📝 Başlık', value: enrichedTitle || product.title, step: 4 },
                { label: '🖼️ Görseller', value: `${selectedImages.length} adet`, step: 2 },
                { label: '💰 Fiyat', value: `₺${sellingPrice} (karş: ₺${comparePrice})`, step: 3 },
                { label: '🤖 Enrichment', value: enrichment ? '✅ Yapıldı' : '⚠️ Yapılmadı', step: 4 },
                { label: '👗 VTON', value: vtonResults.length > 0 ? `${vtonResults.filter((r) => r.selected).length}/${vtonResults.length} görsel seçili` : 'Yapılmadı', step: 5 },
                { label: '🎨 Varyantlar', value: useVariants ? `${variants.length} varyant × ${sizes.join(',')}` : `${sizes.join(', ')}`, step: 6 },
                { label: '🏷️ Etiketler', value: tags || '(boş)', step: 7 },
                { label: '🔗 Handle', value: handle, step: 8 },
              ].map((row) => (
                <div key={row.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 8,
                }}>
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.label}</span>
                    <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{row.value}</div>
                  </div>
                  <button className="btn btn-sm" onClick={() => goTo(row.step)}>Düzenle</button>
                </div>
              ))}
            </div>

            {/* Preview images */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 20, paddingBottom: 8 }}>
              {selectedImages.map((img, i) => (
                <img key={i} src={img.url} alt="" style={{ width: 70, height: 90, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
              ))}
            </div>

            {pushResult ? (
              <div style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 16, textAlign: 'center' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Ürün Oluşturuldu!</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{pushResult.title} — {pushResult.status}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>ID: {pushResult.id}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  💡 Meta ve Google sync için AI Enrichment sayfasını kullanın
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={prev}>← Geri</button>
                <button className="btn btn-primary" onClick={handlePush} disabled={pushing}
                  style={{ flex: 1, fontSize: 15, padding: '14px 20px' }}>
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
