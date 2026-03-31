import type { CostData } from '../hooks/useCostTracker'

interface Props {
  session: CostData
  persistent: CostData
  title?: string
}

function MiniPanel({ data, label, position }: { data: CostData; label: string; position: 'top' | 'bottom' }) {
  if (data.count === 0) return null

  const models = Object.entries(data.byModel)

  return (
    <div style={{
      position: 'fixed',
      [position === 'top' ? 'top' : 'bottom']: 16,
      left: 16,
      zIndex: 1000,
      background: 'var(--bg-card)',
      borderRadius: 10,
      border: '1px solid var(--border)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
      padding: '8px 12px',
      minWidth: 200,
      maxWidth: 280,
      fontSize: 11,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>
          {position === 'top' ? '🔒' : '💰'} {label}
        </span>
        <span style={{ fontWeight: 800, color: '#e65100', fontSize: 13 }}>
          ${data.totalUSD.toFixed(4)}
        </span>
      </div>

      {/* Summary line */}
      <div style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: models.length > 0 ? 4 : 0 }}>
        {data.count} işlem
        {position === 'top' ? ' • çerezlere kadar kalıcı' : ' • sayfa yenileyene kadar'}
      </div>

      {/* Model breakdown — compact */}
      {models.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>
          {models.map(([model, info]) => (
            <div key={model} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '2px 0', fontSize: 10,
            }}>
              <span style={{ color: 'var(--text-muted)' }}>
                {model.includes('claude') ? '🟣' : model.includes('gemini') ? '🔵' : '🟢'}
                {' '}{model} ×{info.count}
              </span>
              <span style={{ fontWeight: 600 }}>${info.costUSD.toFixed(4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CostPanel({ session, persistent, title }: Props) {
  const label = title || 'AI Maliyet'

  return (
    <>
      <MiniPanel data={persistent} label={`${label} (Toplam)`} position="top" />
      <MiniPanel data={session} label={`${label} (Oturum)`} position="bottom" />
    </>
  )
}
