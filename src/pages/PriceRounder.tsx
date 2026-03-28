import { useState, useMemo } from 'react'
import { ToastData } from '../components/Toast'

interface Variant {
  id: string
  title: string
  price: string
  compare_at_price: string | null
}

interface Product {
  id: number
  title: string
  status: string
  tags: string
  variants: Variant[]
}

interface PreviewRow {
  productId: number
  productTitle: string
  productStatus: string
  variantId: string
  variantTitle: string
  oldPrice: string
  newPrice: string
  oldCompare: string | null
  newCompare: string | null
  changed: boolean
}

interface Props {
  addToast: (t: Omit<ToastData, 'id'>) => void
}

const fmt = (v: string | null) => {
  if (!v || parseFloat(v) === 0) return null
  return '₺' + parseFloat(v).toLocaleString('tr-TR', { minimumFractionDigits: 2 })
}

const fmtNew = (v: string | null) => {
  if (!v || parseFloat(v) === 0) return null
  return '₺' + Math.ceil(parseFloat(v)).toLocaleString('tr-TR', { minimumFractionDigits: 2 })
}

const roundUp = (v: string | null): string | null => {
  if (!v || parseFloat(v) === 0) return v
  return String(Math.ceil(parseFloat(v)))
}

const isChanged = (v: Variant) => {
  const priceChanged = parseFloat(v.price) !== Math.ceil(parseFloat(v.price))
  const compareChanged =
    v.compare_at_price != null &&
    parseFloat(v.compare_at_price) > 0 &&
    parseFloat(v.compare_at_price) !== Math.ceil(parseFloat(v.compare_at_price))
  return priceChanged || compareChanged
}

