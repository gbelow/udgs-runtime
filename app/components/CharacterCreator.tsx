'use client'

import { useState } from 'react'
import { WeaponPanel } from './WeaponPanel';
import { ArmorPanel } from './ArmorPanel';
import { ContainerPanel } from './ContainerPanel';
import { HandsPanel } from './HandsPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { Button, NumberInput, SectionLabel, StatTile, TextInput, Tiles, inputClass } from './ui';
import { Characteristics, Movement, Skills } from '../domain/types';
import { useGameCommands } from '../hooks/useGameCommands';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip } from './SkillTooltip';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useTextLens } from '../hooks/useTextLens';
import { useActiveCharacterData, useSTARegen } from '../hooks/useCharacterData';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useActiveCharacterDataLens } from '../hooks/useCharacterDataLens';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useKnowledgeLens, useKnowledgeTerms } from '../hooks/useKnowledgeLens';
import { CONVICTIONS } from '../domain/lists';

const MOVES: { name: keyof Movement, title: string }[] = [
  { name: 'basic', title: 'basic · 1AP' },
  { name: 'careful', title: 'careful · 1AP' },
  { name: 'crawl', title: 'crawl · 1AP' },
  { name: 'run', title: 'run · 2AP' },
  { name: 'swim', title: 'swim · 1AP' },
  { name: 'jump', title: 'jump · 1AP+1STA' },
  { name: 'stand', title: 'stand up' },
]
const ATTRIBUTES: (keyof Characteristics)[] = ['STR', 'AGI', 'STA', ]
const TALENTS: (keyof Characteristics)[] = [ 'CON', 'DEX', 'INT', 'SPI']
const TRAINABLES: (keyof Characteristics)[] = ['melee', 'ranged', 'awareness', 'sorcery', 'charisma', 'devotion']
const COMBAT: (keyof Skills)[] = ['strike', 'accuracy', 'defend', 'reflex', 'grapple', 'force', 'SD']
const PHYSICAL: (keyof Skills)[] = ['balance', 'climb', 'swim', 'detection', 'stealth', 'prestidigitation', 'health']
const MIND: (keyof Skills)[] = ['cunning', 'explore', 'will', 'persuasion', 'deception', 'insight']

function SaveBaseCharacterButton(){
  const { saveBaseCharacter } = useGameCommands()
  return <Button onClick={() => saveBaseCharacter()}>save base</Button>
}

function SavePlayerCharacterButton(){
  const { savePlayerCharacter } = useGameCommands()
  return <Button variant='primary' onClick={() => savePlayerCharacter()}>save</Button>
}

function DeleteCharacterButton(){
  const { removeBaseCharacter } = useGameCommands()
  const { name } = useActiveCharacterData()
  const [showConfirm, setShowConfirm] = useState(false);

  const handleDeleteCharacterClick = async () => {
    await removeBaseCharacter()
    setShowConfirm(false)
  }

  return(
    <>
      <Button variant='bad' onClick={()=> setShowConfirm(true)}>delete</Button>
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="p-4 rounded-md border border-line bg-surface shadow-lg w-72 flex flex-col gap-4">
            <p className="text-sm">Delete {name}? This removes the base character file.</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setShowConfirm(false)}>cancel</Button>
              <Button variant='bad' className='bg-bad/15' onClick={handleDeleteCharacterClick}>delete</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ResetAllSkillsButton(){
  const { resetAllSkills } = useCharacterCommands()
  return <Button variant='ghost' size='xs' onClick={() => resetAllSkills()}>reset all skills</Button>
}

export function CharacterCreator() {

  const STA = useCharacteristicLens('STA')[0] ?? 0
  // combat.tex "Rest" — recovery amount comes from the domain, not from here.
  const STARegen = useSTARegen()

  return (
    <div className='grid grid-cols-1 md:grid-cols-12 w-full gap-4 py-3 text-left'>
      <div className='md:col-span-7 flex flex-col gap-3 text-sm'>
        <div className='flex flex-row flex-wrap items-center gap-2'>
          <TextItem keyName={'name'} mode='normal'/>
          <SaveBaseCharacterButton />
          <span className='ml-auto text-xs text-muted'>AP <span className='font-mono text-fg'>6</span> · STA <span className='font-mono text-fg'>{STA}</span> · STA regen <span className='font-mono text-fg'>{STARegen}</span></span>
        </div>

        <div className='flex flex-col gap-1'>
          <SectionLabel>Movement</SectionLabel>
          <Tiles>{MOVES.map((m) => <Movementinput key={m.name} movementName={m.name} title={m.title} />)}</Tiles>
        </div>

        <div className='flex flex-row gap-3'>
          <div className='flex flex-col gap-1'>
            <SectionLabel>Attributes</SectionLabel>
            <Tiles>
              {ATTRIBUTES.map((s) => <StatDial key={s} stat={s} title={s} />)}
              <NumberDial stat={'size'} title={'size'} />
            </Tiles>
          </div>
            <div className='flex flex-col gap-1'>
            <SectionLabel>Talents</SectionLabel>
            <Tiles>
              {TALENTS.map((s) => <StatDial key={s} stat={s} title={s} />)}
            </Tiles>
          </div>
        </div>

        <div className='flex flex-col gap-1'>
          <SectionLabel>Trainables</SectionLabel>
          <Tiles>
            {TRAINABLES.map((s) => <StatDial key={s} stat={s} title={s} />)}
            <ConvictionDial trainableName={'conviction1'} fallbackTitle={'conviction 1'} />
            <ConvictionDial trainableName={'conviction2'} fallbackTitle={'conviction 2'} />
          </Tiles>
        </div>

        <div className='flex flex-col gap-1'>
          <div className='flex flex-row items-baseline gap-3'><SectionLabel>Combat</SectionLabel><ResetAllSkillsButton /></div>
          <Tiles>{COMBAT.map((s) => <SkillItem key={s} skillName={s} title={s} />)}</Tiles>
        </div>
        <div className='flex flex-col gap-1'>
          <SectionLabel>Physical</SectionLabel>
          <Tiles>{PHYSICAL.map((s) => <SkillItem key={s} skillName={s} title={s} />)}</Tiles>
        </div>
        <div className='flex flex-col gap-1'>
          <SectionLabel>Mind &amp; social</SectionLabel>
          <Tiles>{MIND.map((s) => <SkillItem key={s} skillName={s} title={s} />)}</Tiles>
        </div>

        <KnowledgePanel />

        <TextItem aria-label='notes' keyName='notes' mode='large'/>
        <div className='flex flex-row gap-2'>
          <SavePlayerCharacterButton />
          <DeleteCharacterButton />
        </div>
      </div>
      <div className='flex flex-col md:col-span-5 gap-3 text-sm'>
        <ArmorPanel/>
        <HandsPanel />
        <WeaponPanel />
        <ContainerPanel />
        <AbilityPanel />
        <SpellPanel />
      </div>
    </div>
  )
}

function ResetFooter({ onClick, label = 'reset' }: { onClick: () => void, label?: string }){
  return <button type='button' className='text-[10px] text-muted hover:text-fg cursor-pointer' onClick={onClick}>{label}</button>
}

function SkillItem({ title, skillName}:{title: string, skillName: keyof Skills}){
  const { resetSkill } = useCharacterCommands()
  const [ value, setValue, terms, view] = useSkillLens(skillName)

  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={title} value={value} onChange={setValue} modifier={view.modifier} afflicted={view.afflicted}
        footer={<ResetFooter onClick={() => resetSkill(skillName)} />} />
    </SkillTooltip>
  )
}

