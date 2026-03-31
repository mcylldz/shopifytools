import { useState, useEffect } from 'react'
import type { ToastData } from '../components/Toast'

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

type FilterType = 'whole_store' | 'collection' | 'products' | 'on_sale' | 'tag'

interface Collection {
  id: string
  title: string
  productsCount: number
}

interface PreviewVariant {
  id: string
  title: string
  oldPrice: number
  newPrice: number
  oldCompare: number
  newCompare: number
}

interface PreviewProduct {
  id: string
  title: string
  variants: PreviewVariant[]
}

export default function PriceUpdate({ addToast }: Props) {
  const [filter, setFilter] = useState<FilterType>('whole_store')
  const [percentage, setPercentage] = useState('')
  const [updatePrice, setUpdatePrice] = useState(true)
  const [updateCompare, setUpdateCompare] = useState(true)

  const [collections, setCollections] = useState<Collection[]>([])
  const [selectedCollection, setSelectedCollection] = useState('')
  const [tag, setTag] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [allProducts, setAllProducts] = useState<{ id: string; title: string }[]>([])
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])

  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewProduct[] | null>(null)
  const [totalVariants, setTotalVariants] = useState(0)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ updated: number; failed: number } | null>(null)

  // Koleksiyonları yükle
  useEffect(() => {
    fetch('/api/get-collections')
      .then((r) => r.json())
      .then((data) => setCollections(data.collections || []))
      .catch(() => {})
  }, [])

  // Ürünleri yükle (ürün seçme modu)
  const loadProducts = async () => {
    try {
      const res = await fetch('/api/get-products?status=any')
      const data = await res.json()
      setAllProducts((data.products || []).map((p: any) => ({ id: String(p.id), title: p.title })))
    } catch {}
  }

  useEffect(() => {
    if (filter === 'products') loadProducts()
  }, [filter])

  // Önizleme
  const handlePreview = async () => {
    if (!percentage) { addToast({ type: 'error', message: 'Yüzde değeri girin' }); return }

    setLoading(true)
    setPreview(null)
    setApplyResult(null)

    try {
      const body: any = {
        action: 'preview',
        filter,
        percentage,
        updatePrice,
        updateCompare,
      }

      if (filter === 'collection') body.collectionId = selectedCollection
      if (filter === 'products') body.productIds = selectedProductIds
      if (filter === 'tag') body.tag = tag

      const res = await fetch('/api/update-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!data.success) throw new Error(data.error)

      setPreview(data.products)
      setTotalVariants(data.totalVariants)
      addToast({ type: 'success', message: `${data.products.length} ürün, ${data.totalVariants} varyant bulundu` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setLoading(false)
    }
  }

  // Uygula
  const handleApply = async () => {
    if (!preview) return

    const updates = preview.flatMap((p) =>
      p.variants.map((v) => ({
        variantId: v.id,
        price: updatePrice ? String(v.newPrice) : String(v.oldPrice),
        comparePrice: updateCompare ? (v.newCompare > 0 ? String(v.newCompare) : null) : (v.oldCompare > 0 ? String(v.oldCompare) : null),
      }))
    )

    setApplying(true)
    try {
      const res = await fetch('/api/update-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'apply', updates }),
      })
      const data = await res.json()

      if (!data.success) throw new Error(data.error)

      setApplyResult({ updated: data.updated, failed: data.failed })
      addToast({ type: 'success', message: `${data.updated} varyant güncellendi` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setApplying(false)
    }
  }

  const toggleProduct = (id: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  const filteredSearchProducts = productSearch
    ? allProducts.filter((p) => p.title.toLowerCase().includes(productSearch.toLowerCase()))
    : allProducts

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
            ] as const).map((f) => (
              <button key={f.value} className={`btn ${filter === f.value ? 'btn-primary' : ''}`}
                onClick={() => setFilter(f.value)}
                style={{ fontSize: 12, padding: '8px 16px' }}>
                {f.label}
              </button>
            ))}
          </div>

          {/* Koleksiyon Seçimi */}
          {filter === 'collection' && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Koleksiyon</label>
              <select className="form-input" value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)}>
                <option value="">Koleksiyon seçin...</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>{c.title} ({c.productsCount})</option>
                ))}
              </select>
            </div>
          )}

          {/* Tag Girişi */}
          {filter === 'tag' && (
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Tag</label>
              <input className="form-input" placeholder="Etiketi girin..." value={tag}
                onChange={(e) => setTag(e.target.value)} />
            </div>
          )}

          {/* Ürün Seçimi */}
          {filter === 'products' && (
            <div style={{ marginBottom: 16 }}>
              <div className="form-group" style={{ marginBottom: 8 }}>
                <label className="form-label">Ürün Ara ({selectedProductIds.length} seçili)</label>
                <input className="form-input" placeholder="Ürün adı ile ara..." value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)} />
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }}>
                {filteredSearchProducts.slice(0, 50).map((p) => (
                  <label key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', cursor: 'pointer',
                    fontSize: 12, borderRadius: 4, background: selectedProductIds.includes(p.id) ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                  }}>
                    <input type="checkbox" checked={selectedProductIds.includes(p.id)}
                      onChange={() => toggleProduct(p.id)} />
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
                onChange={(e) => setPercentage(e.target.value)}
                style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
            </div>

            <div style={{ display: 'flex', gap: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={updatePrice} onChange={(e) => setUpdatePrice(e.target.checked)} />
                💵 Price güncelle
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={updateCompare} onChange={(e) => setUpdateCompare(e.target.checked)} />
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
                  {preview.slice(0, 100).map((p) =>
                    p.variants.map((v, vIdx) => (
                      <tr key={`${p.id}-${v.id}`} style={{ borderBottom: '1px solid var(--border)' }}>
                        {vIdx === 0 && (
                          <td style={{ padding: 8, fontWeight: 600 }} rowSpan={p.variants.length}>
                            {p.title}
                          </td>
                        )}
                        <td style={{ padding: 8, color: 'var(--text-muted)' }}>{v.title}</td>
                        {updatePrice && <td style={{ padding: 8, textAlign: 'right' }}>₺{v.oldPrice.toLocaleString()}</td>}
                        {updatePrice && (
                          <td style={{
                            padding: 8, textAlign: 'right', fontWeight: 700,
                            color: v.newPrice > v.oldPrice ? '#16a34a' : v.newPrice < v.oldPrice ? '#dc2626' : 'inherit',
                          }}>
                            ₺{v.newPrice.toLocaleString()}
                          </td>
                        )}
                        {updateCompare && <td style={{ padding: 8, textAlign: 'right' }}>₺{v.oldCompare.toLocaleString()}</td>}
                        {updateCompare && (
                          <td style={{
                            padding: 8, textAlign: 'right', fontWeight: 700,
                            color: v.newCompare > v.oldCompare ? '#16a34a' : v.newCompare < v.oldCompare ? '#dc2626' : 'inherit',
                          }}>
                            ₺{v.newCompare.toLocaleString()}
                          </td>
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

            {applyResult ? (
              <div style={{
                marginTop: 16, padding: 16, borderRadius: 8, textAlign: 'center',
                background: applyResult.failed === 0 ? '#e8f5e9' : '#fff3e0',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>
                  {applyResult.failed === 0 ? '✅' : '⚠️'}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {applyResult.updated} varyant güncellendi
                  {applyResult.failed > 0 && `, ${applyResult.failed} başarısız`}
                </div>
              </div>
            ) : (
              <button className="btn" onClick={handleApply} disabled={applying}
                style={{
                  width: '100%', marginTop: 16, fontSize: 14, padding: '14px 20px',
                  background: 'var(--danger)', color: '#fff', fontWeight: 700,
                }}>
                {applying ? <><span className="spinner" /> Güncelleniyor ({totalVariants} varyant)...</> : `🚀 ${totalVariants} Varyantı Güncelle`}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
