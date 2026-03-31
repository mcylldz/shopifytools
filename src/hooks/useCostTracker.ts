import { useState, useCallback } from 'react'

// ── Model fiyatları (USD per 1M tokens veya per operation) ──
const PRICING: Record<string, { input: number; output: number; unit: 'token' } | { perOp: number; unit: 'op' }> = {
  // Claude — per 1M tokens (verified Mar 2026)
  'claude-sonnet-4-20250514': { input: 3, output: 15, unit: 'token' },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15, unit: 'token' },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25, unit: 'token' },

  // Gemini — per 1M tokens (verified Mar 2026)
  'gemini-2.5-flash-image': { input: 0.30, output: 2.50, unit: 'token' },
  'gemini-3-pro-image-preview': { input: 1.25, output: 12, unit: 'token' },

  // FAL — per generation (verified Mar 2026)
  'fal:nano-banana-2': { perOp: 0.039, unit: 'op' },
  'fal:nano-banana-pro': { perOp: 0.15, unit: 'op' },
  'fal:nano-banana': { perOp: 0.039, unit: 'op' },
}

export interface CostEntry {
  id: string
  timestamp: number
  model: string
  action: string
  inputTokens?: number
  outputTokens?: number
  costUSD: number
}

export interface CostSummary {
  totalUSD: number
  byModel: Record<string, { count: number; costUSD: number; inputTokens: number; outputTokens: number }>
  byAction: Record<string, { count: number; costUSD: number }>
  entries: CostEntry[]
}

export function calculateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  const pricing = PRICING[model]
  if (!pricing) {
    // Fallback: unknown model — estimate
    if (inputTokens || outputTokens) {
      return ((inputTokens || 0) * 3 + (outputTokens || 0) * 15) / 1_000_000
    }
    return 0
  }

  if (pricing.unit === 'op') {
    return pricing.perOp
  }

  // Token-based
  const inCost = ((inputTokens || 0) * pricing.input) / 1_000_000
  const outCost = ((outputTokens || 0) * pricing.output) / 1_000_000
  return inCost + outCost
}

export function useCostTracker() {
  const [entries, setEntries] = useState<CostEntry[]>([])

  const addCost = useCallback((model: string, action: string, inputTokens?: number, outputTokens?: number, customCost?: number) => {
    const costUSD = customCost !== undefined ? customCost : calculateCost(model, inputTokens, outputTokens)
    const entry: CostEntry = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      timestamp: Date.now(),
      model,
      action,
      inputTokens,
      outputTokens,
      costUSD,
    }
    setEntries(prev => [...prev, entry])
    return entry
  }, [])

  const summary: CostSummary = {
    totalUSD: entries.reduce((s, e) => s + e.costUSD, 0),
    byModel: entries.reduce((acc, e) => {
      if (!acc[e.model]) acc[e.model] = { count: 0, costUSD: 0, inputTokens: 0, outputTokens: 0 }
      acc[e.model].count++
      acc[e.model].costUSD += e.costUSD
      acc[e.model].inputTokens += e.inputTokens || 0
      acc[e.model].outputTokens += e.outputTokens || 0
      return acc
    }, {} as CostSummary['byModel']),
    byAction: entries.reduce((acc, e) => {
      if (!acc[e.action]) acc[e.action] = { count: 0, costUSD: 0 }
      acc[e.action].count++
      acc[e.action].costUSD += e.costUSD
      return acc
    }, {} as CostSummary['byAction']),
    entries,
  }

  const reset = useCallback(() => setEntries([]), [])

  return { addCost, summary, reset, entries }
}
