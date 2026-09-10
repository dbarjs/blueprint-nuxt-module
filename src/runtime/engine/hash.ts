/**
 * Canonical JSON (sorted keys, no whitespace — RFC 8785 spirit) and a
 * FNV-1a 64-bit content hash. The hash of the canonical document is the
 * version id records pin (`createdUnder`).
 */

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonicalize: non-finite number')
    return value === undefined ? 'null' : JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const keys = Object.keys(value as object).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`
}

/**
 * Two independent 32-bit FNV-1a passes (different seeds) concatenated into a
 * 16-hex-digit digest. No BigInt, so it runs on every target the module
 * transpiles to.
 */
export function fnv1a64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  const pass = (seed: number) => {
    let hash = seed >>> 0
    for (const byte of bytes) {
      hash ^= byte
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }
  return pass(0x811C9DC5) + pass(0x050C5D1F)
}

export function hashDocument(document: unknown): string {
  return fnv1a64(canonicalize(document))
}

/** Sortable, URL-safe id (time prefix + random suffix). */
export function createId(prefix = ''): string {
  const time = Date.now().toString(36).toUpperCase()
  const random = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')
  return `${prefix}${time}${random}`
}
