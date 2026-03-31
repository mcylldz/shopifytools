import { useState, useCallback, useEffect } from 'react'

// ── Görüntü çıktı fiyatları (Google resmi + FAL resmi, Mart 2026) ──
// Gemini image output tokenleri NORMAL text output'tan farklı fiyatlanır
const IMAGE_OUTPUT_PRICING: Record<string, number> = {
  // Gemini — görüntü çıktısı per image (1K resolution)
  'gemini-2.5-flash-image': 0.039,    // 1290 token × $30/MTok
  'gemini-3-pro-image-preview': 0.134, // 1120 token × $120/MTok

  // FAL — per generation
  'fal:nano-banana-2': 0.039,
  'fal:nano-banana-pro': 0.15,
  'fal:nano-banana': 0.039,
}

// Token bazlı fiyatlar (text input/output — Claude, ve Claude vision analyze)
const TOKEN_PRICING: Record<string, { input: number; output: number }> = {
  // Claude — per 1M tokens
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
}

export interface CostData {
  totalUSD: number
  count: number
  byModel: Record<string, { count: number; costUSD: number }>
}

function emptyCost(): CostData {
  return { totalUSD: 0, count: 0, byModel: {} }
}

// localStorage key per tool
const LS_KEY_PREFIX = 'ai_cost_'

export function calculateCost(model: string, inputTokens?: number, outputTokens?: number): number {
  // Fixed per-image pricing (for image generation models)
  const imgPrice = IMAGE_OUTPUT_PRICING[model]
  if (imgPrice !== undefined && !inputTokens && !outputTokens) {
    return imgPrice
  }

  // Token-based pricing
  const tokenPrice = TOKEN_PRICING[model]
  if (tokenPrice && (inputTokens || outputTokens)) {
    return ((inputTokens || 0) * tokenPrice.input + (outputTokens || 0) * tokenPrice.output) / 1_000_000
  }

  // Gemini image models with token counts — use image output rate
  if (model.includes('gemini') && outputTokens) {
    // Image output tokens: $30/MTok for flash, $120/MTok for pro
    const outRate = model.includes('pro') ? 120 : 30
    const inRate = model.includes('pro') ? 1.25 : 0.30
    return ((inputTokens || 0) * inRate + (outputTokens || 0) * outRate) / 1_000_000
  }

  // Fallback
  if (inputTokens || outputTokens) {
    return ((inputTokens || 0) * 3 + (outputTokens || 0) * 15) / 1_000_000
  }

  return IMAGE_OUTPUT_PRICING[model] || 0
}

export function useCostTracker(toolName: string = 'default') {
  // Session cost (resets on page refresh)
  const [session, setSession] = useState<CostData>(emptyCost())

  // Persistent cost (localStorage, survives refresh)
  const [persistent, setPersistent] = useState<CostData>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY_PREFIX + toolName)
      return stored ? JSON.parse(stored) : emptyCost()
    } catch { return emptyCost() }
  })

  // Save persistent to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_PREFIX + toolName, JSON.stringify(persistent))
    } catch {}
  }, [persistent, toolName])

  const addCost = useCallback((model: string, _action: string, inputTokens?: number, outputTokens?: number) => {
    const costUSD = calculateCost(model, inputTokens, outputTokens)
    const label = model.length > 25 ? model.slice(0, 23) + '…' : model

    // Update session
    setSession(prev => {
      const next = { ...prev, totalUSD: prev.totalUSD + costUSD, count: prev.count + 1 }
      next.byModel = { ...prev.byModel }
      if (!next.byModel[label]) next.byModel[label] = { count: 0, costUSD: 0 }
      next.byModel[label] = { count: next.byModel[label].count + 1, costUSD: next.byModel[label].costUSD + costUSD }
      return next
    })

    // Update persistent
    setPersistent(prev => {
      const next = { ...prev, totalUSD: prev.totalUSD + costUSD, count: prev.count + 1 }
      next.byModel = { ...prev.byModel }
      if (!next.byModel[label]) next.byModel[label] = { count: 0, costUSD: 0 }
      next.byModel[label] = { count: next.byModel[label].count + 1, costUSD: next.byModel[label].costUSD + costUSD }
      return next
    })
  }, [])

  return { addCost, session, persistent }
}
