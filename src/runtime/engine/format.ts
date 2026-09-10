/** Deterministic formatting helpers used by the `format` operator. */

export interface FormatOptions {
  currency?: string
  locale?: string
}

export type FormatKind = 'currency' | 'number' | 'percent' | 'integer' | 'date' | 'time' | 'datetime' | 'minutes'

/**
 * Money is stored as integer cents (handoff 4.3). `currency` formats cents;
 * `number` formats a plain number with an optional number of decimals.
 */
export function formatValue(value: unknown, kind: FormatKind, options: FormatOptions & { decimals?: number } = {}): string {
  const locale = options.locale || 'en-US'
  switch (kind) {
    case 'currency': {
      const cents = toNumber(value)
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: options.currency || 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(cents / 100)
    }
    case 'number': {
      const decimals = options.decimals ?? 2
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(toNumber(value))
    }
    case 'integer':
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(toNumber(value))
    case 'percent': {
      const decimals = options.decimals ?? 0
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(toNumber(value))
    }
    case 'minutes': {
      const total = Math.round(toNumber(value))
      if (total < 60) return `${total} min`
      const hours = Math.floor(total / 60)
      const minutes = total % 60
      return minutes ? `${hours} h ${minutes} min` : `${hours} h`
    }
    case 'date':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(toDate(value))
    case 'time':
      return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(toDate(value))
    case 'datetime':
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(toDate(value))
    default:
      return String(value ?? '')
  }
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  if (typeof value === 'string') return new Date(value)
  return new Date(0)
}