export default function PriceRounder({ addToast }: Props) {
  const [tag, setTag] = useState('')
  const [status, setStatus] = useState('active')
  const [onlyChanged, setOnlyChanged] = useState(true)

  const [products, setProducts] = useState<Product[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [loadingApply, setLoadingApply] = useState(false)
  const [progress, setProgress] = useState(0)
  const [resultMsg, setResultMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const rows: PreviewRow[] = useMemo(() => {
    const all: PreviewRow[] = []
    for (const p of products) {
      for (const v of p.variants) {
        const changed = isChanged(v)
        all.push({
          productId: p.id,
          productTitle: p.title,
          productStatus: p.status,
          variantId: v.id,
          variantTitle: v.title,
          oldPrice: v.price,
          newPrice: roundUp(v.price) || v.price,
          oldCompare: v.compare_at_price,
          newCompare: roundUp(v.compare_at_price),
          changed,
        })
      }
    }
    return all
  }, [products])

  const displayRows = onlyChanged ? rows.filter((r) => r.changed) : rows
  const changedCount = rows.filter((r) => r.changed).length

  const handlePreview = async () => {
    setLoadingPreview(true)
    setProducts([])
    setResultMsg(null)
    setProgress(0)
    try {
      const qs = new URLSearchParams()
      if (tag.trim()) qs.set('tag', tag.trim())
      if (status !== 'any') qs.set('status', status)
      qs.set('limit', '250')

      const res = await fetch(`/api/get-products?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata')
      setProducts(data.products || [])

      const count = (data.products || []).length
      addToast({ type: 'info', message: `${count} ürün yüklendi.` })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleApply = async () => {
    const toUpdate = rows.filter((r) => r.changed)
    if (!toUpdate.length) {
      addToast({ type: 'info', message: 'Yuvarlanacak fiyat bulunamadı.' })
      return
    }

    setLoadingApply(true)
    setResultMsg(null)
    setProgress(0)

    try {
      const variants = toUpdate.map((r) => ({
        id: r.variantId,
        price: r.newPrice,
        compare_at_price: r.newCompare,
      }))

      // Simulate progress
      const interval = setInterval(() => {
        setProgress((p) => Math.min(p + 5, 90))
      }, 400)

      const res = await fetch('/api/round-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variants }),
      })

      clearInterval(interval)
      setProgress(100)

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata')

      setResultMsg({
        type: data.failCount === 0 ? 'success' : 'error',
        text:
          data.failCount === 0
            ? `${data.successCount} variant başarıyla güncellendi.`
            : `${data.successCount} başarılı, ${data.failCount} hata.`,
      })

      addToast({
        type: data.failCount === 0 ? 'success' : 'error',
        message:
          data.failCount === 0
            ? `✓ ${data.successCount} variant güncellendi!`
            : `${data.failCount} variant güncellenemedi.`,
      })

      // Refresh to show updated prices
      await handlePreview()
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    } finally {
      setLoadingApply(false)
      setTimeout(() => setProgress(0), 1200)
    }
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Fiyat Yuvarlama</h1>
        <p className="page-desc">
          Ürün fiyatlarını ve karşılaştırma fiyatlarını tam sayıya yukarı yuvarlar (₺2.374 → ₺2.400)
        </p>
      </div>

      <div className="page-body">
        {/* Filter card */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-title">⚙️ Filtrele</div>
          <div className="form-row" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="tag-input">Etiket</label>
              <input
                id="tag-input"
                className="form-input"
                placeholder="ör: indirim, yeni-sezon (opsiyonel)"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePreview()}
              />
              <span className="form-hint">Boş bırakılırsa tüm etiketler dahil edilir</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="status-select">Ürün Durumu</label>
              <select
                id="status-select"
                className="form-select"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="any">Tümü</option>
                <option value="active">Aktif</option>
                <option value="archived">Arşiv</option>
                <option value="draft">Taslak</option>
              </select>
            </div>
          </div>

          <div className="btn-row">
            <button
              id="preview-btn"
              className="btn btn-primary"
              onClick={handlePreview}
              disabled={loadingPreview || loadingApply}
            >
              {loadingPreview ? <><span className="spinner" /> Yükleniyor...</> : '🔍 Önizle'}
            </button>

            {products.length > 0 && (
              <button
                id="apply-btn"
                className="btn btn-success"
                onClick={handleApply}
                disabled={loadingApply || loadingPreview || changedCount === 0}
              >
                {loadingApply
                  ? <><span className="spinner" /> Güncelleniyor...</>
                  : `✓ ${changedCount} Fiyatı Uygula`}
              </button>
            )}
          </div>

          {loadingApply && (
            <div style={{ marginTop: 12 }}>
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {progress < 100 ? `İşleniyor... %${progress}` : 'Tamamlandı!'}
              </div>
            </div>
          )}
        </div>

        {/* Result banner */}
        {resultMsg && (
          <div className={`alert alert-${resultMsg.type}`} style={{ marginBottom: 20 }}>
            <span style={{ fontWeight: 700, marginRight: 4 }}>{resultMsg.type === 'success' ? '✓' : '✕'}</span>
            {resultMsg.text}
          </div>
        )}

        {/* Preview table */}
        {products.length > 0 && (
          <>
            <div className="stats-row">
              <div className="stat-chip">
                <span className="stat-chip-val">{products.length}</span>
                <span className="stat-chip-label">Ürün</span>
              </div>
              <div className="stat-chip">
                <span className="stat-chip-val">{rows.length}</span>
                <span className="stat-chip-label">Variant</span>
              </div>
              <div className="stat-chip">
                <span className="stat-chip-val" style={{ color: 'var(--success)' }}>{changedCount}</span>
                <span className="stat-chip-label">Değişecek</span>
              </div>
              <div className="stat-chip" style={{ marginLeft: 'auto' }}>
                <label className="checkbox-row" htmlFor="only-changed">
                  <input
                    id="only-changed"
                    type="checkbox"
                    checked={onlyChanged}
                    onChange={(e) => setOnlyChanged(e.target.checked)}
                  />
                  Yalnızca değişenleri göster
                </label>
              </div>
            </div>

            {displayRows.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🎉</div>
                <div className="empty-state-text">Tüm fiyatlar zaten tam sayı — yuvarlanacak bir şey yok.</div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Ürün</th>
                      <th>Variant</th>
                      <th>Durum</th>
                      <th>Fiyat (Şu an)</th>
                      <th>Fiyat (Yeni)</th>
                      <th>Karş. Fiyatı (Şu an)</th>
                      <th>Karş. Fiyatı (Yeni)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => (
                      <tr key={r.variantId} className={r.changed ? '' : 'unchanged'}>
                        <td className="td-name" title={r.productTitle}>{r.productTitle}</td>
                        <td>{r.variantTitle === 'Default Title' ? '—' : r.variantTitle}</td>
                        <td>
                          <span className={`badge badge-${r.productStatus}`}>{r.productStatus}</span>
                        </td>

                        {/* Price */}
                        <td>
                          {r.changed && parseFloat(r.oldPrice) !== Math.ceil(parseFloat(r.oldPrice)) ? (
                            <span className="price-old">{fmt(r.oldPrice)}</span>
                          ) : (
                            <span className="price-same">{fmt(r.oldPrice)}</span>
                          )}
                        </td>
                        <td>
                          {r.changed && parseFloat(r.oldPrice) !== Math.ceil(parseFloat(r.oldPrice)) ? (
                            <span className="price-new">{fmtNew(r.oldPrice)}</span>
                          ) : (
                            <span className="price-same">{fmt(r.oldPrice)}</span>
                          )}
                        </td>

                        {/* Compare at price */}
                        <td>
                          {r.oldCompare && parseFloat(r.oldCompare) > 0 ? (
                            r.changed &&
                            parseFloat(r.oldCompare) !== Math.ceil(parseFloat(r.oldCompare)) ? (
                              <span className="price-old">{fmt(r.oldCompare)}</span>
                            ) : (
                              <span className="price-same">{fmt(r.oldCompare)}</span>
                            )
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {r.oldCompare && parseFloat(r.oldCompare) > 0 ? (
                            r.changed &&
                            parseFloat(r.oldCompare) !== Math.ceil(parseFloat(r.oldCompare)) ? (
                              <span className="price-new">{fmtNew(r.oldCompare)}</span>
                            ) : (
                              <span className="price-same">{fmt(r.oldCompare)}</span>
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
            )}
          </>
        )}

        {/* Empty initial state */}
        {products.length === 0 && !loadingPreview && (
          <div className="empty-state">
            <div className="empty-state-icon">🔍</div>
            <div className="empty-state-text">
              Filtreleri ayarlayıp "Önizle" butonuna basın
            </div>
          </div>
        )}
      </div>
    </>
  )
}
