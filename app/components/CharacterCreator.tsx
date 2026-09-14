'use client'

import { useState } from 'react'
import { WeaponPanel } from './WeaponPanel';
import { ArmorPanel } from './ArmorPanel';
import { ContainerPanel } from './ContainerPanel';
import { HandsPanel } from './HandsPanel';
import { AbilityPanel } from './AbilityPanel';
import { Characteristics, Movement, Skills } from '../domain/types';
import { useGameCommands } from '../hooks/useGameCommands';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip, isAfflicted } from './SkillTooltip';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useTextLens } from '../hooks/useTextLens';
import { useActiveCharacterData, useSTARegen } from '../hooks/useCharacterData';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useActiveCharacterDataLens } from '../hooks/useCharacterDataLens';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useKnowledgeLens } from '../hooks/useKnowledgeLens';
import { CONVICTIONS } from '../domain/lists';

function SaveBaseCharacterButton(){
  const { saveBaseCharacter } = useGameCommands()

  const handleClick = async () => {
    await saveBaseCharacter()
  }

  return(
    <input className='border rounded w-20 p-1' type='button' value={'save base'} onClick={handleClick} />
  )
}

function SavePlayerCharacterButton(){
  const { savePlayerCharacter } = useGameCommands()

  const handleClick = async () => {
    await savePlayerCharacter()
  }

  return(
    <input className='border rounded w-12 p-1' type='button' value={'save'} onClick={handleClick} />
  )
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
      <input className='border rounded bg-red-700 w-12 p-1' type='button' value={'delete'} onClick={()=> setShowConfirm(true)} />
      {showConfirm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black w-64 h-32 m-auto">
          <div className="p-4 rounded shadow-md w-64">
            <p className="mb-4">Are you sure you want to delete {name}?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteCharacterClick}
                className="px-3 py-1 bg-red-500 text-white rounded"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ResetAllSkillsButton(){
  const { resetAllSkills } = useCharacterCommands()

  const handleResetSkills = () => {
    resetAllSkills()
  }

  return(
    <button className='border p-2 rounded m-auto' onClick={handleResetSkills}>Reset Skills</button>
  )
}

export function CharacterCreator() {

  const STA = useCharacteristicLens('STA')[0] ?? 0
  // combat.tex "Rest" — recovery amount comes from the domain, not from here.
  const STARegen = useSTARegen()
  
  return (
    <div className='grid grid-col-1 md:grid-cols-12 w-full px-1 py-2 gap-2'>
      <div className='md:col-span-7 flex flex-col gap-2 text-sm gap-2 px-1'>        
          <div className='flex flex-row justify-center gap-2'>
            <label htmlFor="name" className='font-bold'>Name: </label>
            <TextItem keyName={'name'} mode='normal'/>
            <SaveBaseCharacterButton />
            
          </div>
        <div className='flex flex-row gap-2 justify-center'>
          <div>AP: {6}</div>
          <div>STA: {STA}</div>
          <div>STA regen: {STARegen}</div>
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <Movementinput movementName={'basic'}  title={'basic (1AP)'} />
          <Movementinput movementName={'careful'}  title={'care (1AP)'} />
          <Movementinput movementName={'crawl'}  title={'crawl (1AP)'} />
          <Movementinput movementName={'run'} title={'run (2AP )'} />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <Movementinput movementName={'swim'}  title={'swim (1AP)'} />
          {/* <Movementinput movementName={'fast swim'}  title={'fast swim (1AP+1STA)'} /> */}
          <Movementinput movementName={'jump'}  title={'jump (1AP+1STA)'} />
          <Movementinput movementName={'stand'}  title={'stand up'} />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <StatDial stat={'CON'} title={'CON'} />
          <StatDial stat={'DEX'} title={'DEX'} />
          <StatDial stat={'INT'} title={'INT'} />
          <StatDial stat={'SPI'} title={'SPI'} />
          {/* <StatDial stat={'RES'} title={'RES'} /> */}
          {/* <StatDial stat={'TGH'} title={'TGH'} /> */}
          {/* <StatDial stat={'INS'} title={'INS'} /> */}
          {/* <StatDial stat={gearPen} natStat={gearPen} setStat={setGearPen} title={'Gear pen'} /> */}        
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <StatDial stat={'STR'} title={'STR'} />
          <StatDial stat={'AGI'} title={'AGI'} />
          <StatDial stat={'STA'} title={'STA'} />
          <NumberDial stat={'size'} title={'size'} />
        </div>
        
        <div className='flex flex-row gap-2 justify-center'>
          <StatDial stat={'melee'} title={'Melee'} />
          <StatDial stat={'ranged'} title={'Ranged'} />
          <StatDial stat={'awareness'} title={'Awareness'} />
          <StatDial stat={'sorcery'} title={'Sorcery'} />
          <StatDial stat={'charisma'} title={'Charisma'} />
          <ConvictionDial trainableName={'conviction1'} fallbackTitle={'Conviction1'} />
          <ConvictionDial trainableName={'conviction2'} fallbackTitle={'Conviction2'} />
          <StatDial stat={'devotion'} title={'Devotion'} />
        </div>
        <ResetAllSkillsButton />
        <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'strike'} skillName='strike' title='strike' />
          <SkillItem key={'accuracy'} skillName='accuracy' title='accuracy' />
          <SkillItem key={'defend'} skillName='defend' title='defend' />
          <SkillItem key={'reflex'} skillName='reflex' title='reflex' />
          <SkillItem key={'grapple'} skillName='grapple' title='grapple' />
          <SkillItem key={'force'} skillName='force' title='force' />
          <SkillItem key={'SD'} skillName='SD' title='SD' />
          
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'balance'} skillName='balance' title='balance' />
          <SkillItem key={'climb'} skillName='climb' title='climb' />
          <SkillItem key={'swim'} skillName='swim' title='swim' />
          <SkillItem key={'detection'} skillName='detection' title='detection' />
          <SkillItem key={'stealth'} skillName='stealth' title='stealth' />
          <SkillItem key={'prestidigitation'} skillName='prestidigitation' title='prestidigitation' />
          <SkillItem key={'health'} skillName='health' title='health' />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          {/* <SkillItem key={'knowledge'} skillName='knowledge' title='knowledge' /> */}
          <SkillItem key={'cunning'} skillName='cunning' title='cunning' />
          <SkillItem key={'explore'} skillName='explore' title='explore' />
          <SkillItem key={'will'} skillName='will' title='will' />
          <SkillItem key={'persuasion'} skillName='persuasion' title='persuasion' />
          <SkillItem key={'deception'} skillName='deception' title='deception' />
          <SkillItem key={'insight'} skillName='insight' title='insight' />
          {/* <SkillItem key={'devotion'} skillName='devotion' title='devotion' /> */}
        </div>
        {/* <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'combustion'} skillName='combustion' title='combustion' />
          <SkillItem key={'eletromag'} skillName='eletromag' title='eletromag' />
          <SkillItem key={'radiation'} skillName='radiation' title='radiation' />
          <SkillItem key={'entropy'} skillName='entropy' title='entropy' />
          <SkillItem key={'biomancy'} skillName='biomancy' title='biomancy' />
          <SkillItem key={'telepathy'} skillName='telepathy' title='telepathy' />
          <SkillItem key={'animancy'} skillName='animancy' title='animancy' />
        </div> */}

        <KnowledgePanel />

        <TextItem aria-label='notes' keyName='notes' mode='large'/>
        {/* <textarea aria-label='notes' className='border rounded p-1 min-h-32' onChange={val => setNotes(val.target.value)} value={notes} /> */}
        <div className='flex flex-row gap-2 justify-center'>
          <SavePlayerCharacterButton />
          <DeleteCharacterButton />
        </div>
      </div>
      <div className='flex flex-col text-center md:col-span-5  items-center mx-2 gap-2'>
        <ArmorPanel/>
        <HandsPanel />
        <WeaponPanel />
        <ContainerPanel />
        <AbilityPanel />
      </div>
    </div>
  )
}

