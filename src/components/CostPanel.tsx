import { useState } from 'react'
import type { CostSummary } from '../hooks/useCostTracker'

interface Props {
  summary: CostSummary
  title?: string
}

export default function CostPanel({ summary, title }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [showEntries, setShowEntries] = useState(false)

  if (summary.entries.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: 16, right: 16, zIndex: 1000,
      background: 'var(--bg-card)', borderRadius: 12,
      border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      minWidth: expanded ? 340 : 'auto', maxWidth: 400,
      transition: 'all .2s ease',
    }}>
      {/* Header — always visible */}
      <div onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
        cursor: 'pointer', userSelect: 'none',
      }}>
        <span style={{ fontSize: 18 }}>💰</span>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
          {title || 'AI Maliyet'}: ${summary.totalUSD.toFixed(4)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {summary.entries.length} işlem
        </span>
        <span style={{ fontSize: 12 }}>{expanded ? '▼' : '▲'}</span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '0 14px 12px', fontSize: 12 }}>
          {/* By Model */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>Model Bazlı</div>
            {Object.entries(summary.byModel).map(([model, data]) => (
              <div key={model} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 8px', borderRadius: 4,
                background: model.includes('claude') ? 'rgba(139, 92, 246, 0.08)'
                  : model.includes('gemini') ? 'rgba(59, 130, 246, 0.08)'
                  : 'rgba(34, 197, 94, 0.08)',
                marginBottom: 3,
              }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 11 }}>
                    {model.includes('claude') ? '🟣' : model.includes('gemini') ? '🔵' : '🟢'}{' '}
                    {model.length > 30 ? model.slice(0, 28) + '…' : model}
                  </span>
                  {data.inputTokens > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {data.inputTokens.toLocaleString()} in / {data.outputTokens.toLocaleString()} out
                    </div>
                  )}
                </div>
                <div style={{ fontWeight: 700, color: '#e65100', fontSize: 12 }}>
                  ${data.costUSD.toFixed(4)}
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>×{data.count}</span>
                </div>
              </div>
            ))}
          </div>

          {/* By Action */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>İşlem Bazlı</div>
            {Object.entries(summary.byAction).map(([action, data]) => (
              <div key={action} style={{
                display: 'flex', justifyContent: 'space-between', padding: '3px 8px',
                fontSize: 11, borderRadius: 4, background: 'var(--bg)', marginBottom: 2,
              }}>
                <span>{action} <span style={{ color: 'var(--text-muted)' }}>×{data.count}</span></span>
                <span style={{ fontWeight: 600 }}>${data.costUSD.toFixed(4)}</span>
              </div>
            ))}
          </div>

          {/* Toggle entries */}
          <button onClick={() => setShowEntries(!showEntries)} style={{
            width: '100%', background: 'none', border: '1px solid var(--border)',
            borderRadius: 4, padding: '4px 8px', fontSize: 10, cursor: 'pointer',
            color: 'var(--text-muted)', marginBottom: showEntries ? 6 : 0,
          }}>
            {showEntries ? '▲ Detayları gizle' : '▼ Tüm işlemleri göster'}
          </button>

          {showEntries && (
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {summary.entries.map(e => (
                <div key={e.id} style={{
                  display: 'flex', justifyContent: 'space-between', padding: '3px 6px',
                  fontSize: 10, borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{e.action}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                      {e.model.length > 20 ? e.model.slice(0, 18) + '…' : e.model}
                    </span>
                    {e.inputTokens ? (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                        ({e.inputTokens}+{e.outputTokens} tok)
                      </span>
                    ) : null}
                  </div>
                  <span style={{ fontWeight: 600, color: '#e65100' }}>${e.costUSD.toFixed(4)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Total bar */}
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: 6,
            background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(59,130,246,0.1))',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span style={{ fontWeight: 600, fontSize: 12 }}>Toplam</span>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#e65100' }}>
              ${summary.totalUSD.toFixed(4)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
