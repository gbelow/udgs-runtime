'use client'

import { useState } from 'react'
import { FileText, Save, Trash2 } from 'lucide-react'
import { WeaponPanel } from './WeaponPanel';
import { ArmorPanel } from './ArmorPanel';
import { ContainerPanel } from './ContainerPanel';
import { HandsPanel } from './HandsPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { BudgetChip, Button, Combobox, CollectionSelect, NumberInput, SectionLabel, StatTile, TextInput, Tiles, inputClass } from './ui';
import { useExperience } from '../hooks/useExperience';
import { useCollectionFilter } from '../hooks/useCollections';
import { MovementPanel } from './MovementPanel';
import { BodyEditor, Creature, NaturalArmor } from './CreatureEditor';
import { useRaceBaseline } from '../hooks/useRace';
import { useEditorTab } from '../hooks/useGameTab';
import type { EditorTab } from '../stores/useAppStore';
import { SensesPanel } from './SensesPanel';
import { Attributes, Characteristics, Knowledges, Skills } from '../domain/types';
import { useGameCommands } from '../hooks/useGameCommands';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip } from './SkillTooltip';
import { useAttributeLevelUp, useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useActiveCharacterDataLens } from '../hooks/useCharacterDataLens';
import { useTextLens } from '../hooks/useTextLens';
import { useTagLens } from '../hooks/useTagLens';
import type { TagLevel } from '../domain/character/lenses/tags';
import { useActiveCharacterData } from '../hooks/useCharacterData';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useFormalKnowledgeLens, useKnowledgeTerms, useSpecificKnowledges } from '../hooks/useKnowledgeLens';
import { LIMIT_STRESS_ACTIONS, TEMPERAMENT_CONVICTIONS, WORLDVIEW_CONVICTIONS, knowledges_list, type LimitStressAction } from '../domain/lists';

const ATTRIBUTES: (keyof Attributes)[] = ['STR', 'AGI', 'STA', ]
const TALENTS: (keyof Characteristics)[] = [ 'CON', 'DEX', 'INT', 'SPI']
const TRAINABLES: (keyof Characteristics)[] = ['melee', 'ranged', 'awareness', 'sorcery', 'charisma', 'devotion']
const COMBAT: (keyof Skills)[] = ['strike', 'accuracy', 'defend', 'reflex', 'grapple', 'force', 'SD']
const PHYSICAL: (keyof Skills)[] = ['balance', 'climb', 'swim', 'detection', 'stealth', 'prestidigitation', 'health']
const MIND: (keyof Skills)[] = ['cunning', 'explore', 'will', 'persuasion', 'deception', 'insight']

function SaveCatalogCharacterButton(){
  const { saveCatalogCharacter, devServer } = useGameCommands()
  return devServer ? <Button onClick={() => saveCatalogCharacter()}>save to catalog</Button> : null
}

