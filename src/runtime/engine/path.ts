/** Dot-path helpers shared by the evaluator, actions and validator. */

export function splitPath(path: string): string[] {
  if (!path) return []
  return path.split('.').filter(segment => segment.length > 0)
}

export function getPath(target: unknown, path: string | string[]): unknown {
  const segments = Array.isArray(path) ? path : splitPath(path)
  let current: unknown = target
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Sets a value, creating intermediate objects/arrays. Mutates `target`. */
export function setPath(target: Record<string, unknown>, path: string | string[], value: unknown): void {
  const segments = Array.isArray(path) ? path : splitPath(path)
  if (segments.length === 0) throw new Error('setPath: empty path')
  let current: Record<string, unknown> = target
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]!
    const next = current[segment]
    if (next === null || typeof next !== 'object') {
      const following = segments[index + 1]!
      current[segment] = /^\d+$/.test(following) ? [] : {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]!] = value
}

export function deletePath(target: Record<string, unknown>, path: string | string[]): void {
  const segments = Array.isArray(path) ? path : splitPath(path)
  if (segments.length === 0) return
  const parent = getPath(target, segments.slice(0, -1)) as Record<string, unknown> | undefined
  if (parent && typeof parent === 'object') {
    const last = segments[segments.length - 1]!
    if (Array.isArray(parent)) parent.splice(Number(last), 1)
    else Reflect.deleteProperty(parent, last)
  }
}

export function deepClone<T>(value: T): T {
  if (value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object).filter(key => (a as Record<string, unknown>)[key] !== undefined)
    const keysB = Object.keys(b as object).filter(key => (b as Record<string, unknown>)[key] !== undefined)
    if (keysA.length !== keysB.length) return false
    return keysA.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  }
  return false
}

/** Deep merge of plain objects; arrays and scalars from `source` replace. */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown> | undefined): T {
  if (!source) return target
  for (const [key, value] of Object.entries(source)) {
    const existing = (target as Record<string, unknown>)[key]
    if (isPlainObject(value) && isPlainObject(existing)) {
      deepMerge(existing as Record<string, unknown>, value as Record<string, unknown>)
    }
    else {
      (target as Record<string, unknown>)[key] = deepClone(value)
    }
  }
  return target
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
