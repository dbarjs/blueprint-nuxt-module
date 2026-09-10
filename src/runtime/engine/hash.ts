/**
 * Canonical form and content hashes (ADR 0013).
 *
 * `canonicalize` follows RFC 8785 (JCS): object keys sorted by UTF-16 code
 * units, no whitespace, numbers in their shortest round-trip form (which is
 * what `JSON.stringify` produces), non-finite numbers refused. The SHA-256
 * of the canonical document, prefixed `sha256:`, is the **version id**
 * records pin (`createdUnder`) and manifests carry. FNV-1a stays for cheap
 * cache keys where a cryptographic digest is not needed.
 */

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonicalize: non-finite number')
    return value === undefined ? 'null' : JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const keys = Object.keys(value as object).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort(compareCodeUnits)
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(',')}}`
}

/** JCS orders keys by UTF-16 code units, which is what `<` does on JS strings. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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

const K = new Uint32Array([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
])

/**
 * SHA-256 of a string (UTF-8), synchronous and dependency-free so the same
 * digest is computed at build time, on the server and in the browser
 * without `crypto.subtle` (async) or `node:crypto` (Node only).
 */
export function sha256(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const length = bytes.length
  const bitLength = length * 8
  const padded = new Uint8Array(((length + 9 + 63) >> 6) << 6)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false)
  view.setUint32(padded.length - 4, bitLength >>> 0, false)

  const h = new Uint32Array([0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19])
  const w = new Uint32Array(64)
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3)
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10)
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number]
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
    h[5] = (h[5]! + f) >>> 0
    h[6] = (h[6]! + g) >>> 0
    h[7] = (h[7]! + hh) >>> 0
  }
  return Array.from(h, word => word.toString(16).padStart(8, '0')).join('')
}

/** Content hash of any JSON value in its canonical form: `sha256:<hex>`. */
export function hashValue(value: unknown): string {
  return `sha256:${sha256(canonicalize(value))}`
}

/**
 * The version id of a document: the hash of its canonical form with the
 * envelope fields that are not product removed (`$schema`, `version`).
 * Same bytes, same id, on every runtime.
 */
export function hashDocument(document: unknown): string {
  if (document && typeof document === 'object' && !Array.isArray(document)) {
    const { $schema: _schema, version: _version, ...rest } = document as Record<string, unknown>
    return hashValue(rest)
  }
  return hashValue(document)
}

/** Alias that reads better where the pin is meant: `createdUnder: { version: versionOf(doc) }`. */
export const versionOf = hashDocument

/** Sortable, URL-safe id (time prefix + random suffix). */
export function createId(prefix = ''): string {
  const time = Date.now().toString(36).toUpperCase()
  const random = Array.from({ length: 8 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(Math.random() * 32)]).join('')
  return `${prefix}${time}${random}`
}
