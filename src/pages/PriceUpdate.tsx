import { useState, useEffect, useRef } from 'react'
import type { ToastData } from '../components/Toast'

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

type FilterType = 'whole_store' | 'collection' | 'products' | 'on_sale' | 'tag'

interface Collection { id: string; title: string; productsCount: number }

interface PreviewVariant {
  id: string; title: string
  oldPrice: number; newPrice: number
  oldCompare: number; newCompare: number
}
interface PreviewProduct {
  id: string; title: string
  variants: PreviewVariant[]
}

interface UpdateItem {
  variantId: string; price: string; comparePrice: string | null
  done?: boolean; failed?: boolean
}

const BATCH_SIZE = 20

export default function PriceUpdate({ addToast }: Props) {
  const [filter, setFilter] = useState<FilterType>('whole_store')
  const [percentage, setPercentage] = useState('')
  const [updatePrice, setUpdatePrice] = useState(true)
  const [updateCompare, setUpdateCompare] = useState(true)
  const [productStatus, setProductStatus] = useState('any')

  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollection, setSelectedCollection] = useState('')
  const [tag, setTag] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [allProducts, setAllProducts] = useState<{ id: string; title: string }[]>([])
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewProduct[] | null>(null)
  const [totalVariants, setTotalVariants] = useState(0)

  // Apply state - chunked
  const [updates, setUpdates] = useState<UpdateItem[]>([])
  const [applying, setApplying] = useState(false)
  const [applyProgress, setApplyProgress] = useState({ done: 0, failed: 0, total: 0 })
  const [applyPaused, setApplyPaused] = useState(false)
  const [applyComplete, setApplyComplete] = useState(false)
  const pauseRef = useRef(false)
  const abortRef = useRef(false)

  useEffect(() => {
    fetch('/api/get-collections').then(r => r.json()).then(data => setCollections(data.collections || [])).catch(() => {})
  }, [])

  const loadProducts = async () => {
    try {
      const res = await fetch('/api/get-products?status=any')
      const data = await res.json()
      setAllProducts((data.products || []).map((p: any) => ({ id: String(p.id), title: p.title })))
    } catch {}
  }

  useEffect(() => { if (filter === 'products') loadProducts() }, [filter])

  // Önizleme
  const handlePreview = async () => {
    if (!percentage) { addToast({ type: 'error', message: 'Yüzde değeri girin' }); return }
    setLoading(true); setPreview(null); setUpdates([]); setApplyComplete(false)
    setApplyProgress({ done: 0, failed: 0, total: 0 })

    try {
      const body: any = { action: 'preview', filter, percentage, updatePrice, updateCompare, productStatus }
      if (filter === 'collection') body.collectionId = selectedCollection
      if (filter === 'products') body.productIds = selectedProductIds
      if (filter === 'tag') body.tag = tag

      const res = await fetch('/api/update-prices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error)

      setPreview(data.products)
      setTotalVariants(data.totalVariants)

      // Prepare update items
      const items: UpdateItem[] = data.products.flatMap((p: PreviewProduct) =>
        p.variants.map((v: PreviewVariant) => ({
          variantId: v.id,
          price: updatePrice ? String(v.newPrice) : String(v.oldPrice),
          comparePrice: updateCompare ? (v.newCompare > 0 ? String(v.newCompare) : null) : (v.oldCompare > 0 ? String(v.oldCompare) : null),
        }))
      )
      setUpdates(items)
      addToast({ type: 'success', message: `${data.products.length} ürün, ${data.totalVariants} varyant bulundu` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally { setLoading(false) }
  }

  // Chunked apply
  const handleApply = async (resumeFromIndex?: number) => {
    if (!updates.length) return
    setApplying(true); setApplyPaused(false); setApplyComplete(false)
    pauseRef.current = false; abortRef.current = false

    const startIdx = resumeFromIndex || 0
    const remaining = updates.slice(startIdx)
    let totalDone = applyProgress.done
    let totalFailed = applyProgress.failed
    const total = updates.length

    setApplyProgress({ done: totalDone, failed: totalFailed, total })

    for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
      // Check pause/abort
      if (abortRef.current) {
        addToast({ type: 'info', message: `Durduruldu. ${totalDone} güncellendi, ${total - totalDone - totalFailed} kaldı.` })
        setApplying(false); setApplyPaused(true); return
      }

      if (pauseRef.current) {
        // Wait for resume
        while (pauseRef.current && !abortRef.current) {
          await new Promise(r => setTimeout(r, 300))
        }
        if (abortRef.current) {
          setApplying(false); setApplyPaused(true); return
        }
      }

      const batch = remaining.slice(i, i + BATCH_SIZE)
      const batchUpdates = batch.map(u => ({
        variantId: u.variantId, price: u.price, comparePrice: u.comparePrice,
      }))

      try {
        const res = await fetch('/api/update-prices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply', updates: batchUpdates }),
        })
        const data = await res.json()

        if (!data.success) throw new Error(data.error)
        totalDone += data.updated
        totalFailed += data.failed

        // Mark items as done
        setUpdates(prev => {
          const next = [...prev]
          const globalStart = startIdx + i
          for (let j = 0; j < batch.length; j++) {
            if (next[globalStart + j]) {
              next[globalStart + j] = { ...next[globalStart + j], done: true }
            }
          }
          return next
        })
      } catch {
        totalFailed += batch.length
        setUpdates(prev => {
          const next = [...prev]
          const globalStart = startIdx + i
          for (let j = 0; j < batch.length; j++) {
            if (next[globalStart + j]) {
              next[globalStart + j] = { ...next[globalStart + j], failed: true }
            }
          }
          return next
        })
      }

      setApplyProgress({ done: totalDone, failed: totalFailed, total })
    }

    setApplying(false); setApplyComplete(true)
    addToast({ type: 'success', message: `Tamamlandı! ${totalDone} güncellendi${totalFailed > 0 ? `, ${totalFailed} başarısız` : ''}` })
  }

  // Resume — kaldığı yerden devam
  const handleResume = () => {
    const firstPendingIdx = updates.findIndex(u => !u.done && !u.failed)
    if (firstPendingIdx === -1) { addToast({ type: 'info', message: 'Güncellenecek varyant kalmadı' }); return }
    handleApply(firstPendingIdx)
  }

  // Pause
  const handlePause = () => { pauseRef.current = true; abortRef.current = true }

  // Retry failed
  const handleRetryFailed = async () => {
    const failedItems = updates.filter(u => u.failed)
    if (!failedItems.length) { addToast({ type: 'info', message: 'Başarısız varyant yok' }); return }

    setApplying(true)
    let retryDone = 0, retryFailed = 0

    for (let i = 0; i < failedItems.length; i += BATCH_SIZE) {
      const batch = failedItems.slice(i, i + BATCH_SIZE)
      try {
        const res = await fetch('/api/update-prices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply', updates: batch.map(u => ({ variantId: u.variantId, price: u.price, comparePrice: u.comparePrice })) }),
        })
        const data = await res.json()
        if (data.success) { retryDone += data.updated; retryFailed += data.failed }
        else retryFailed += batch.length
      } catch { retryFailed += batch.length }
    }

    setApplyProgress(prev => ({ ...prev, done: prev.done + retryDone, failed: prev.failed - retryDone }))
    setApplying(false)
    addToast({ type: retryDone > 0 ? 'success' : 'error', message: `Retry: ${retryDone} başarılı, ${retryFailed} hala başarısız` })
  }

  const toggleProduct = (id: string) => {
    setSelectedProductIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])
  }

  const filteredSearchProducts = productSearch
    ? allProducts.filter(p => p.title.toLowerCase().includes(productSearch.toLowerCase())) : allProducts

  const progressPct = applyProgress.total > 0 ? Math.round((applyProgress.done + applyProgress.failed) / applyProgress.total * 100) : 0

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">💰 Fiyat Güncelleme</h1>
        <p className="page-desc">Toplu fiyat güncelleme — % bazında artış/azalış, en yakın ₺100'e yuvarlama</p>
      </div>

      <div className="page-body">
        {/* Filtre Seçimi */}
        <div className="card">
          <div className="card-title" style={{ fontSize: 15 }}>🎯 Filtre</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {([
              { value: 'whole_store', label: '🏪 Tüm Mağaza' },
              { value: 'collection', label: '📁 Koleksiyon' },
              { value: 'products', label: '📦 Seçili Ürünler' },
              { value: 'on_sale', label: '🏷️ İndirimli Ürünler' },
              { value: 'tag', label: '#️⃣ Tag' },
            ] as const).map(f => (
              <button key={f.value} className={`btn ${filter === f.value ? 'btn-primary' : ''}`}
                onClick={() => setFilter(f.value)} style={{ fontSize: 12, padding: '8px 16px' }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Ürün Durumu */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600 }}>Ürün Durumu</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { value: 'any', label: '🔄 Hepsi' },
                { value: 'active', label: '✅ Aktif' },
                { value: 'draft', label: '📝 Taslak' },
                { value: 'archived', label: '📦 Arşiv' },
              ].map(s => (
                <button key={s.value} className={`btn ${productStatus === s.value ? 'btn-primary' : ''}`}
                  onClick={() => setProductStatus(s.value)} style={{ fontSize: 11, padding: '5px 12px' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {filter === 'collection' && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Koleksiyon</label>
              <select className="form-input" value={selectedCollection} onChange={e => setSelectedCollection(e.target.value)}>
                <option value="">Koleksiyon seçin...</option>
                {collections.map(c => <option key={c.id} value={c.id}>{c.title} ({c.productsCount})</option>)}
              </select>
            </div>
          )}

          {filter === 'tag' && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Tag</label>
              <input className="form-input" placeholder="Etiketi girin..." value={tag} onChange={e => setTag(e.target.value)} />
            </div>
          )}

          {filter === 'products' && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Ürün Ara ({selectedProductIds.length} seçili)</label>
                <input className="form-input" placeholder="Ürün adı ile ara..." value={productSearch}
                  onChange={e => setProductSearch(e.target.value)} />
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }}>
                {filteredSearchProducts.slice(0, 50).map(p => (
                  <label key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
                    fontSize: 12, borderRadius: 4, background: selectedProductIds.includes(p.id) ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                  }}>
                    <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProduct(p.id)} />
                    {p.title}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Yüzde ve Seçenekler */}
        <div className="card">
          <div className="card-title" style={{ fontSize: 15 }}>📊 Güncelleme Ayarları</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
            <div className="form-group" style={{ flex: 1, minWidth: 180 }}>
              <label className="form-label">Yüzde (%) — pozitif: artır, negatif: azalt</label>
              <input className="form-input" type="number" placeholder="+10 veya -15" value={percentage}
                onChange={e => setPercentage(e.target.value)}
                style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={updatePrice} onChange={e => setUpdatePrice(e.target.checked)} />
                💵 Price güncelle
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={updateCompare} onChange={e => setUpdateCompare(e.target.checked)} />
                🏷️ Compare Price güncelle
              </label>
            </div>
          </div>
          <button className="btn btn-primary" onClick={handlePreview} disabled={loading}
            style={{ width: '100%', fontSize: 14, padding: '12px 20px' }}>
            {loading ? <><span className="spinner" /> Ürünler yükleniyor...</> : '👁️ Önizle'}
          </button>
        </div>

        {/* Önizleme Tablosu */}
        {preview && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-title" style={{ fontSize: 15, margin: 0 }}>
                📋 Önizleme — {preview.length} ürün, {totalVariants} varyant
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {parseFloat(percentage) > 0 ? `⬆️ %${percentage} artış` : `⬇️ %${Math.abs(parseFloat(percentage))} azalış`}
                {' • '}En yakın ₺100'e yuvarlanır
              </div>
            </div>

            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg-card)' }}>
                    <th style={{ padding: 8, textAlign: 'left' }}>Ürün</th>
                    <th style={{ padding: 8, textAlign: 'left' }}>Varyant</th>
                    {updatePrice && <th style={{ padding: 8, textAlign: 'right' }}>Eski Fiyat</th>}
                    {updatePrice && <th style={{ padding: 8, textAlign: 'right' }}>Yeni Fiyat</th>}
                    {updateCompare && <th style={{ padding: 8, textAlign: 'right' }}>Eski Kıyaslama</th>}
                    {updateCompare && <th style={{ padding: 8, textAlign: 'right' }}>Yeni Kıyaslama</th>}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 100).map(p =>
                    p.variants.map((v, vIdx) => (
                      <tr key={`${p.id}-${v.id}`} style={{ borderBottom: '1px solid var(--border)' }}>
                        {vIdx === 0 && (
                          <td style={{ padding: 8, fontWeight: 600 }} rowSpan={p.variants.length}>{p.title}</td>
                        )}
                        <td style={{ padding: 8, color: 'var(--text-muted)' }}>{v.title}</td>
                        {updatePrice && <td style={{ padding: 8, textAlign: 'right' }}>₺{v.oldPrice.toLocaleString()}</td>}
                        {updatePrice && (
                          <td style={{ padding: 8, textAlign: 'right', fontWeight: 700,
                            color: v.newPrice > v.oldPrice ? '#16a34a' : v.newPrice < v.oldPrice ? '#dc2626' : 'inherit',
                          }}>₺{v.newPrice.toLocaleString()}</td>
                        )}
                        {updateCompare && <td style={{ padding: 8, textAlign: 'right' }}>₺{v.oldCompare.toLocaleString()}</td>}
                        {updateCompare && (
                          <td style={{ padding: 8, textAlign: 'right', fontWeight: 700,
                            color: v.newCompare > v.oldCompare ? '#16a34a' : v.newCompare < v.oldCompare ? '#dc2626' : 'inherit',
                          }}>₺{v.newCompare.toLocaleString()}</td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {preview.length > 100 && (
                <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  ... ve {preview.length - 100} ürün daha
                </div>
              )}
            </div>

            {/* Progress Bar */}
            {(applying || applyProgress.total > 0) && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>
                    {applying ? '⏳ Güncelleniyor...' : applyComplete ? '✅ Tamamlandı' : '⏸️ Duraklatıldı'}
                  </span>
                  <span>
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>{applyProgress.done}</span> başarılı
                    {applyProgress.failed > 0 && <> / <span style={{ color: '#dc2626', fontWeight: 700 }}>{applyProgress.failed}</span> başarısız</>}
                    {' / '}{applyProgress.total} toplam
                  </span>
                </div>
                {/* Bar */}
                <div style={{ height: 8, borderRadius: 4, background: '#e5e7eb', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 4, transition: 'width .3s',
                    width: `${progressPct}%`,
                    background: applyProgress.failed > 0 ? 'linear-gradient(90deg, #16a34a, #f59e0b)' : '#16a34a',
                  }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'center' }}>
                  %{progressPct} — Batch: {BATCH_SIZE} varyant/istek
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {!applying && !applyComplete && applyProgress.total === 0 && (
                <button className="btn" onClick={() => handleApply()} disabled={applying}
                  style={{ flex: 1, fontSize: 14, padding: '14px 20px', background: 'var(--danger)', color: '#fff', fontWeight: 700 }}>
                  🚀 {totalVariants} Varyantı Güncelle
                </button>
              )}

              {applying && (
                <button className="btn" onClick={handlePause}
                  style={{ flex: 1, fontSize: 14, padding: '14px 20px', background: '#f59e0b', color: '#fff', fontWeight: 700 }}>
                  ⏸️ Duraklat
                </button>
              )}

              {!applying && applyPaused && (
                <>
                  <button className="btn btn-primary" onClick={handleResume}
                    style={{ flex: 1, fontSize: 14, padding: '14px 20px', fontWeight: 700 }}>
                    ▶️ Devam Et ({updates.filter(u => !u.done && !u.failed).length} kaldı)
                  </button>
                  {applyProgress.failed > 0 && (
                    <button className="btn" onClick={handleRetryFailed}
                      style={{ fontSize: 14, padding: '14px 20px', background: '#f59e0b', color: '#fff', fontWeight: 700 }}>
                      🔄 Başarısızları Tekrarla ({applyProgress.failed})
                    </button>
                  )}
                </>
              )}

              {applyComplete && (
                <div style={{
                  flex: 1, padding: 16, borderRadius: 8, textAlign: 'center',
                  background: applyProgress.failed === 0 ? '#e8f5e9' : '#fff3e0',
                }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>{applyProgress.failed === 0 ? '✅' : '⚠️'}</div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {applyProgress.done} varyant güncellendi
                    {applyProgress.failed > 0 && (
                      <>
                        , {applyProgress.failed} başarısız
                        <button className="btn btn-sm" onClick={handleRetryFailed} style={{ marginLeft: 8, fontSize: 11 }}>
                          🔄 Tekrarla
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
