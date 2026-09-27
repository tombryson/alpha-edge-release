'use client'

import { useCallback, useState } from 'react'
import type { Stock } from '@/lib/store'

interface Catalyst {
  name: string
  date: string
  period?: string
  impact: 'LOW' | 'MED' | 'HIGH'
}

interface CatalystDisplay extends Catalyst {
  _idx: number
  _ts: number | null
}

interface ResearchPanelProps {
  stock: Stock
  onUpdate: (field: keyof Stock, value: any) => void
  onBulkUpdate?: (updates: Partial<Stock>) => void
  councilRunId?: string
  onClearCouncilImport?: () => void
}

const CHART_METRICS = {
  width: 900,
  height: 360,
  margin: { top: 12, right: 26, bottom: 54, left: 60 },
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const safeNum = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const periodToDate = (period: string): string => {
  const raw = String(period || '').trim()
  if (!raw) return ''
  const p = raw.toUpperCase()
  const iso = p.match(/^(20\d{2})-(\d{2})-(\d{2})$/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const q = p.match(/Q([1-4])\s*(20\d{2})/)
  if (q) return `${q[2]}-${String(Number(q[1]) * 3).padStart(2, '0')}-15`
  const h = p.match(/H([12])\s*(20\d{2})/)
  if (h) return `${h[2]}-${Number(h[1]) === 1 ? '03' : '09'}-15`
  const hCy = p.match(/H([12])\s*CY\s*(20\d{2})/)
  if (hCy) return `${hCy[2]}-${Number(hCy[1]) === 1 ? '03' : '09'}-15`
  const endCy = p.match(/END\s*CY\s*(20\d{2})/)
  if (endCy) return `${endCy[1]}-12-15`
  const lateCy = p.match(/LATE\s*CY\s*(20\d{2})/)
  if (lateCy) return `${lateCy[1]}-09-15`
  const midCy = p.match(/MID\s*CY\s*(20\d{2})/)
  if (midCy) return `${midCy[1]}-03-15`
  const earlyCy = p.match(/(EARLY|START|BEGINNING)\s*CY\s*(20\d{2})/)
  if (earlyCy) return `${earlyCy[2]}-03-15`
  const monthQuarter = p.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s+Q\s*(20\d{2})\b/)
  if (monthQuarter) {
    const quarterMap: Record<string, string> = {
      JAN: '03', FEB: '03', MAR: '03',
      APR: '06', MAY: '06', JUN: '06',
      JUL: '09', AUG: '09', SEP: '09', SEPT: '09',
      OCT: '12', NOV: '12', DEC: '12',
    }
    return `${monthQuarter[2]}-${quarterMap[monthQuarter[1]] || '12'}-15`
  }
  const m = p.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*\s*(20\d{2})\b/)
  if (m) {
    const monthMap: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', SEPT: '09', OCT: '10', NOV: '11', DEC: '12',
    }
    const mm = monthMap[m[1]] || '12'
    return `${m[2]}-${mm}-15`
  }
  const y = p.match(/^(20\d{2})$/)
  if (y) return `${y[1]}-12-15`
  return ''
}

const catalystTime = (dateIso: string, periodLabel?: string): number | null => {
  const derived = dateIso || periodToDate(String(periodLabel || ''))
  if (!derived) return null
  const t = Date.parse(String(derived))
  return Number.isFinite(t) ? t : null
}

const normalizeCatalystTiming = (rawInput: string): { date: string; period: string } => {
  const raw = String(rawInput || '').trim()
  if (!raw) return { date: '', period: '' }
  const date = periodToDate(raw)
  const isoLike = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  if (isoLike) return { date: raw, period: '' }
  if (date) return { date, period: raw }
  return { date: '', period: raw }
}

const catalystDisplayPeriod = (c: Catalyst): string => {
  const p = String(c.period || '').trim()
  if (p) return p
  const t = Date.parse(String(c.date || ''))
  if (!Number.isFinite(t)) return 'TBD'
  try {
    return new Date(t).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
  } catch {
    return 'TBD'
  }
}

