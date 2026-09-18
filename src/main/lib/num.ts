/**
 * Quantities are REAL because units like kg and litres are real in practice, but
 * floating point makes `0.1 + 0.2 !== 0.3`, and a stock figure that reads
 * "-0.00000000001" destroys trust in the whole register. Everything that leaves the
 * database is rounded to a fixed number of places, and comparisons go through here.
 */
export const QTY_DP = 4
const EPSILON = 1e-9

export function round(value: number, dp = QTY_DP): number {
  if (!Number.isFinite(value)) return 0
  const factor = 10 ** dp
  // The +Number.EPSILON nudge keeps 1.005 from rounding down on binary representation.
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor
}

export function gt(a: number, b: number): boolean {
  return a - b > EPSILON
}

/** Parses a quantity typed by a human: strips separators, rejects nonsense. */
export function parseQty(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? round(raw) : null
  if (typeof raw !== 'string') return null
  const cleaned = raw.replace(/[,  ]/g, '').trim()
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? round(value) : null
}

/** Clamps to zero so a shortage is never reported as a negative number. */
export function atLeastZero(value: number): number {
  return value > 0 ? round(value) : 0
}