function SkillItem({ title, skillName}:{title: string, skillName: keyof Skills}){
  const { resetSkill } = useCharacterCommands()
  const [ value, setValue, terms] = useSkillLens(skillName)
  const afflicted = isAfflicted(terms)
  const resetValue = () => resetSkill(skillName)

  return(
    <SkillTooltip terms={terms} total={value}>
      <div className={`flex flex-col w-10 md:w-16 overflow-hidden rounded ${afflicted ? 'border border-red-500' : ''}`}>
        <label className='text-xs'>{title.slice(0,10)}</label>
        <input className={`p-1 border border-white rounded w-10 md:w-16 text-center ${afflicted ? 'text-red-400' : ''}`} title={title} type='number' inputMode="numeric" value={value} onChange={(e) => setValue(parseInt(e.target.value))} />
        <button type='button' className='text-xs bg-gray-800 border' onClick={resetValue}>Reset</button>
      </div>
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
    <div className='flex flex-col gap-2 items-center'>
      <div className='flex flex-row gap-2 justify-center items-center'>
        <select className='p-1 border border-white rounded bg-black text-white' title='knowledge' value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option className='bg-black text-white' value=''>-- knowledge --</option>
          {availableDefaults.map(name => (
            <option className='bg-black text-white' key={name} value={name}>{name}</option>
          ))}
        </select>
        <input className='p-1 border border-white rounded w-32 text-center' type='text' placeholder='custom name' value={customName} onChange={(e) => setCustomName(e.target.value)} />
        <button type='button' className='border rounded px-2 py-1' onClick={handleAdd}>Add</button>
      </div>
      <div className='flex flex-row flex-wrap gap-2 justify-center'>
        {existingNames.map(name => (
          <KnowledgeItem key={name} name={name} />
        ))}
      </div>
    </div>
  )
}

