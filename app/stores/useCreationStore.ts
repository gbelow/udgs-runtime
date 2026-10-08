import { create } from 'zustand'
import { CreationDraft } from '../domain/types'
import { makeCreationDraft } from '../domain/factories'

// The creation tab makes a character by the book's steps. There is always a
// draft to work on; making the character hands it to the character tab and
// starts a new one.
type CreationStore = {
  draft: CreationDraft

  updateDraft: (
    updater: (d: CreationDraft) => CreationDraft
  ) => CreationDraft

  newDraft: () => void
}

export const useCreationStore = create<CreationStore>((set, get) => ({
  draft: makeCreationDraft(),

  updateDraft: (updater) => {
    const updated = updater(get().draft)
    set({ draft: updated })
    return updated
  },

  newDraft: () => set({ draft: makeCreationDraft() }),
}))
