'use client'
import { CircleHelp, X } from 'lucide-react'
import type { DemoHint } from '../../domain/demo'
import { Dropdown, IconButton, SectionLabel } from '../ui'

// What the visitor is told of the game: the objective while they pick their
// party, the basics while they place it, and each hint where it first applies.

const OBJECTIVE = 'Be the last side standing. A character is out when they collapse from their injuries, die or surrender.'

const BASICS = [
  { title: 'Turns have no fixed order', text: 'When nobody is in turn, pick a character and press start turn. For a few seconds after a turn is taken it may be contested: the highest cunning roll takes it.' },
  { title: 'AP lasts the whole round', text: 'Attacks, movement and defenses are all paid with it. End a turn with AP left to defend, or to take another turn in the same round.' },
  { title: 'Where to act', text: 'Pick a character from the names along the top, then click a cell, a foe or an item for what they can do there. The panel under the board has all of their actions. Anything closed says why when you hover over it.' },
]

const HINTS: Record<DemoHint, { title: string, text: string }> = {
  action: { title: 'Actions', text: 'Declare, commit, wait for reactions, roll, done. Until you commit, you can cancel it.' },
  answer: { title: 'Reactions', text: 'The fight waits for you. Pick a reaction, paid with AP, or answer with nothing, then press done if it is there.' },
  round: { title: 'Ending the round', text: 'The round ends when everyone agrees: take the turns you want first, then press end round ok. AP left is lost, except what a rest at the round change takes to recover STA.' },
}

function Line({ title, text }: { title: string, text: string }){
  return <p><span className='font-semibold text-fg'>{title}.</span> <span className='text-muted'>{text}</span></p>
}

export function Objective(){
  return <p className='text-base'>{OBJECTIVE}</p>
}

export function Basics(){
  return (
    <div className='flex flex-col gap-2 overflow-y-auto min-h-0'>
      <SectionLabel>how to play</SectionLabel>
      {BASICS.map((b) => <Line key={b.title} {...b} />)}
    </div>
  )
}

export function HintLine({ hint, onClose }: { hint: DemoHint, onClose: () => void }){
  return (
    <div role='note' aria-label='hint' className='flex flex-row items-start gap-2 rounded border border-accent/60 bg-accent/5 px-2 py-1.5 text-xs'>
      <div className='grow'><Line {...HINTS[hint]} /></div>
      <IconButton icon={X} aria-label='put the hint away' title='put away: it stays under the ?' onClick={onClose} />
    </div>
  )
}

export function HelpButton(){
  return (
    <Dropdown label='how to play' icon={CircleHelp}>
      {() => (
        <div className='flex flex-col gap-2 max-w-sm'>
          <Line title='Objective' text={OBJECTIVE} />
          {[...BASICS, ...Object.values(HINTS)].map((b) => <Line key={b.title} {...b} />)}
        </div>
      )}
    </Dropdown>
  )
}
