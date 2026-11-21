export type Cycle = { id: string; start_date: string }
export type Prediction = {
  status: 'estimated' | 'insufficient' | 'irregular' | 'pending' | 'stale'
  basis?: 'history' | 'declared'
  cycle_length?: number
  next_period?: string
  ovulation?: string
  fertile_from?: string
  fertile_to?: string
}
export type Dashboard = {
  consented: boolean
  cycles: Cycle[]
  usual_length: number | null
  irregular: boolean
  prediction: Prediction
}

export function dateKey(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function asDate(key: string): Date {
  return new Date(key + 'T12:00:00')
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12)
}

export function dayDifference(start: string, end: string): number {
  return (Date.parse(end) - Date.parse(start)) / 86_400_000
}

export function formatDate(key: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('es-PE', options).format(asDate(key))
}

export function titleCase(value: string): string {
  return value.charAt(0).toLocaleUpperCase('es') + value.slice(1)
}

export const today = dateKey(new Date())

export function demoEstimate(cycles: Cycle[], usualLength: number | null, irregular: boolean): Prediction {
  const dates = [...new Set(cycles.map(cycle => cycle.start_date))].sort().slice(-7)
  const lengths = dates.slice(1).map((date, index) => dayDifference(dates[index], date))
  if (
    irregular ||
    lengths.some(length => length < 21 || length > 35) ||
    (lengths.length > 0 && Math.max(...lengths) - Math.min(...lengths) > 7) ||
    (lengths.length < 2 && usualLength !== null && (usualLength < 21 || usualLength > 35))
  ) return { status: 'irregular' }

  const fromHistory = lengths.length >= 2
  const length = fromHistory
    ? Math.round(lengths.reduce((sum, item) => sum + item, 0) / lengths.length)
    : usualLength
  const latest = dates.at(-1)
  if (!latest || length === null) return { status: 'insufficient' }

  const start = asDate(latest)
  const nextPeriod = dateKey(addDays(start, length))
  if (nextPeriod < today) return { status: 'stale' }
  const ovulation = addDays(start, length - 15)
  return {
    status: 'estimated',
    basis: fromHistory ? 'history' : 'declared',
    cycle_length: length,
    next_period: nextPeriod,
    ovulation: dateKey(ovulation),
    fertile_from: dateKey(addDays(ovulation, -5)),
    fertile_to: dateKey(ovulation),
  }
}

export function demoDashboard(): Dashboard {
  const cycles = [13, 41, 69].map((days, index) => ({
    id: `demo-${index}`,
    start_date: dateKey(addDays(asDate(today), -days)),
  }))
  return {
    consented: true,
    cycles,
    usual_length: 28,
    irregular: false,
    prediction: demoEstimate(cycles, 28, false),
  }
}
