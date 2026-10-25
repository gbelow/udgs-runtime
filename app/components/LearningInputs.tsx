'use client'

import { X } from 'lucide-react'
import { Button, IconButton, NumberInput, TextInput, selectClass } from './ui'
import { LearningTestSchema, SkillKeySchema, type LearningTest, type SkillRef } from '../domain/types'
import { knowledges_list } from '../domain/lists'

const DEGREE_LABELS = ['miss', 'graze', 'hit', 'crit'] as const

const refValue = (ref: SkillRef) => (ref.kind === 'skill' ? `skill:${ref.key}` : `knowledge:${ref.name}`)
const toRef = (value: string): SkillRef => {
  const [kind, name] = value.split(':')
  return kind === 'skill' ? { kind: 'skill', key: SkillKeySchema.parse(name) } : { kind: 'knowledge', name }
}

// story.tex "Learning tests": the skill or formal knowledge tested, the DL,
// the specific knowledge it teaches, the levels each degree gains and the
// level it cannot take anyone past.
export function LearningInputs({ label, learning, set }: { label: string, learning: LearningTest, set: (learning: LearningTest) => void }) {
  return (
    <>
      <select aria-label={`${label} learning test`} className={selectClass} value={refValue(learning.test)} onChange={(e) => set({ ...learning, test: toRef(e.target.value) })}>
        {SkillKeySchema.options.map((k) => <option key={k} value={`skill:${k}`}>{k}</option>)}
        {knowledges_list.map((k) => <option key={k} value={`knowledge:${k}`}>{k} (knowledge)</option>)}
      </select>
      <span className='text-xs text-muted'>DL</span>
      <NumberInput className='w-10' aria-label={`${label} learning DL`} value={learning.DL} onChange={(e) => set({ ...learning, DL: parseInt(e.target.value) || 0 })} />
      <span className='text-xs text-muted'>teaches</span>
      <TextInput className='w-32' aria-label={`${label} learning knowledge`} placeholder='a specific knowledge' value={learning.knowledge} onChange={(e) => set({ ...learning, knowledge: e.target.value })} />
      <LearningGains label={label} gains={learning.gains} set={(gains) => set({ ...learning, gains })} />
      <span className='text-xs text-muted'>up to</span>
      <NumberInput className='w-10' aria-label={`${label} learning max`} value={learning.max} onChange={(e) => set({ ...learning, max: parseInt(e.target.value) || 0 })} />
    </>
  )
}

export function LearningGains({ label, gains, set }: { label: string, gains: LearningTest['gains'], set: (gains: LearningTest['gains']) => void }) {
  return (
    <>
      {DEGREE_LABELS.map((d, i) => (
        <span key={d} className='flex flex-row gap-1 items-center'>
          <span className='text-xs text-muted'>{d}</span>
          <NumberInput className='w-10' aria-label={`${label} learning ${d}`} value={gains[i]}
            onChange={(e) => set(gains.map((g, n) => (n === i ? parseInt(e.target.value) || 0 : g)) as LearningTest['gains'])} />
        </span>
      ))}
    </>
  )
}

// A learning test switched on at its defaults, or off.
export function LearningToggle({ label, learning, set }: { label: string, learning: LearningTest | null, set: (learning: LearningTest | null) => void }) {
  return learning
    ? <IconButton icon={X} tone='bad' aria-label={`${label} no learning test`} onClick={() => set(null)} />
    : <Button size='xs' weight='subtle' aria-label={`${label} add learning test`} onClick={() => set(LearningTestSchema.parse({}))}>+ learning test</Button>
}