const catalystEditTiming = (c: Catalyst): string => {
  const p = String(c.period || '').trim()
  if (p) return p
  return String(c.date || '')
}

const catalystTimeLabelPlaceholder = 'Q2 2026 or 2026-06-15'

const nowUtcMs = () => Date.now()

const clampMsTo24m = (startMs: number, endMs: number, targetMs: number) => {
  if (!Number.isFinite(targetMs)) return endMs
  if (targetMs < startMs) return startMs
  if (targetMs > endMs) return endMs
  return targetMs
}

const monthsBetween = (startMs: number, endMs: number, targetMs: number) => {
  const clampedMs = clampMsTo24m(startMs, endMs, targetMs)
  const diffMs = clampedMs - startMs
  const months = diffMs / (1000 * 60 * 60 * 24 * 30.4375)
  return clamp(months, 0, 24)
}

const catalystOffsetFromNow = (dateIso: string, periodLabel?: string): number => {
  const ts = catalystTime(dateIso, periodLabel)
  const now = nowUtcMs()
  const end = (() => {
    const d = new Date(now)
    d.setMonth(d.getMonth() + 24)
    return d.getTime()
  })()
  if (ts == null) return 24
  return monthsBetween(now, end, ts)
}

const catalystIsFutureWithin = (dateIso: string, periodLabel?: string, nowMs?: number, endMs?: number): boolean => {
  const ts = catalystTime(dateIso, periodLabel)
  if (ts == null) return false
  const n = Number.isFinite(Number(nowMs)) ? Number(nowMs) : nowUtcMs()
  const e = Number.isFinite(Number(endMs)) ? Number(endMs) : (() => {
    const d = new Date(n)
    d.setMonth(d.getMonth() + 24)
    return d.getTime()
  })()
  return ts > n && ts <= e
}

const catalystTimeValue = (dateIso: string, periodLabel?: string): number | null => {
  return catalystTime(dateIso, periodLabel)
}

const fmtMoney = (value: number) => `A$${safeNum(value).toFixed(2)}`

const rebaseTarget = (value: unknown, factor: number) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Number((n * factor).toFixed(6))
}

