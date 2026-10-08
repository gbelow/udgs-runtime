import type { Character, Lens } from '../../types'
import { isBaseCharacter } from '../../utils'

// Where a base character is listed in the sidebar, as groupByTags reads its
// tags: the first is its type, the second its category. A tag left blank at
// the end is dropped.
export type TagLevel = 'type' | 'category'

function makeTagLens(index: number): Lens<Character, string> {
  return {
    get: (c) => (isBaseCharacter(c) ? c.tags[index] ?? '' : ''),
    set: (c, value) => {
      if (!isBaseCharacter(c)) return c
      const tags = Array.from({ length: Math.max(c.tags.length, index + 1) }, (_, i) => (i === index ? value : c.tags[i] ?? ''))
      while (tags.length && !tags[tags.length - 1]) tags.pop()
      return { ...c, tags }
    },
  }
}

export const tagLenses: Record<TagLevel, Lens<Character, string>> = {
  type: makeTagLens(0),
  category: makeTagLens(1),
}