function KnowledgeItem({ name }:{ name: string }){
  const { getValue, setValue, remove } = useKnowledgeLens()

  return(
    <div className='flex flex-col w-16 overflow-hidden'>
      <label className='text-xs truncate' title={name}>{name}</label>
      <input className='p-1 border border-white rounded w-16 text-center' title={name} type='number' inputMode="numeric" value={getValue(name)} onChange={(e) => setValue(name, parseInt(e.target.value))} />
      <button type='button' className='text-xs bg-gray-800 border' onClick={() => remove(name)}>Remove</button>
    </div>
  )
}

function StatDial ({stat, title}:{stat: keyof Characteristics, title: string}){
  const [value, setValue, terms] = useCharacteristicLens(stat)

  return(
    <SkillTooltip terms={terms} total={value}>
      <div className='flex flex-col w-10 md:w-16 overflow-hidden'>
        <label className='text-xs'>{title}</label>
        <input className='p-1 border border-white rounded w-10 md:w-16 text-center' title={title} type='number' inputMode="numeric" value={value} onChange={(e) => setValue(parseInt(e.target.value))} />
      </div>
    </SkillTooltip>
  )
}

function ConvictionDial ({trainableName, fallbackTitle}:{trainableName: 'conviction1' | 'conviction2', fallbackTitle: string}){
  const [value, setValue] = useCharacteristicLens(trainableName)
  const [name, setName] = useTrainableNameLens(trainableName)

  return(
    <div className='flex flex-col w-16 md:w-24 overflow-hidden'>
      <label className='text-xs truncate'>
        <select className='p-1 mt-1 border border-white rounded w-16 md:w-24 text-center bg-black text-white' title={fallbackTitle} value={name} onChange={(e) => setName(e.target.value)}>
          <option className='bg-black text-white' value=''></option>
          {Object.values(CONVICTIONS).map(conviction => (
            <option className='bg-black text-white' key={conviction.id} value={conviction.name}>{conviction.name}</option>
          ))}
        </select>
      </label>
      <input className='p-1 border border-white rounded w-10 md:w-16 mx-auto text-center' title={fallbackTitle} type='number' inputMode="numeric" value={value} onChange={(e) => setValue(parseInt(e.target.value))} />
    </div>
  )
}

function NumberDial ({stat, title}:{stat: 'size' | 'TGH', title: string}){
  const [value, setValue] = useActiveCharacterDataLens(stat)


  return(
    <div className='flex flex-col w-10 md:w-16 overflow-hidden'>
      <label className='text-xs'>{title}</label>
      <input className='p-1 border border-white rounded w-10 md:w-16 text-center' title={title} type='number' inputMode="numeric" value={value} onChange={(e) => setValue(parseInt(e.target.value))} />
    </div>
  )
}


const TextItem = ({keyName, mode}:{keyName: 'name' | 'notes', mode: 'normal' | 'large'}) => {
  const [value, setValue] = useTextLens(keyName)

  return(
    <>
      {
        mode == 'large' ?
        <textarea aria-label='notes' className='border rounded p-1 min-h-32' value={value+''} onChange={(e) => setValue(e.target.value)} /> :
        <div className='flex flex-col w-36 md:w-64 overflow-hidden justify-center align-center content-center text-center'>
          <input className='p-1 border border-white rounded w-36 md:w-64 text-center' title={keyName} type='text'  value={value+''} onChange={(e) => setValue(e.target.value)} />
        </div>
      }
    </>
  )
}

function Movementinput  ({movementName, title}:{movementName: keyof Movement, title: string}){
  const [value, setValue] = useMovementLens(movementName)

  return(
    <div className='flex flex-col w-20 md:w-20 overflow-hidden justify-center align-center content-center text-center'>
      <label className='text-xs'>{title}</label>
      <div>
        <input className='p-1 border border-white rounded w-16 text-center' title={title} type='number' value={value} step={0.1} onChange={(e) => setValue(parseFloat(e.target.value))} />
      </div>
    </div>
  )
}