import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { ToastData } from '../components/Toast'

// ─── Types ──────────────────────────────────────────────────────────
interface VariantData {
  id: string
  numericId: string
  title: string
  sku: string
  price: string
  compareAtPrice: string | null
  options: { name: string; value: string }[]
  inventoryQuantity: number
}

interface ProductData {
  id: string
  numericId: string
  title: string
  descriptionHtml: string
  vendor: string
  productType: string
  tags: string[]
  status: string
  featuredImage: string | null
  images: string[]
  variants: VariantData[]
  collections: string[]
  enrichment: {
    status: any | null
    version: string | null
    needsReview: boolean
  }
}

interface EnrichmentProgress {
  cursor: string | null
  processedIds: string[]
  successCount: number
  failedCount: number
  failedQueue: { productId: string; title: string; error: string; retryCount: number }[]
  startedAt: string
  settings: {
    platforms: { google: boolean; meta: boolean }
    mode: string
    visionEnabled: boolean
  }
}

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

// ─── Constants ──────────────────────────────────────────────────────
const CONCURRENCY = 3
const COST_PER_PRODUCT = 0.013  // Vision açık tahmini
const COST_PER_PRODUCT_NO_VISION = 0.01
const STORAGE_KEY = 'enrichment_progress'

// ─── Component ──────────────────────────────────────────────────────
export default function ProductEnrichment({ addToast }: Props) {
  // Filters
  const [statusFilter, setStatusFilter] = useState<string[]>(['active'])
  const [tagInput, setTagInput] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any')
  const [selectedCollection, setSelectedCollection] = useState('')
  const [enrichmentFilter, setEnrichmentFilter] = useState('all')
  const [collections, setCollections] = useState<{ id: string; title: string; productsCount: number }[]>([])

  // Products
  const [products, setProducts] = useState<ProductData[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loadingProducts, setLoadingProducts] = useState(false)

  // Settings
  const [platforms, setPlatforms] = useState({ google: true, meta: true })
  const [mode, setMode] = useState('fill_empty')
  const [visionEnabled, setVisionEnabled] = useState(true)

  // Processing
  const [isProcessing, setIsProcessing] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const pauseRef = useRef(false)
  const [progress, setProgress] = useState({ total: 0, done: 0, success: 0, failed: 0 })
  const [processLog, setProcessLog] = useState<string[]>([])
  const [failedQueue, setFailedQueue] = useState<EnrichmentProgress['failedQueue']>([])
  const [dryRunResults, setDryRunResults] = useState<any[]>([])
  const [totalUsage, setTotalUsage] = useState({ input_tokens: 0, output_tokens: 0 })

  // Resume check
  const [savedProgress, setSavedProgress] = useState<EnrichmentProgress | null>(null)

  // Vision cache
  const visionCacheRef = useRef<Map<string, any>>(new Map())

  // Load collections on mount
  useEffect(() => {
    fetch('/api/get-collections')
      .then((r) => r.json())
      .then((d) => setCollections(d.collections || []))
      .catch(() => {})
  }, [])

  // Check for saved progress
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        setSavedProgress(JSON.parse(saved))
      } catch { /* ignore */ }
    }
  }, [])

  // ─── Log helper ───
  const log = useCallback((msg: string) => {
    setProcessLog((prev) => [...prev.slice(-200), `[${new Date().toLocaleTimeString('tr-TR')}] ${msg}`])
  }, [])

  // ─── Fetch products ───
  const handleFilter = async () => {
    setLoadingProducts(true)
    setProducts([])
    setSelectedIds(new Set())
    try {
      const allProducts: ProductData[] = []
      let after: string | null = null

      do {
        const qs = new URLSearchParams()
        if (statusFilter.length > 0 && !statusFilter.includes('any')) {
          qs.set('status', statusFilter[0]) // GraphQL only supports single status
        }
        if (selectedTags.length > 0) {
          qs.set('tags', selectedTags.join(','))
          qs.set('tag_mode', tagMode)
        }
        if (selectedCollection) qs.set('collection_id', selectedCollection)
        qs.set('enrichment_filter', enrichmentFilter)
        if (after) qs.set('after', after)

        const res = await fetch(`/api/get-products-graphql?${qs.toString()}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata')

        allProducts.push(...(data.products || []))
        after = data.pageInfo?.hasNextPage ? data.pageInfo.endCursor : null
      } while (after)

      setProducts(allProducts)
      addToast({ type: 'info', message: `${allProducts.length} ürün bulundu.` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setLoadingProducts(false)
    }
  }

  // ─── Tag helpers ───
  const addTag = () => {
    const t = tagInput.trim().toLowerCase()
    if (t && !selectedTags.includes(t)) {
      setSelectedTags((prev) => [...prev, t])
    }
    setTagInput('')
  }
  const removeTag = (tag: string) => setSelectedTags((prev) => prev.filter((t) => t !== tag))

  // ─── Selection ───
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const selectAll = () => setSelectedIds(new Set(products.map((p) => p.id)))
  const selectNone = () => setSelectedIds(new Set())

  const selectedProducts = useMemo(
    () => products.filter((p) => selectedIds.has(p.id)),
    [products, selectedIds]
  )

  // ─── Cost estimate ───
  const costEstimate = useMemo(() => {
    const count = selectedProducts.length
    const costPerUnit = visionEnabled ? COST_PER_PRODUCT : COST_PER_PRODUCT_NO_VISION
    const cost = count * costPerUnit
    const timeMin = Math.ceil((count / CONCURRENCY) * (visionEnabled ? 12 : 8) / 60)
    return { count, cost: cost.toFixed(2), timeMin }
  }, [selectedProducts.length, visionEnabled])

  // ─── Missing field count ───
  // Missing field count (placeholder for future use)

  // ─── Process single product ───
  const processProduct = async (product: ProductData): Promise<boolean> => {
    const label = `"${product.title.slice(0, 30)}..."`

    try {
      // Step 1: Vision (optional)
      let visionData: any = null
      if (visionEnabled && product.featuredImage) {
        // Check cache first
        if (visionCacheRef.current.has(product.featuredImage)) {
          visionData = visionCacheRef.current.get(product.featuredImage)
          log(`👁️ ${label} — Vision cache kullanıldı`)
        } else {
          log(`👁️ ${label} — Görsel analiz ediliyor...`)
          const vRes = await fetch('/api/vision-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: product.featuredImage }),
          })
          const vData = await vRes.json()
          if (vData.success && vData.vision) {
            visionData = vData.vision
            visionCacheRef.current.set(product.featuredImage, visionData)
            setTotalUsage((prev) => ({
              input_tokens: prev.input_tokens + (vData.usage?.input_tokens || 0),
              output_tokens: prev.output_tokens + (vData.usage?.output_tokens || 0),
            }))
          } else {
            log(`⚠️ ${label} — Vision hata: ${vData.error || 'bilinmeyen'}, metin bazlı devam`)
          }
        }
      }

      // Check pause
      if (pauseRef.current) return false

      // Step 2: Enrich
      log(`🤖 ${label} — Claude ile zenginleştiriliyor...`)
      const enrichBody: any = {
        products: [{
          product_id: product.id,
          title: product.title,
          body_html: product.descriptionHtml,
          tags: product.tags,
          vendor: product.vendor,
          product_type: product.productType,
          images: product.images.slice(0, 3),
          variants: product.variants.map((v) => ({
            id: v.id,
            title: v.title,
            sku: v.sku,
            price: v.price,
            compare_at_price: v.compareAtPrice,
            option1: v.options[0]?.value || null,
            option2: v.options[1]?.value || null,
          })),
          collections: product.collections,
          ...(visionData && { vision_analysis: visionData }),
        }],
        mode,
      }

      const eRes = await fetch('/api/enrich-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(enrichBody),
      })
      const eData = await eRes.json()
      if (!eData.success) throw new Error(eData.error || 'Enrichment başarısız')

      setTotalUsage((prev) => ({
        input_tokens: prev.input_tokens + (eData.usage?.input_tokens || 0),
        output_tokens: prev.output_tokens + (eData.usage?.output_tokens || 0),
      }))

      const result = eData.results?.[0]
      if (!result) throw new Error('Claude boş sonuç döndürdü')

      // Dry-run mode → sadece kaydet, Shopify'a yazma
      if (mode === 'dry_run') {
        setDryRunResults((prev) => [...prev, { product: product.title, ...result }])
        log(`✅ ${label} — Dry-run önizleme kaydedildi`)
        return true
      }

      // Check pause
      if (pauseRef.current) return false

      // Step 3: Save to Shopify
      log(`💾 ${label} — Shopify'a kaydediliyor...`)
      const sRes = await fetch('/api/save-metafields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          enrichment: result,
          updateTitle: mode === 'overwrite',
          updateDescription: mode === 'overwrite' || !product.descriptionHtml || product.descriptionHtml.length < 200,
          productData: {
            variants: product.variants.map((v) => ({
              id: v.id,
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              options: v.options,
              selectedOptions: v.options,
            })),
          },
        }),
      })
      const sData = await sRes.json()
      if (!sData.success && sData.errors?.length > 0) {
        log(`⚠️ ${label} — ${sData.fieldsWritten} alan yazıldı, ${sData.errors.length} hata`)
      } else {
        log(`✅ ${label} — ${sData.fieldsWritten} alan başarıyla yazıldı`)
      }

      // Step 4: Meta Catalog sync (BUG 0 FIX)
      if (pauseRef.current) return true // Shopify save başarılı, Meta opsiyonel

      const g = result.google || {}
      const m = result.meta || {}
      const metaItems = product.variants.map((v) => ({
        retailer_id: v.numericId,
        enrichment: {
          gender: g.gender || 'female',
          age_group: g.age_group || 'adult',
          color: g.color,
          size: v.options.find((o: any) =>
            ['boyut', 'beden', 'size'].includes(o.name.toLowerCase())
          )?.value || g.size || 'Tek Beden',
          material: g.material,
          pattern: g.pattern,
          fb_product_category: m.fb_product_category,
          short_description: m.short_description,
          custom_label_0: g.custom_label_0,
          custom_label_1: g.custom_label_1,
          custom_label_2: g.custom_label_2,
          custom_label_3: g.custom_label_3,
          custom_label_4: g.custom_label_4,
          shipping_weight_value: g.shipping_weight?.match(/^(\d+)/)?.[1] || '250',
          shipping_weight_unit: 'g',
          return_policy_days: m.return_policy_days || '15',
        },
      }))

      try {
        log(`📡 ${label} — Meta Catalog sync...`)
        const mRes = await fetch('/api/sync-meta-catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: metaItems }),
        })
        const mData = await mRes.json()
        if (mData.skipped) {
          log(`⏭️ ${label} — Meta sync atlandı (env var eksik)`)
        } else if (mData.success) {
          log(`✅ ${label} — Meta Catalog sync başarılı`)
        } else {
          log(`⚠️ ${label} — Meta sync: ${mData.error || 'bilinmeyen hata'}`)
        }
      } catch {
        log(`⚠️ ${label} — Meta sync hatası, Shopify kaydı korundu`)
      }

      // Step 5: Google Merchant API sync
      if (pauseRef.current) return true

      const googleItems = product.variants.map((v) => ({
        productId: product.numericId,
        variantId: v.numericId,
        enrichment: {
          gender: g.gender || 'female',
          age_group: g.age_group || 'adult',
          color: g.color,
          size: v.options.find((o: any) =>
            ['boyut', 'beden', 'size'].includes(o.name.toLowerCase())
          )?.value || g.size || 'Tek Beden',
          material: g.material,
          pattern: g.pattern,
          product_type: g.product_type,
          custom_label_0: g.custom_label_0,
          custom_label_1: g.custom_label_1,
          custom_label_2: g.custom_label_2,
          custom_label_3: g.custom_label_3,
          custom_label_4: g.custom_label_4,
        },
      }))

      try {
        log(`🔍 ${label} — Google Merchant sync...`)
        const gRes = await fetch('/api/sync-google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: googleItems }),
        })
        const gData = await gRes.json()
        if (gData.skipped) {
          log(`⏭️ ${label} — Google sync atlandı (env var eksik)`)
        } else if (gData.success) {
          log(`✅ ${label} — Google Merchant sync başarılı (${gData.successCount}/${gData.total} variant)`)
        } else {
          log(`⚠️ ${label} — Google sync: ${gData.successCount || 0}/${gData.total || 0} başarılı${gData.errors?.length ? ` — ${gData.errors[0]?.error}` : ''}`)
        }
      } catch {
        log(`⚠️ ${label} — Google sync hatası, Shopify + Meta kayıtları korundu`)
      }

      return true
    } catch (err: any) {
      log(`❌ ${label} — Hata: ${err.message}`)
      return false
    }
  }

  // ─── Main processing loop ───
  const startProcessing = async (productsToProcess?: ProductData[]) => {
    const queue = productsToProcess || selectedProducts
    if (!queue.length) {
      addToast({ type: 'info', message: 'Seçili ürün yok.' })
      return
    }

    setIsProcessing(true)
    setIsPaused(false)
    pauseRef.current = false
    setProgress({ total: queue.length, done: 0, success: 0, failed: 0 })
    setProcessLog([])
    setFailedQueue([])
    setDryRunResults([])
    setTotalUsage({ input_tokens: 0, output_tokens: 0 })

    log(`🚀 ${queue.length} ürün işlenecek (mode: ${mode}, vision: ${visionEnabled ? 'açık' : 'kapalı'})`)

    let consecutiveErrors = 0
    let done = 0
    let success = 0
    let failed = 0
    const errors: EnrichmentProgress['failedQueue'] = []

    // Process in groups of CONCURRENCY
    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      if (pauseRef.current) {
        log(`⏸️ İşlem duraklatıldı (${done}/${queue.length})`)
        break
      }

      const batch = queue.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        batch.map(async (product) => {
          const ok = await processProduct(product)
          return { product, ok }
        })
      )

      for (const r of results) {
        done++
        if (r.status === 'fulfilled' && r.value.ok) {
          success++
          consecutiveErrors = 0
        } else {
          failed++
          consecutiveErrors++
          const p = r.status === 'fulfilled' ? r.value.product : batch[0]
          const errMsg = r.status === 'rejected' ? r.reason?.message : 'İşlem başarısız'
          errors.push({ productId: p.id, title: p.title, error: errMsg, retryCount: 0 })

          // Circuit breaker
          if (consecutiveErrors >= 5) {
            log(`🛑 5 ardışık hata! İşlem duraklatıldı. Kontrol edin.`)
            pauseRef.current = true
            setIsPaused(true)
            addToast({ type: 'error', message: '5 ardışık hata — işlem duraklatıldı!' })
            break
          }
        }
      }

      setProgress({ total: queue.length, done, success, failed })
      setFailedQueue([...errors])

      // Save progress to localStorage
      const progressData: EnrichmentProgress = {
        cursor: null,
        processedIds: queue.slice(0, i + CONCURRENCY).map((p) => p.id),
        successCount: success,
        failedCount: failed,
        failedQueue: errors,
        startedAt: new Date().toISOString(),
        settings: { platforms, mode, visionEnabled },
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progressData))
    }

    if (!pauseRef.current) {
      log(`🏁 Tamamlandı! ${success} başarılı, ${failed} hatalı`)
      localStorage.removeItem(STORAGE_KEY)
    }

    setIsProcessing(false)
  }

  const handlePause = () => {
    pauseRef.current = true
    setIsPaused(true)
    log('⏸️ Duraklama istendi...')
  }

  const handleResume = () => {
    pauseRef.current = false
    setIsPaused(false)
    const remaining = selectedProducts.filter(
      (p) => !failedQueue.find((f) => f.productId === p.id)
    )
    startProcessing(remaining)
  }

  const handleRetryFailed = () => {
    const failedProducts = products.filter((p) =>
      failedQueue.find((f) => f.productId === p.id)
    )
    if (failedProducts.length) startProcessing(failedProducts)
  }

  // ─── Dry-run download ───
  const downloadDryRun = (format: 'json' | 'csv') => {
    let content: string
    let mime: string
    let ext: string

    if (format === 'json') {
      content = JSON.stringify(dryRunResults, null, 2)
      mime = 'application/json'
      ext = 'json'
    } else {
      const headers = ['product', 'google_category', 'product_type', 'color', 'material', 'pattern', 'short_description']
      const rows = dryRunResults.map((r) => [
        r.product,
        r.google?.google_product_category,
        r.google?.product_type,
        r.google?.color,
        r.google?.material,
        r.google?.pattern,
        r.meta?.short_description?.slice(0, 100),
      ].map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','))
      content = [headers.join(','), ...rows].join('\n')
      mime = 'text/csv'
      ext = 'csv'
    }

    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `enrichment_dryrun.${ext}`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Dismiss saved progress
  const dismissSaved = () => {
    localStorage.removeItem(STORAGE_KEY)
    setSavedProgress(null)
  }

  const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  // ─── Render ───
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">AI Product Enrichment</h1>
        <p className="page-desc">
          Google Shopping ve Meta Catalog alanlarını Claude AI ile otomatik doldurur
        </p>
      </div>

      <div className="page-body">
        {/* Resume banner */}
        {savedProgress && !isProcessing && (
          <div className="alert alert-info" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Yarım kalan işlem bulundu:</strong> {savedProgress.successCount} başarılı, {savedProgress.failedCount} hatalı
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-primary" onClick={() => { dismissSaved() }}>Yoksay</button>
            </div>
          </div>
        )}

        {/* ─── Filter Card ─── */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">📋 Ürün Filtresi</div>

          <div className="form-row" style={{ marginBottom: 16 }}>
            {/* Status */}
            <div className="form-group">
              <label className="form-label">Statü</label>
              <div style={{ display: 'flex', gap: 12 }}>
                {['active', 'draft', 'archived'].map((s) => (
                  <label key={s} className="checkbox-row">
                    <input type="checkbox" checked={statusFilter.includes(s)}
                      onChange={(e) => {
                        setStatusFilter((prev) =>
                          e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)
                        )
                      }} />
                    {s === 'active' ? 'Aktif' : s === 'draft' ? 'Taslak' : 'Arşiv'}
                  </label>
                ))}
              </div>
            </div>

            {/* Collection */}
            <div className="form-group">
              <label className="form-label">Koleksiyon</label>
              <select className="form-select" value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}>
                <option value="">Tümü</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.title} ({c.productsCount})</option>
                ))}
              </select>
            </div>
          </div>

          {/* Tags */}
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 2 }}>
              <label className="form-label">Etiketler</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" placeholder="Tag yazın + Enter"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())} />
                <button className="btn btn-sm" onClick={addTag}>Ekle</button>
              </div>
              {selectedTags.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {selectedTags.map((t) => (
                    <span key={t} className="tag-chip">
                      {t} <button onClick={() => removeTag(t)}>×</button>
                    </span>
                  ))}
                  <label className="checkbox-row" style={{ marginLeft: 12 }}>
                    <input type="radio" name="tagMode" checked={tagMode === 'any'}
                      onChange={() => setTagMode('any')} /> Herhangi biri
                  </label>
                  <label className="checkbox-row">
                    <input type="radio" name="tagMode" checked={tagMode === 'all'}
                      onChange={() => setTagMode('all')} /> Tümü
                  </label>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Enrichment Durumu</label>
              <select className="form-select" value={enrichmentFilter}
                onChange={(e) => setEnrichmentFilter(e.target.value)}>
                <option value="all">Tümü</option>
                <option value="none">Hiç işlenmemişler</option>
                <option value="missing">Eksik alanları olanlar</option>
                <option value="error">Hatalı olanlar</option>
              </select>
            </div>
          </div>

          <button className="btn btn-primary" onClick={handleFilter}
            disabled={loadingProducts || isProcessing}>
            {loadingProducts ? <><span className="spinner" /> Yükleniyor...</> : '🔍 Filtrele'}
          </button>
          {products.length > 0 && (
            <span style={{ marginLeft: 12, color: 'var(--text-muted)' }}>
              {products.length} ürün bulundu
            </span>
          )}
        </div>

        {/* ─── Product Table ─── */}
        {products.length > 0 && !isProcessing && (
          <>
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>📦 Ürün Seçimi</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-sm" onClick={selectAll}>Tümünü Seç ({products.length})</button>
                  <button className="btn btn-sm" onClick={selectNone}>Hiçbirini Seçme</button>
                </div>
              </div>

              <div className="table-wrapper" style={{ maxHeight: 400, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}>✓</th>
                      <th>Ürün</th>
                      <th>Statü</th>
                      <th>Variant</th>
                      <th>Enrichment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input type="checkbox" checked={selectedIds.has(p.id)}
                            onChange={() => toggleSelect(p.id)} />
                        </td>
                        <td className="td-name" title={p.title}>{p.title}</td>
                        <td><span className={`badge badge-${p.status}`}>{p.status}</span></td>
                        <td>{p.variants.length}</td>
                        <td>
                          {p.enrichment.status ? (
                            p.enrichment.needsReview ? (
                              <span className="badge badge-draft">İnceleme</span>
                            ) : (
                              <span className="badge badge-active">Tamam</span>
                            )
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>
                Seçili: <strong>{selectedIds.size}</strong> ürün
              </div>
            </div>

            {/* ─── Settings ─── */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-title">⚙️ İşlem Ayarları</div>

              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">Hedef Platform</label>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={platforms.google}
                        onChange={(e) => setPlatforms((p) => ({ ...p, google: e.target.checked }))} />
                      Google Shopping
                    </label>
                    <label className="checkbox-row">
                      <input type="checkbox" checked={platforms.meta}
                        onChange={(e) => setPlatforms((p) => ({ ...p, meta: e.target.checked }))} />
                      Meta (FB/IG)
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">İşlem Modu</label>
                  <select className="form-select" value={mode}
                    onChange={(e) => setMode(e.target.value)}>
                    <option value="fill_empty">Sadece boş alanları doldur</option>
                    <option value="overwrite">Tüm alanları yeniden oluştur</option>
                    <option value="dry_run">Dry-run (önizleme, kaydetme)</option>
                  </select>
                </div>
              </div>

              <div className="form-row" style={{ marginBottom: 16 }}>
                <div className="form-group">
                  <label className="form-label">🔍 Görsel Analiz (Vision)</label>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={visionEnabled}
                      onChange={(e) => setVisionEnabled(e.target.checked)} />
                    Aktif — renk, materyal, desen otomatik tespit
                  </label>
                  {visionEnabled && (
                    <span className="form-hint">⚠️ Vision aktifken süre ~%40 artar</span>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">AI Model</label>
                  <div style={{ padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                    Claude Sonnet 4.6 (sabit)
                  </div>
                </div>
              </div>

              {/* Cost estimate */}
              {selectedIds.size > 0 && (
                <div className="cost-estimate">
                  <span>📊 Seçili: <strong>{costEstimate.count}</strong> ürün</span>
                  <span>💰 Tahmini: <strong>~${costEstimate.cost}</strong></span>
                  <span>⏱️ Süre: <strong>~{costEstimate.timeMin} dk</strong></span>
                </div>
              )}

              <div className="btn-row" style={{ marginTop: 16 }}>
                <button className="btn btn-success"
                  onClick={() => startProcessing()}
                  disabled={isProcessing || selectedIds.size === 0}>
                  ▶ Enrichment Başlat
                </button>
              </div>
            </div>
          </>
        )}

        {/* ─── Processing Panel ─── */}
        {(isProcessing || progress.done > 0) && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">
              {isProcessing ? '🔄 İşleniyor...' : '✅ Enrichment Tamamlandı'}
            </div>

            <div className="progress-bar-track" style={{ marginBottom: 12 }}>
              <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 16 }}>
              <span>İlerleme: {progress.done}/{progress.total} ({progressPct}%)</span>
              <span style={{ color: 'var(--success)' }}>✓ {progress.success}</span>
              <span style={{ color: 'var(--error)' }}>✕ {progress.failed}</span>
            </div>

            {/* Token usage */}
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Token: {totalUsage.input_tokens.toLocaleString()} input + {totalUsage.output_tokens.toLocaleString()} output
              {' '}≈ ${((totalUsage.input_tokens * 3 + totalUsage.output_tokens * 15) / 1_000_000).toFixed(3)}
            </div>

            {/* Controls */}
            {isProcessing && (
              <div className="btn-row" style={{ marginBottom: 16 }}>
                {!isPaused ? (
                  <button className="btn btn-sm" onClick={handlePause}>⏸️ Duraklat</button>
                ) : (
                  <button className="btn btn-sm btn-primary" onClick={handleResume}>▶ Devam Et</button>
                )}
              </div>
            )}

            {/* Failed queue */}
            {failedQueue.length > 0 && !isProcessing && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>❌ Hatalı Ürünler ({failedQueue.length})</div>
                <div style={{ maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
                  {failedQueue.map((f) => (
                    <div key={f.productId} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                      <strong>{f.title}</strong>: {f.error}
                    </div>
                  ))}
                </div>
                <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }}
                  onClick={handleRetryFailed}>
                  🔄 {failedQueue.length} Hatalıyı Tekrar Dene
                </button>
              </div>
            )}

            {/* Dry-run download */}
            {mode === 'dry_run' && dryRunResults.length > 0 && !isProcessing && (
              <div className="btn-row" style={{ marginBottom: 16 }}>
                <button className="btn btn-sm" onClick={() => downloadDryRun('json')}>
                  📥 JSON İndir ({dryRunResults.length} ürün)
                </button>
                <button className="btn btn-sm" onClick={() => downloadDryRun('csv')}>
                  📥 CSV İndir
                </button>
              </div>
            )}

            {/* Log */}
            <div className="enrichment-log" style={{ maxHeight: 200, overflow: 'auto', fontSize: 12, fontFamily: 'monospace', background: 'var(--bg-body)', padding: 12, borderRadius: 8 }}>
              {processLog.map((line, i) => (
                <div key={i} style={{ padding: '2px 0' }}>{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {products.length === 0 && !loadingProducts && !isProcessing && (
          <div className="empty-state">
            <div className="empty-state-icon">🧠</div>
            <div className="empty-state-text">
              Filtreleri ayarlayıp "Filtrele" butonuna basın
            </div>
          </div>
        )}
      </div>
    </>
  )
}
