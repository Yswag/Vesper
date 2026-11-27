import type { AbortSignal } from "scripting"

const stacks = new Map<string, AbortSignal[]>()

export function currentSourceSignal(sourceKey: string): AbortSignal | undefined {
  const stack = stacks.get(sourceKey)
  return stack && stack.length > 0 ? stack[stack.length - 1] : undefined
}

export async function withSourceScope<T>(
  sourceKey: string,
  signal: AbortSignal | undefined,
  fn: () => T | Promise<T>
): Promise<T> {
  if (!signal) return await fn()
  const stack = stacks.get(sourceKey) ?? []
  if (stack.length === 0) stacks.set(sourceKey, stack)
  stack.push(signal)
  try {
    return await fn()
  } finally {
    stack.pop()
    if (stack.length === 0) stacks.delete(sourceKey)
  }
}
