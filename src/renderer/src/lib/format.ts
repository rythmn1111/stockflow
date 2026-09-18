import { format, formatDistanceToNowStrict, isThisYear, isToday, isTomorrow, isYesterday } from 'date-fns'

/**
 * Quantities print without trailing zeros: a count of screws should read "12", not
 * "12.0000", but 2.5 kg has to stay 2.5. Fixed decimals on a stock report make every
 * number harder to scan.
 */
export function formatQty(value: number | null | undefined, unit?: string): string {
  if (value == null) return '—'
  const rounded = Math.round(value * 10_000) / 10_000
  const text = Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return unit ? `${text} ${unit}` : text
}

export function formatWeight(kg: number | null | undefined): string {
  if (kg == null) return '—'
  if (kg === 0) return '0 kg'
  // Grams below a kilo, tonnes above a thousand: nobody reads "0.045 kg".
  if (Math.abs(kg) < 1) return `${Math.round(kg * 1000).toLocaleString()} g`
  if (Math.abs(kg) >= 1000) return `${(kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} t`
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—'
  const date = new Date(ts)
  if (isToday(date)) return 'Today'
  if (isTomorrow(date)) return 'Tomorrow'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, isThisYear(date) ? 'd MMM' : 'd MMM yyyy')
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—'
  const date = new Date(ts)
  if (isToday(date)) return `Today, ${format(date, 'h:mm a')}`
  if (isYesterday(date)) return `Yesterday, ${format(date, 'h:mm a')}`
  return format(date, isThisYear(date) ? 'd MMM, h:mm a' : 'd MMM yyyy, h:mm a')
}

/** For a date input, which needs yyyy-MM-dd in local time. */
export function toDateInput(ts: number | null | undefined): string {
  if (!ts) return ''
  return format(new Date(ts), 'yyyy-MM-dd')
}

/** Parses a date input back to a timestamp at local midnight. */
export function fromDateInput(value: string): number | null {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d).getTime()
}

export function formatRelative(ts: number | null | undefined): string {
  if (!ts) return 'never'
  const diff = Date.now() - ts
  if (Math.abs(diff) < 60_000) return 'just now'
  return diff > 0 ? `${formatDistanceToNowStrict(new Date(ts))} ago` : `in ${formatDistanceToNowStrict(new Date(ts))}`
}

/** "Due in 3 days" / "4 days overdue" — the phrasing an order list needs. */
export function formatDue(ts: number | null | undefined): { label: string; tone: 'overdue' | 'soon' | 'later' | 'none' } {
  if (!ts) return { label: 'No due date', tone: 'none' }
  const diff = ts - Date.now()
  if (diff < 0) return { label: `${formatDistanceToNowStrict(new Date(ts))} overdue`, tone: 'overdue' }
  if (diff < 3 * 86_400_000) return { label: `Due in ${formatDistanceToNowStrict(new Date(ts))}`, tone: 'soon' }
  return { label: `Due ${formatDate(ts)}`, tone: 'later' }
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`
}

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  planned: 'Planned',
  in_production: 'In production',
  completed: 'Completed',
  cancelled: 'Cancelled'
}

export const MOVE_REASON_LABELS: Record<string, string> = {
  purchase: 'Purchase received',
  issue: 'Issued to order',
  production: 'Production booked',
  sale: 'Dispatched',
  return: 'Return',
  adjustment: 'Stock-take adjustment',
  opening: 'Opening balance',
  other: 'Other'
}
