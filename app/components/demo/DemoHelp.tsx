'use client'
import { useState } from 'react'
import { ChevronDown, ChevronRight, CircleHelp, X } from 'lucide-react'
import type { DemoHint } from '../../domain/demo'
import { Dropdown, IconButton, SectionLabel } from '../ui'

// What the visitor is told of the game: everything while they pick their
// party, the basics while they place it, each hint where it first applies,
// and all of it again under "how to play".

const OBJECTIVE = 'Be the last side standing. A character is out when they collapse from their injuries, die or surrender.'

const BASICS = [
  { title: 'Where to act', text: 'Double click a character, start your turn, then click a cell, a foe or an item. The options will appear on the screen.' },
  { title: 'AP lasts the whole round', text: 'Attacks, moves and defenses all spend Action Points(AP), and it comes back only next round: keep some to defend.' },
  { title: 'Turns have no fixed order', text: 'There is no turn order. Enemies will try to start theirs, so contest them to take yours.' },
  { title: 'Injury Level', text: 'If a character\'s IL reaches 50, they are out of the game.' },
]

const HINTS: Record<DemoHint, { title: string, text: string }> = {
  action: { title: 'Actions', text: 'Pressing commit, roll or done in the action bar is irreversible. ' },
  answer: { title: 'Reactions', text: 'You need to choose reactions to things others do to you, which usally happens outside your turn. Reactions cost AP, and not defending is very bad without armor.' },
  turn: { title: 'STA and bleed', text: 'STA can be used to power actions and do surges, which give reserve AP. Spending 1 STA causes IL damage equal to bleed. Bleed also causes IL damage every end of round.' },
  round: { title: 'Ending the round', text: 'The end round ok button signals that all your characters accept to end the round. Any unspent AP can be used to recover STA.' },
}

function Line({ title, text }: { title: string, text: string }){
  return <p><span className='font-semibold text-fg'>{title}.</span> <span className='text-muted'>{text}</span></p>
}

function Everything(){
  return (
    <>
      <Line title='Objective' text={OBJECTIVE} />
      {[...BASICS, ...Object.values(HINTS)].map((b) => <Line key={b.title} {...b} />)}
    </>
  )
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
      <IconButton icon={X} aria-label='put the hint away' title='put away: it stays under how to play' onClick={onClose} />
    </div>
  )
}

// On the party picker, open until put away.
export function HowToPlay(){
  const [open, setOpen] = useState(true)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section className='flex flex-col gap-2 rounded border border-accent/60 bg-accent/5 p-4'>
      <button type='button' aria-expanded={open} onClick={() => setOpen(!open)} className='flex flex-row items-center gap-2 text-left text-lg font-medium hover:text-accent'>
        <CircleHelp className='w-5 h-5 text-accent' />
        <span className='grow'>How to play</span>
        <Chevron className='w-5 h-5 text-muted' />
      </button>
      {open ? <div className='flex flex-col gap-2'><Everything /></div> : null}
    </section>
  )
}

export function HelpButton(){
  return (
    <Dropdown label='how to play' text={<span className='inline-flex items-center gap-1 text-accent'><CircleHelp className='w-4 h-4' />how to play</span>}>
      {() => <div className='flex flex-col gap-2 max-w-sm'><Everything /></div>}
    </Dropdown>
  )
}
