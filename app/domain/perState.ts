import type { SceneState } from './scene/types'

// A projection computed once per state object. Every store write replaces the
// state rather than changing it, so a state already seen is one whose view is
// already known: the digest a hook gates on and the view it then renders read
// the same computation.
export function perState<T, S extends object = SceneState>(project: (state: S) => T): (state: S) => T {
  const views = new WeakMap<S, T>()
  return (state) => {
    if (views.has(state)) return views.get(state) as T
    const view = project(state)
    views.set(state, view)
    return view
  }
}

// The same, for a projection over two states written apart, such as the
// campaign and what exploration keeps beside it: computed once per pair.
export function perPair<T, A extends object, B extends object>(project: (pair: { a: A; b: B }) => T): (a: A, b: B) => T {
  const views = new WeakMap<A, WeakMap<B, T>>()
  return (a, b) => {
    const byB = views.get(a) ?? new WeakMap<B, T>()
    views.set(a, byB)
    if (byB.has(b)) return byB.get(b) as T
    const view = project({ a, b })
    byB.set(b, view)
    return view
  }
}

// A projection computed once per set of parts and a key: the parts are objects
// every write replaces rather than changes (a board's terrain, its storeys), so
// the same parts and key give the same result however much of the state around
// them was written since.
export function perParts<T>(): (parts: readonly object[], key: string, project: () => T) => T {
  type Node = { next: WeakMap<object, Node>; done: Map<string, T> }
  const root: Node = { next: new WeakMap(), done: new Map() }
  return (parts, key, project) => {
    let node = root
    for (const part of parts) {
      let next = node.next.get(part)
      if (!next) {
        next = { next: new WeakMap(), done: new Map() }
        node.next.set(part, next)
      }
      node = next
    }
    if (node.done.has(key)) return node.done.get(key) as T
    const result = project()
    node.done.set(key, result)
    return result
  }
}