function SavePlayerCharacterButton(){
  const { savePlayerCharacter } = useGameCommands()
  return <Button weight='solid' tone='accent' icon={Save} onClick={() => savePlayerCharacter()}>save</Button>
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
      <Button tone='bad' icon={Trash2} onClick={()=> setShowConfirm(true)}>delete</Button>
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="p-4 rounded-md border border-line bg-surface shadow-lg w-72 flex flex-col gap-4">
            <p className="text-sm">Delete {name}? This removes the base character file.</p>
            <div className="flex justify-end gap-2">
              <Button weight='ghost' onClick={() => setShowConfirm(false)}>cancel</Button>
              <Button weight='solid' tone='bad' icon={Trash2} onClick={handleDeleteCharacterClick}>delete</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// creating.tex "Races": the race the character is measured against. Choosing
// it changes nothing of the character; applying it puts its creature, bonuses
// and abilities on the character as a preset.
function RacePicker(){
  const { races, race, choose, apply } = useRaceBaseline()
  const filter = useCollectionFilter('races')
  return(
    <div className='flex flex-row items-center gap-1'>
      <SectionLabel>Race</SectionLabel>
      <CollectionSelect label='race collection' filter={filter} />
      <select aria-label='race' className={`${inputClass} bg-surface text-sm`} value={race} onChange={(e) => choose(e.target.value)}>
        <option value=''>— none —</option>
        {filter.keep(races).map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
      <Button disabled={!race} onClick={apply}>apply race</Button>
    </div>
  )
}

function ResetAllSkillsButton(){
  const { resetAllSkills } = useCharacterCommands()
  return <Button weight='subtle' size='xs' onClick={() => resetAllSkills()}>reset all skills</Button>
}

const EDITOR_TAB_LABELS: Record<EditorTab, string> = {
  body: 'Body',
  trainables: 'Trainables',
  gear: 'Gear',
}

// Free creation: every value of the character is changed freely.
export function CharacterCreator() {
  const { tab } = useEditorTab()
  return (
    <div className='flex flex-col w-full text-left text-sm'>
      <EditorHeader />
      <div className='py-3'>
        {tab === 'body' ? <BodyTab /> :
          tab === 'trainables' ? <TrainablesTab /> :
          <GearTab />}
      </div>
    </div>
  )
}

function EditorHeader(){
  const { tab, tabs, setTab } = useEditorTab()
  const [notesOpen, setNotesOpen] = useState(false)
  return(
    <div className='sticky top-0 z-20 flex flex-col gap-2 bg-surface border-b border-line px-1 pt-2'>
      <div className='flex flex-row flex-wrap items-center gap-2'>
        <TextItem keyName={'name'} mode='normal'/>
        <TextItem keyName='token' mode='normal'/>
        <RacePicker />
        <TagItem level='type' />
        <TagItem level='category' />
        <Experience />
        <div className='ml-auto flex flex-row items-center gap-2'>
          <Button icon={FileText} selected={notesOpen} onClick={() => setNotesOpen((open) => !open)}>notes</Button>
          <SaveCatalogCharacterButton />
          <SavePlayerCharacterButton />
          <DeleteCharacterButton />
        </div>
      </div>
      {notesOpen ? <TextItem keyName='notes' mode='large'/> : null}
      <div className='flex flex-row items-stretch' role='tablist' aria-label='character parts'>
        {tabs.map((name) => {
          const current = name === tab
          return (
            <button key={name} type='button' role='tab' aria-selected={current} onClick={() => setTab(name)}
              className={`cursor-pointer whitespace-nowrap border-b-2 -mb-px px-4 py-1.5 text-sm
                focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2
                ${current ? 'border-accent font-semibold text-accent' : 'border-transparent text-muted hover:border-muted hover:text-fg'}`}>
              {EDITOR_TAB_LABELS[name]}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// The XP the character is worth, by the talent it was spent from, and its
// karma.
function Experience(){
  const view = useExperience()
  if (!view) return null
  return(
    <div className='flex flex-row items-stretch gap-2'>
      {view.talents.map(({ talent, XP }) => <BudgetChip key={talent} label={talent} spent={XP} />)}
      <BudgetChip label='karma' spent={view.karma} />
    </div>
  )
}

function BodyTab(){
  return(
    <div className='grid grid-cols-12 gap-4'>
      <div className='col-span-5 flex flex-col gap-3'>
        <Creature />
        <div className='flex flex-row flex-wrap items-start gap-4'>
          <div className='flex flex-col gap-1'>
            <SectionLabel>Attributes</SectionLabel>
            <Tiles>
              {ATTRIBUTES.map((s) => <AttributeDial key={s} stat={s} />)}
            </Tiles>
          </div>
          <AttributeLevelUp />
        </div>
        <div className='flex flex-row flex-wrap gap-6'>
          <MovementPanel />
          <SensesPanel />
        </div>
      </div>
      <div className='col-span-7 flex flex-col gap-3'>
        <BodyEditor />
        <NaturalArmor />
      </div>
    </div>
  )
}

// creating.tex "Improving attributes": the target value halved, doubled once
// the average passes 10+CON-SM and +100% for every point beyond. The 10-SM is
// the character's own here, beside what the book has at its size.
function AttributeLevelUp(){
  const [base, setBase] = useActiveCharacterDataLens('attributeSizeBalance')
  const view = useAttributeLevelUp()
  return(
    <div className='flex flex-col gap-1 text-xs pt-4'>
      <div className='flex flex-row items-center gap-1 text-muted'>
        <span>attribute average =</span>
        <NumberInput className='w-10 py-0' aria-label='attribute balance' title='10−SM, before CON' value={base} onChange={(e) => setBase(parseInt(e.target.value) || 0)} />
        {view ? <span>(size {view.size} expects {view.expectedBalance})</span> : null}
      </div>
      <span className='text-muted'>costs double once attribute average passes the balance</span>
    </div>
  )
}

function TrainablesTab(){
  return(
    <div className='grid grid-cols-12 gap-4'>
      <div className='col-span-7 flex flex-col gap-3'>
        <div className='flex flex-col gap-1'>
          <SectionLabel>Talents</SectionLabel>
          <Tiles>
            {TALENTS.map((s) => <StatDial key={s} stat={s} title={s} />)}
          </Tiles>
        </div>
        <div className='flex flex-col gap-1'>
          <SectionLabel>Trainables</SectionLabel>
          <Tiles>
            {TRAINABLES.map((s) => <StatDial key={s} stat={s} title={s} />)}
            <ConvictionDial trainableName={'conviction1'} fallbackTitle={'temperament'} options={TEMPERAMENT_CONVICTIONS} />
            <ConvictionDial trainableName={'conviction2'} fallbackTitle={'worldview'} options={WORLDVIEW_CONVICTIONS} />
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
        <AbilityPanel />
      </div>
      <div className='col-span-5 flex flex-col gap-3'>
        <KnowledgePanel />
        <SpecificKnowledgePanel />
        <LimitStressPicker />
        <SpellPanel />
      </div>
    </div>
  )
}

function GearTab(){
  return(
    <div className='grid grid-cols-2 gap-4'>
      <div className='flex flex-col gap-3'>
        <HandsPanel />
        <WeaponPanel />
        <ArmorPanel />
      </div>
      <div className='flex flex-col gap-3'>
        <ContainerPanel />
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
  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Knowledge</SectionLabel>
      <Tiles>{knowledges_list.map(key => <FormalKnowledgeItem key={key} knowledgeKey={key} />)}</Tiles>
    </div>
  )
}

function FormalKnowledgeItem({ knowledgeKey }:{ knowledgeKey: keyof Knowledges }){
  const [ value, setValue, terms, view ] = useFormalKnowledgeLens(knowledgeKey)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={knowledgeKey} value={value} onChange={setValue} modifier={view.modifier} afflicted={view.afflicted} />
    </SkillTooltip>
  )
}

// story.tex "Specific Knowledge": named freely, learned through learning tests.
function SpecificKnowledgePanel(){
  const { names, add } = useSpecificKnowledges()
  const [customName, setCustomName] = useState('')
  const filter = useCollectionFilter('knowledges')

  const handleAdd = () => {
    add(customName)
    setCustomName('')
  }

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Specific knowledge</SectionLabel>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <Combobox className='w-40' placeholder='a place, a language…' value={customName} options={filter.keys} onChange={setCustomName} />
        <Button onClick={handleAdd}>add</Button>
        <CollectionSelect label='knowledge collection' filter={filter} />
      </div>
      <Tiles>
        {names.map(name => (
          <SpecificKnowledgeItem key={name} name={name} />
        ))}
      </Tiles>
    </div>
  )
}

function SpecificKnowledgeItem({ name }:{ name: string }){
  const { getValue, setValue, remove } = useSpecificKnowledges()
  const [terms, view] = useKnowledgeTerms(name)
  const value = getValue(name)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={name} title={name} value={value} onChange={(v) => setValue(name, v)} modifier={view.modifier} afflicted={view.afflicted}
        footer={<ResetFooter label='remove' onClick={() => remove(name)} />} />
    </SkillTooltip>
  )
}

// creating.tex "Improving attributes": the attribute, with what its next point
// costs.
function AttributeDial ({stat}:{stat: keyof Attributes}){
  const [value, setValue, terms, view] = useCharacteristicLens(stat)
  const next = useAttributeLevelUp()?.rows.find((row) => row.key === stat)?.next
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={stat} value={value} onChange={setValue} modifier={view.modifier} afflicted={view.afflicted}
        footer={<span className='text-[10px] text-muted'>{next === null ? 'max' : `next ${next} XP`}</span>} />
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

function ConvictionDial ({trainableName, fallbackTitle, options}:{trainableName: 'conviction1' | 'conviction2', fallbackTitle: string, options: Record<string, { id: string, name: string }>}){
  const [value, setValue] = useCharacteristicLens(trainableName)
  const [name, setName] = useTrainableNameLens(trainableName)

  return(
    <div className='flex flex-col gap-px w-24 rounded border border-line bg-surface px-1 py-1 text-center'>
      <select className={`${inputClass} bg-surface text-[10px] py-0 w-full`} title={fallbackTitle} value={name} onChange={(e) => setName(e.target.value)}>
        <option value=''>{fallbackTitle}</option>
        {Object.values(options).map(conviction => (
          <option key={conviction.id} value={conviction.name}>{conviction.name}</option>
        ))}
      </select>
      <NumberInput className='w-full text-sm py-0.5' title={fallbackTitle} value={value} onChange={(e) => setValue(parseInt(e.target.value) || 0)} />
    </div>
  )
}

// creating.tex "Limit Stress Actions": each character chooses one.
function LimitStressPicker(){
  const { limitStress } = useActiveCharacterData()
  const { chooseLimitStress } = useCharacterCommands()
  return(
    <div className='flex flex-row gap-2 items-center'>
      <SectionLabel>Limit stress action</SectionLabel>
      <select aria-label='limitStress' className={`${inputClass} bg-surface text-sm`} value={limitStress ?? ''} onChange={(e) => chooseLimitStress((e.target.value || null) as LimitStressAction | null)}>
        <option value=''>none</option>
        {LIMIT_STRESS_ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
    </div>
  )
}

// Where the character is listed in the sidebar.
function TagItem({ level }: { level: TagLevel }){
  const [value, setValue] = useTagLens(level)
  return <TextInput className='w-40' aria-label={level} placeholder={level} value={value} onChange={(e) => setValue(e.target.value)} />
}

const TextItem = ({keyName, mode}:{keyName: 'name' | 'notes' | 'token', mode: 'normal' | 'large'}) => {
  const [value, setValue] = useTextLens(keyName)

  return mode == 'large' ?
    <textarea aria-label='notes' className={`${inputClass} p-1 min-h-32 w-full text-sm bg-surface`} value={value+''} onChange={(e) => setValue(e.target.value)} /> :
    <TextInput className='w-64 text-base font-medium' title={keyName} placeholder={keyName === 'token' ? '/tokens/name.webp' : 'name'} value={value+''} onChange={(e) => setValue(e.target.value)} />
}