function KnowledgePanel(){
  const { knowledges, available: availableDefaults, add } = useKnowledgeLens()
  const [selected, setSelected] = useState('')
  const [customName, setCustomName] = useState('')

  const existingNames = Object.keys(knowledges)

  const handleAdd = () => {
    const name = customName.trim() || selected
    if(!name || existingNames.includes(name)) return
    add(name)
    setSelected('')
    setCustomName('')
  }

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Knowledge</SectionLabel>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <select className={`${inputClass} text-sm py-0.5 bg-surface`} title='knowledge' value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value=''>— knowledge —</option>
          {availableDefaults.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <TextInput className='w-32' placeholder='custom name' value={customName} onChange={(e) => setCustomName(e.target.value)} />
        <Button onClick={handleAdd}>add</Button>
      </div>
      <Tiles>
        {existingNames.map(name => (
          <KnowledgeItem key={name} name={name} />
        ))}
      </Tiles>
    </div>
  )
}

function KnowledgeItem({ name }:{ name: string }){
  const { getValue, setValue, remove } = useKnowledgeLens()
  const [terms, view] = useKnowledgeTerms(name)
  const value = getValue(name)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={name} title={name} value={value} onChange={(v) => setValue(name, v)} modifier={view.modifier} afflicted={view.afflicted}
        footer={<ResetFooter label='remove' onClick={() => remove(name)} />} />
    </SkillTooltip>
  )
}

function StatDial ({stat, title}:{stat: keyof Characteristics, title: string}){
  const [value, setValue, terms, view] = useCharacteristicLens(stat)

  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={title} value={value} onChange={setValue} modifier={view.modifier} afflicted={view.afflicted} />
    </SkillTooltip>
  )
}

function ConvictionDial ({trainableName, fallbackTitle}:{trainableName: 'conviction1' | 'conviction2', fallbackTitle: string}){
  const [value, setValue] = useCharacteristicLens(trainableName)
  const [name, setName] = useTrainableNameLens(trainableName)

  return(
    <div className='flex flex-col gap-px w-24 rounded border border-line bg-surface px-1 py-1 text-center'>
      <select className={`${inputClass} bg-surface text-[10px] py-0 w-full`} title={fallbackTitle} value={name} onChange={(e) => setName(e.target.value)}>
        <option value=''>{fallbackTitle}</option>
        {Object.values(CONVICTIONS).map(conviction => (
          <option key={conviction.id} value={conviction.name}>{conviction.name}</option>
        ))}
      </select>
      <NumberInput className='w-full text-sm py-0.5' title={fallbackTitle} value={value} onChange={(e) => setValue(parseInt(e.target.value))} />
    </div>
  )
}

function NumberDial ({stat, title}:{stat: 'size' | 'TGH', title: string}){
  const [value, setValue] = useActiveCharacterDataLens(stat)
  return <StatTile label={title} value={value} onChange={setValue} />
}

const TextItem = ({keyName, mode}:{keyName: 'name' | 'notes', mode: 'normal' | 'large'}) => {
  const [value, setValue] = useTextLens(keyName)

  return mode == 'large' ?
    <textarea aria-label='notes' className={`${inputClass} p-1 min-h-32 w-full text-sm bg-surface`} value={value+''} onChange={(e) => setValue(e.target.value)} /> :
    <TextInput className='w-64 text-base font-medium' title={keyName} placeholder='name' value={value+''} onChange={(e) => setValue(e.target.value)} />
}

function Movementinput  ({movementName, title}:{movementName: keyof Movement, title: string}){
  const [value, setValue] = useMovementLens(movementName)
  return <StatTile label={title} value={value} onChange={setValue} step={0.1} className='w-22' />
}