const sanitizeCatalystName = (value: unknown): string => {
  let text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  text = text.replace(/\s*\([^)]*$/, '')
  text = text.replace(/\s*\[[^\]]*$/, '')
  text = text.replace(/\s*\{[^}]*$/, '')
  text = text.replace(/\s*[|:;,\-]+$/, '')
  text = text.replace(/\s*\($/, '')
  return text.trim()
}

export function ResearchPanel({ stock, onUpdate, onBulkUpdate, councilRunId = '', onClearCouncilImport }: ResearchPanelProps) {
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustType, setAdjustType] = useState<'consolidation' | 'split'>('consolidation')
  const [oldUnits, setOldUnits] = useState('10')
  const [newUnits, setNewUnits] = useState('1')
  const [adjustError, setAdjustError] = useState('')

  const catalysts: Catalyst[] = (() => {
    try {
      if (!stock.catalysts) return []
      const parsed = JSON.parse(stock.catalysts)
      if (!Array.isArray(parsed)) return []
      return parsed.map((c) => ({
        name: sanitizeCatalystName(c?.name),
        date: String(c?.date || ''),
        period: String(c?.period || ''),
        impact: (c?.impact === 'HIGH' || c?.impact === 'LOW') ? c.impact : 'MED',
      }))
    } catch {
      return []
    }
  })()

  const catalystsForDisplay: CatalystDisplay[] = catalysts
    .map((c, idx) => ({ ...c, _idx: idx, _ts: catalystTimeValue(c.date, c.period) }))
    .sort((a, b) => {
      if (a._ts != null && b._ts != null) {
        if (a._ts !== b._ts) return a._ts - b._ts
        return a._idx - b._idx
      }
      if (a._ts != null) return -1
      if (b._ts != null) return 1
      return a._idx - b._idx
    })

  const updateCatalysts = useCallback((newCatalysts: Catalyst[]) => {
    onUpdate('catalysts' as keyof Stock, JSON.stringify(newCatalysts))
  }, [onUpdate])

  const addCatalyst = () => {
    updateCatalysts([...catalysts, { name: '', date: '', impact: 'MED' }])
  }

  const removeCatalyst = (index: number) => {
    updateCatalysts(catalysts.filter((_, i) => i !== index))
  }

  const updateCatalyst = (index: number, field: keyof Catalyst, value: string) => {
    const updated = [...catalysts]
    updated[index] = { ...updated[index], [field]: value }
    updateCatalysts(updated)
  }

  const updateCatalystTiming = (index: number, rawValue: string) => {
    const updated = [...catalysts]
    const timing = normalizeCatalystTiming(rawValue)
    updated[index] = { ...updated[index], date: timing.date, period: timing.period }
    updateCatalysts(updated)
  }

  const openAdjust = () => {
    setAdjustType('consolidation')
    setOldUnits('10')
    setNewUnits('1')
    setAdjustError('')
    setAdjustOpen(true)
  }

  const selectAdjustType = (type: 'consolidation' | 'split') => {
    setAdjustType(type)
    setAdjustError('')
    if (type === 'consolidation') {
      setOldUnits('10')
      setNewUnits('1')
    } else {
      setOldUnits('1')
      setNewUnits('10')
    }
  }

  const applyAdjustment = () => {
    const oldValue = Number(oldUnits)
    const newValue = Number(newUnits)
    if (!Number.isFinite(oldValue) || oldValue <= 0 || !Number.isFinite(newValue) || newValue <= 0) {
      setAdjustError('Enter a valid positive ratio.')
      return
    }

    const factor = oldValue / newValue
    const nextAnalystPT = rebaseTarget(stock.analystPT, factor)
    const current = safeNum(stock.price)
    const updates: Partial<Stock> = {
      councilPT: rebaseTarget(stock.councilPT, factor),
      analystPT: nextAnalystPT,
      bearCasePT: rebaseTarget(stock.bearCasePT, factor),
      baseCasePT: rebaseTarget(stock.baseCasePT, factor),
      bullCasePT: rebaseTarget(stock.bullCasePT, factor),
      bearCasePT12M: rebaseTarget(stock.bearCasePT12M, factor),
      baseCasePT12M: rebaseTarget(stock.baseCasePT12M, factor),
      bullCasePT12M: rebaseTarget(stock.bullCasePT12M, factor),
      upside24M: nextAnalystPT > 0 && current > 0 ? ((nextAnalystPT - current) / current) * 100 : stock.upside24M || 0,
    }

    if (onBulkUpdate) {
      onBulkUpdate(updates)
    } else {
      Object.entries(updates).forEach(([field, value]) => {
        onUpdate(field as keyof Stock, value)
      })
    }
    setAdjustOpen(false)
  }

  const openFullLab = useCallback(() => {
    const base = 'https://llm-council-analysis.fly.dev/gantt-lab'
    const params = new URLSearchParams()
    const prefix = String(stock.prefix || '').trim().toUpperCase()
    const symbol = String(stock.symbol || '').trim().toUpperCase()
    const ticker = prefix && symbol
      ? `${prefix.endsWith(':') ? prefix.slice(0, -1) : prefix}:${symbol}`
      : symbol
    if (ticker) params.set('ticker', ticker)
    if (councilRunId) params.set('run_id', councilRunId)
    const qs = params.toString()
    const url = qs ? `${base}?${qs}` : base
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [councilRunId, stock.prefix, stock.symbol])

  // Scenario analysis calculations
  const bear24 = safeNum(stock.bearCasePT)
  const base24 = safeNum(stock.baseCasePT)
  const bull24 = safeNum(stock.bullCasePT)
  const currentPrice = safeNum(stock.price)
  const hasCurrent = currentPrice > 0

  const rawBear12 = safeNum(stock.bearCasePT12M)
  const rawBase12 = safeNum(stock.baseCasePT12M)
  const rawBull12 = safeNum(stock.bullCasePT12M)

  const impliedBase12 = rawBase12 > 0
    ? rawBase12
    : hasCurrent && base24 > 0
      ? currentPrice + ((base24 - currentPrice) * 0.5)
      : (base24 > 0 ? base24 * 0.85 : 0)

  const bearRatio24 = base24 > 0 && bear24 > 0 ? (bear24 / base24) : 0.7
  const bullRatio24 = base24 > 0 && bull24 > 0 ? (bull24 / base24) : 1.3

  const bear12 = rawBear12 > 0
    ? rawBear12
    : (impliedBase12 > 0 ? impliedBase12 * bearRatio24 : (bear24 > 0 ? bear24 * 0.85 : 0))
  const base12 = impliedBase12
  const bull12 = rawBull12 > 0
    ? rawBull12
    : (impliedBase12 > 0 ? impliedBase12 * bullRatio24 : (bull24 > 0 ? bull24 * 0.9 : 0))

  const bearProb24 = safeNum(stock.bearProbability)
  const baseProb24 = safeNum(stock.baseProbability)
  const bullProb24 = safeNum(stock.bullProbability)
  const totalProb24 = bearProb24 + baseProb24 + bullProb24
  const weightedPT = totalProb24 > 0
    ? (bear24 * bearProb24 + base24 * baseProb24 + bull24 * bullProb24) / totalProb24
    : 0

  const bearProb12 = safeNum(stock.bearProbability12M ?? bearProb24)
  const baseProb12 = safeNum(stock.baseProbability12M ?? baseProb24)
  const bullProb12 = safeNum(stock.bullProbability12M ?? bullProb24)
  const totalProb12 = bearProb12 + baseProb12 + bullProb12
  const weightedPT12 = totalProb12 > 0
    ? (bear12 * bearProb12 + base12 * baseProb12 + bull12 * bullProb12) / totalProb12
    : weightedPT

  // Timeline horizon: 24 months from today
  const now = new Date()
  const endDate = new Date(now)
  endDate.setMonth(endDate.getMonth() + 24)
  const totalMs = endDate.getTime() - now.getTime()

  const futureCatalysts = catalystsForDisplay.filter((c) => (
    catalystIsFutureWithin(c.date, c.period, now.getTime(), endDate.getTime())
  ))

  const impactColor = (impact: string) => {
    switch (impact) {
      case 'HIGH': return 'var(--destructive)'
      case 'MED': return 'var(--caution)'
      case 'LOW': return '#3b82f6'
      default: return '#6b7280'
    }
  }

  const impactToneClass = (impact: Catalyst['impact']) => {
    if (impact === 'HIGH') return 'text-destructive border-destructive/30 bg-destructive/10'
    if (impact === 'LOW') return 'text-info border-info/30 bg-info/10'
    return 'text-caution border-caution/30 bg-caution/10'
  }

  const { width, height, margin } = CHART_METRICS
  const plotW = width - margin.left - margin.right
  const plotH = height - margin.top - margin.bottom
  const x = (months: number) => margin.left + (months / 24) * plotW

  const chartValues = [currentPrice, bear12, base12, bull12, bear24, base24, bull24, weightedPT12, weightedPT]
    .filter((v) => Number.isFinite(v) && v > 0)
  const safeValues = chartValues.length ? chartValues : [0.01, 0.02]
  const min = Math.min(...safeValues)
  const max = Math.max(...safeValues)
  const pad = Math.max((max - min) * 0.2, max * 0.08, 0.05)
  const yMin = Math.max(0, min - pad)
  const yMax = max + pad
  const y = (value: number) => margin.top + ((yMax - value) / Math.max(yMax - yMin, 0.0001)) * plotH

  const yTicks = Array.from({ length: 5 }, (_, i) => Number((yMin + ((yMax - yMin) * i) / 4).toFixed(3)))
    .filter((v) => Number.isFinite(v))

  const series = {
    bear: [
      { m: 0, v: hasCurrent ? currentPrice : Math.max(bear12, 0.01) },
      { m: 12, v: Math.max(bear12, 0.01) },
      { m: 24, v: Math.max(bear24, 0.01) },
    ],
    base: [
      { m: 0, v: hasCurrent ? currentPrice : Math.max(base12, 0.01) },
      { m: 12, v: Math.max(base12, 0.01) },
      { m: 24, v: Math.max(base24, 0.01) },
    ],
    bull: [
      { m: 0, v: hasCurrent ? currentPrice : Math.max(bull12, 0.01) },
      { m: 12, v: Math.max(bull12, 0.01) },
      { m: 24, v: Math.max(bull24, 0.01) },
    ],
  }

  const ribbonPoints = [
    ...series.bull.map((p) => `${x(p.m)},${y(p.v)}`),
    ...[...series.bear].reverse().map((p) => `${x(p.m)},${y(p.v)}`),
  ].join(' ')

  const weightedSeries = [
    { m: 0, v: hasCurrent ? currentPrice : Math.max(weightedPT12, 0.01) },
    { m: 12, v: Math.max(weightedPT12, 0.01) },
    { m: 24, v: Math.max(weightedPT, 0.01) },
  ]

  const yearLabels = (() => {
    const labels: Array<{ m: number; label: string }> = []
    const y0 = now.getFullYear()
    labels.push({ m: 3, label: String(y0) })
    labels.push({ m: 15, label: String(y0 + 1) })
    labels.push({ m: 23, label: String(y0 + 2) })
    return labels
  })()

  const timelineRows = futureCatalysts
    .slice(0, 8)
    .map((c) => {
      const offset = catalystOffsetFromNow(c.date, c.period)
      const tone = c.impact === 'HIGH' ? 'bear' : c.impact === 'LOW' ? 'bull' : 'base'
      const period = catalystDisplayPeriod(c)
      return { ...c, offset, tone, period }
    })

  return (
    <div className="bg-muted border border-border/40 rounded p-4 mx-2 mb-2">
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={openFullLab}
          className="text-[10px] px-2.5 py-1 rounded border border-caution/30 bg-caution/10 text-caution hover:bg-caution/20 cursor-pointer"
          title={councilRunId ? `Open full lab (run ${councilRunId})` : 'Open full lab'}
        >
          {councilRunId ? '↗ OPEN FULL LAB' : 'OPEN FULL LAB'}
        </button>
        <button
          onClick={openAdjust}
          className="text-[10px] px-2.5 py-1 rounded border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer"
          title="Adjust imported council targets for a share split or consolidation"
        >
          ADJUST
        </button>
        {onClearCouncilImport && (
          <button
            onClick={onClearCouncilImport}
            className="text-[10px] px-2.5 py-1 rounded border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 cursor-pointer"
            title="Clear imported council analysis from this stock"
          >
            CLEAR IMPORT
          </button>
        )}
        {councilRunId && (
          <span className="text-[9px] text-muted-foreground font-mono truncate max-w-[200px]">{councilRunId}</span>
        )}
      </div>

      {/* THESIS ROW */}
      <div className="mb-4">
        <label className="text-[10px] font-bold tracking-widest text-caution mb-1 block">INVESTMENT THESIS</label>
        <input
          type="text"
          value={stock.thesis || ''}
          onChange={(e) => onUpdate('thesis' as keyof Stock, e.target.value || null)}
          placeholder="One-line investment thesis..."
          className="w-full px-3 py-1.5 bg-card border border-border/50 rounded text-xs text-foreground placeholder-muted-foreground focus:border-border focus:outline-none"
        />
      </div>

      <div className="grid gap-4 grid-cols-3" style={{ gridTemplateColumns: '240px 1fr 1fr' }}>
        {/* SCENARIO ANALYSIS */}
        <div>
          <label className="text-[10px] font-bold tracking-widest text-caution mb-2 block">SCENARIO ANALYSIS</label>
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr>
                <th className="text-left text-muted-foreground font-normal pb-1"></th>
                <th className="text-center text-destructive font-medium pb-1 px-1">Bear</th>
                <th className="text-center text-caution font-medium pb-1 px-1">Base</th>
                <th className="text-center text-success font-medium pb-1 px-1">Bull</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-muted-foreground py-1 pr-2">PT</td>
                <td className="px-1">
                  <input
                    type="number"
                    value={bear24 || ''}
                    onChange={(e) => onUpdate('bearCasePT' as keyof Stock, parseFloat(e.target.value) || 0)}
                    className="w-full px-1.5 py-0.5 bg-destructive/10 border border-red-500/25 rounded text-center text-destructive text-xs"
                    placeholder="0"
                    step="0.01"
                  />
                </td>
                <td className="px-1">
                  <input
                    type="number"
                    value={base24 || ''}
                    onChange={(e) => onUpdate('baseCasePT' as keyof Stock, parseFloat(e.target.value) || 0)}
                    className="w-full px-1.5 py-0.5 bg-caution/10 border border-caution/20 rounded text-center text-caution text-xs"
                    placeholder="0"
                    step="0.01"
                  />
                </td>
                <td className="px-1">
                  <input
                    type="number"
                    value={bull24 || ''}
                    onChange={(e) => onUpdate('bullCasePT' as keyof Stock, parseFloat(e.target.value) || 0)}
                    className="w-full px-1.5 py-0.5 bg-success/10 border border-success/20 rounded text-center text-success text-xs"
                    placeholder="0"
                    step="0.01"
                  />
                </td>
              </tr>
              <tr>
                <td className="text-muted-foreground py-1 pr-2">Prob%</td>
                <td className="px-1">
                  <input
                    type="number"
                    value={bearProb24 || ''}
                    onChange={(e) => onUpdate('bearProbability' as keyof Stock, parseFloat(e.target.value) || 0)}
                    className="w-full px-1.5 py-0.5 bg-destructive/10 border border-red-500/20 rounded text-center text-destructive text-xs"
                    placeholder="0"
                    min="0"
                    max="100"
                  />
                </td>
                <td className="px-1">
                  <input
                    type="number"
                    value={baseProb24 || ''}
                    onChange={(e) => onUpdate('baseProbability' as keyof Stock, parseFloat(e.target.value) || 0)}
                    className="w-full px-1.5 py-0.5 bg-caution/10 border border-caution/20 rounded text-center text-caution text-xs"
                    placeholder="0"
                    min="0"
                    max="100"
                  />
                </td>
                <td className="px-1">
                  <input
                    type="number"
                    value={bullProb24 || ''}
                    onChange={(e) => onUpdate('bullProbability' as keyof Stock, parseFloat(e.target.value) || 0)}
                    className="w-full px-1.5 py-0.5 bg-success/10 border border-success/20 rounded text-center text-success text-xs"
                    placeholder="0"
                    min="0"
                    max="100"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <div className="mt-2 pt-2 border-t border-border/40">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Current:</span>
              <span className="font-mono text-foreground font-medium">
                {fmtMoney(currentPrice)}
              </span>
            </div>
            <div className="flex justify-between items-center text-xs mt-1">
              <span className="text-muted-foreground">24M Prob-Weighted:</span>
              <span className="font-mono text-foreground font-medium">
                {fmtMoney(weightedPT)}
              </span>
            </div>
            {totalProb24 > 0 && Math.abs(totalProb24 - 100) > 0.1 && (
              <div className="text-[10px] text-warning mt-1">
                Probabilities sum to {totalProb24.toFixed(0)}% (should be 100%)
              </div>
            )}
          </div>
        </div>

        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold tracking-widest text-caution">CATALYSTS</label>
            <button
              onClick={addCatalyst}
              className="text-[10px] px-2 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded hover:bg-primary/30 cursor-pointer"
            >
              + ADD
            </button>
          </div>
          <div className="flex-1 min-h-0 border border-border/40 rounded p-2">
            <div className="space-y-2 h-full overflow-y-auto pr-0.5">
              {catalysts.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-4 border border-border/30 rounded bg-muted/20">
                  No catalysts added
                </div>
              )}
              {catalystsForDisplay.map((catalyst) => (
                <div key={catalyst._idx} className="border border-border/40 rounded-md bg-card p-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <select
                      value={catalyst.impact}
                      onChange={(e) => updateCatalyst(catalyst._idx, 'impact', e.target.value)}
                      className={`px-2 py-0.5 border rounded text-[10px] font-semibold w-[62px] ${impactToneClass(catalyst.impact)}`}
                    >
                      <option value="HIGH">HIGH</option>
                      <option value="MED">MED</option>
                      <option value="LOW">LOW</option>
                    </select>
                    <input
                      type="text"
                      value={catalystEditTiming(catalyst)}
                      onChange={(e) => updateCatalystTiming(catalyst._idx, e.target.value)}
                      placeholder={catalystTimeLabelPlaceholder}
                      className="flex-1 min-w-0 px-1.5 py-0.5 bg-card border border-border/50 rounded text-[11px] text-foreground"
                    />
                    <button
                      onClick={() => removeCatalyst(catalyst._idx)}
                      className="text-destructive hover:text-destructive/70 text-[11px] px-1.5 py-0.5 border border-destructive/30 rounded cursor-pointer"
                      title="Remove catalyst"
                    >
                      Remove
                    </button>
                  </div>
                  <input
                    type="text"
                    value={catalyst.name}
                    onChange={(e) => updateCatalyst(catalyst._idx, 'name', e.target.value)}
                    placeholder="Catalyst name..."
                    className="w-full px-2 py-1 bg-card border border-border/50 rounded text-xs text-foreground placeholder-muted-foreground"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* GANTT TIMELINE */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold tracking-widest text-caution">TIMELINE (24M)</label>
          </div>
          <div className="bg-card border border-border/40 rounded p-2">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" aria-label="24 month scenario timeline">
              <defs>
                <linearGradient id="rpRibbonGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(51,192,143,0.26)" />
                  <stop offset="100%" stopColor="rgba(224,89,82,0.20)" />
                </linearGradient>
              </defs>
              <rect x={margin.left} y={margin.top} width={plotW} height={plotH} style={{ fill: 'var(--card)' }} />
              {yTicks.map((tick) => {
                const yCoord = y(tick)
                return (
                  <g key={`yt-${tick}`}>
                    <line x1={margin.left} y1={yCoord} x2={margin.left + plotW} y2={yCoord} style={{ stroke: 'var(--border)', strokeOpacity: 0.4 }} />
                    <text x={margin.left - 8} y={yCoord + 4} textAnchor="end" style={{ fill: 'var(--muted-foreground)' }} fontSize="10">
                      {fmtMoney(tick)}
                    </text>
                  </g>
                )
              })}
              {[0, 6, 12, 18, 24].map((m) => (
                <g key={`xt-${m}`}>
                  <line x1={x(m)} y1={margin.top} x2={x(m)} y2={margin.top + plotH} style={{ stroke: 'var(--border)', strokeOpacity: 0.3 }} />
                  <text x={x(m)} y={margin.top + plotH + 17} textAnchor="middle" style={{ fill: 'var(--muted-foreground)' }} fontSize="10">
                    {m === 0 ? 'Now' : `${m}M`}
                  </text>
                </g>
              ))}
              {yearLabels.map((entry) => (
                <text key={entry.label} x={x(entry.m)} y={margin.top + plotH + 33} textAnchor="middle" style={{ fill: 'var(--foreground)' }} fontSize="11">
                  {entry.label}
                </text>
              ))}
              <polygon points={ribbonPoints} fill="url(#rpRibbonGrad)" />

              {Object.entries(series).map(([key, points]) => {
                const stroke = key === 'bear' ? 'var(--destructive)' : key === 'bull' ? 'var(--success)' : 'var(--caution)'
                return (
                  <g key={key}>
                    <polyline
                      points={points.map((p) => `${x(p.m)},${y(p.v)}`).join(' ')}
                      fill="none"
                      stroke={stroke}
                      strokeWidth="2.7"
                      strokeOpacity={key === 'base' ? 1 : 0.5}
                    />
                    {points.map((p) => (
                      <g key={`${key}-${p.m}`}>
                        <circle cx={x(p.m)} cy={y(p.v)} r="4.8" fill={stroke} />
                        <text x={x(p.m)} y={y(p.v) - 8} textAnchor="middle" style={{ fill: 'var(--foreground)' }} fontSize="11">
                          {fmtMoney(p.v)}
                        </text>
                      </g>
                    ))}
                  </g>
                )
              })}

              <polyline
                points={weightedSeries.map((p) => `${x(p.m)},${y(p.v)}`).join(' ')}
                fill="none"
                style={{ stroke: 'var(--foreground)' }}
                strokeWidth="2.2"
                strokeDasharray="none"
                strokeOpacity="0.35"
              />
              {weightedSeries.map((p) => (
                <g key={`weighted-${p.m}`}>
                  <circle cx={x(p.m)} cy={y(p.v)} r="5.4" style={{ fill: 'var(--foreground)' }} />
                  <circle cx={x(p.m)} cy={y(p.v)} r="2.4" style={{ fill: 'var(--card)' }} />
                </g>
              ))}
            </svg>
            <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
              {timelineRows.length > 0 ? timelineRows.map((row, idx) => (
                <div key={`${row.name}-${idx}`} className="grid grid-cols-[140px_1fr] items-center gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] text-foreground truncate">{row.name || 'Untitled'}</div>
                    <div className="text-[9px] text-muted-foreground">{row.period}</div>
                  </div>
                  <svg viewBox={`0 0 ${width} 16`} className="w-full h-[14px]">
                    <line x1={x(0)} y1={8} x2={x(24)} y2={8} style={{ stroke: 'var(--border)', strokeOpacity: 0.5 }} />
                    <circle
                      cx={x(row.offset)}
                      cy={8}
                      r={5.5}
                      fill={row.tone === 'bear' ? 'var(--destructive)' : row.tone === 'bull' ? 'var(--success)' : 'var(--caution)'}
                      opacity={0.9}
                    />
                  </svg>
                </div>
              )) : (
                <div className="text-[10px] text-muted-foreground text-center py-2">
                  Add catalysts with future dates to see timeline impact.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {adjustOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAdjustOpen(false)
          }}
        >
          <div className="w-full max-w-[340px] rounded-lg border border-border bg-card p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">Adjust Price</div>
              <button
                type="button"
                onClick={() => setAdjustOpen(false)}
                className="rounded border border-border/60 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                aria-label="Close adjust price dialog"
              >
                x
              </button>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => selectAdjustType('consolidation')}
                className={`rounded border px-2 py-1.5 text-xs ${
                  adjustType === 'consolidation'
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground'
                }`}
              >
                Consolidation
              </button>
              <button
                type="button"
                onClick={() => selectAdjustType('split')}
                className={`rounded border px-2 py-1.5 text-xs ${
                  adjustType === 'split'
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground'
                }`}
              >
                Split
              </button>
            </div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Ratio</label>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <input
                value={oldUnits}
                onChange={(event) => setOldUnits(event.target.value)}
                inputMode="decimal"
                className="w-full rounded border border-border/60 bg-background px-2 py-1.5 text-center text-sm text-foreground"
              />
              <span className="text-muted-foreground">:</span>
              <input
                value={newUnits}
                onChange={(event) => setNewUnits(event.target.value)}
                inputMode="decimal"
                className="w-full rounded border border-border/60 bg-background px-2 py-1.5 text-center text-sm text-foreground"
              />
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              10:1 means 10 old shares became 1 new share.
            </div>
            {adjustError && <div className="mt-2 text-xs text-destructive">{adjustError}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdjustOpen(false)}
                className="rounded border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyAdjustment}
                className="rounded border border-primary/40 bg-primary/15 px-3 py-1.5 text-xs text-primary hover:bg-primary/25"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
