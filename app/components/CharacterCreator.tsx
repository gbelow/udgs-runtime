'use client'

import { useState } from 'react'
import { deleteCharacter, upsertBaseCharacter } from '../actions';
import { WeaponPanel } from './WeaponPanel';
import { ArmorPanel } from './ArmorPanel';
import { useCharacterStore } from '../stores/useCharacterStore';
import { Character, Characteristics, Movement, Skills } from '../domain/types';
import { makeCharacteristicSelector, makeCharacteristicUpdater, makeMovementSelector, makeMovementUpdater, makeSkillSelector, makeSkillUpdater, makeTextSelector, makeTextUpdater } from '../domain/selectors/factories';
import { putGauntlets, putHelm } from '../domain/commands/equipArmor';
import { useAppStore } from '../stores/useAppStore';
import { resetSkill } from '../domain/commands/resetSkills';

export function CharacterCreator() {

  const [showConfirm, setShowConfirm] = useState(false);

  const {character, updateCharacter} = useCharacterStore(s => s)
  const {updateBaseCharacterList} = useAppStore(s => s)
  

  const handleDeleteCharacterClick = (name: string) => {
    deleteCharacter(name)
    updateBaseCharacterList()
  }  

  const handleSaveCharacterClick = () => {
    if(!character) return
    upsertBaseCharacter(character)
    updateBaseCharacterList()

  }

  
  // size, race, abilities, armor penalties, injuries, movements, AP, STA, STA regen
  return (
    <div className='grid grid-col-1 md:grid-cols-12 w-full px-1'>
      <div className='md:col-span-7 flex flex-col gap-2 text-sm gap-2 px-1'>
        <div>
          {/* <button className='border p-2 rounded' onClick={resetAll}>Reset</button> */}
        </div>
          <div className='flex flex-row justify-center gap-2'>
            <label htmlFor="name" className='font-bold'>Name: </label>
            <TextItem keyName={'name'} mode='normal'/>
            {/* <input id='del' className='border rounded bg-red-700 w-12 p-1' type='button' value={'delete'} onClick={()=> setShowConfirm(true)} /> */}
            <input id='log' className='border rounded w-12 p-1' type='button' value={'save'} onClick={handleSaveCharacterClick } />
          </div>
        <div className='flex flex-row gap-2 justify-center'>
          <div>AP: {6}</div>
          <div>STA: {character?.characteristics.STA}</div>
          <div>STA regen: {Math.floor((character?.characteristics.STA ?? 0)/4)}</div>
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <Movementinput movementName={'basic'}  title={'basic (1AP)'} />
          <Movementinput movementName={'careful'}  title={'care (1AP)'} />
          <Movementinput movementName={'crawl'}  title={'crawl (1AP)'} />
          <Movementinput movementName={'run'} title={'run (2AP )'} />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <Movementinput movementName={'swim'}  title={'swim (1AP)'} />
          <Movementinput movementName={'fast swim'}  title={'fast swim (1AP+1STA)'} />
          <Movementinput movementName={'jump'}  title={'jump (1AP+1STA)'} />
          <Movementinput movementName={'stand'}  title={'stand up'} />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <StatDial stat={'STR'} title={'STR'} />
          <StatDial stat={'AGI'} title={'AGI'} />
          <StatDial stat={'STA'} title={'STA'} />
          <StatDial stat={'CON'} title={'CON'} />
          <StatDial stat={'DEX'} title={'DEX'} />
          <StatDial stat={'INT'} title={'INT'} />
          <StatDial stat={'SPI'} title={'SPI'} />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <StatDial stat={'size'} title={'size'} />
          <StatDial stat={'RES'} title={'RES'} />
          <StatDial stat={'TGH'} title={'SPI'} />
          <StatDial stat={'INS'} title={'INS'} />
          {/* <StatDial stat={gearPen} natStat={gearPen} setStat={setGearPen} title={'Gear pen'} /> */}
          <div className='flex flex-col'>
            <label>Gauntlet</label>
            <input type='checkbox' aria-label={'gaunt'} name={'gaunt'} checked={!!character?.hasGauntlets} onChange={() => updateCharacter(putGauntlets)} />
          </div>
          <div className='flex flex-col'>
            <label>Full Helm</label>
            <input type='checkbox' aria-label={'helm'} name={'helm'} checked={!!character?.hasHelm} onChange={() => updateCharacter(putHelm)} />
          </div>

        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <StatDial stat={'melee'} title={'Corpo'} />
          <StatDial stat={'ranged'} title={'Distância'} />
          <StatDial stat={'detection'} title={'Detecção'} />
          <StatDial stat={'spellcast'} title={'Feitiçaria'} />
          <StatDial stat={'conviction1'} title={'Conviction1'} />
          <StatDial stat={'conviction2'} title={'Conviction2'} />
        </div>

        <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'strike'} skillName='strike' title='strike' />
          <SkillItem key={'accuracy'} skillName='accuracy' title='accuracy' />
          <SkillItem key={'defend'} skillName='defend' title='defend' />
          <SkillItem key={'reflex'} skillName='reflex' title='reflex' />
          <SkillItem key={'grapple'} skillName='grapple' title='grapple' />
          <SkillItem key={'cunning'} skillName='cunning' title='cunning' />
          <SkillItem key={'SD'} skillName='SD' title='SD' />
          
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'balance'} skillName='balance' title='balance' />
          <SkillItem key={'climb'} skillName='climb' title='climb' />
          <SkillItem key={'swim'} skillName='swim' title='swim' />
          <SkillItem key={'strength'} skillName='strength' title='strength' />
          <SkillItem key={'stealth'} skillName='stealth' title='stealth' />
          <SkillItem key={'prestidigitation'} skillName='prestidigitation' title='prestidigitation' />
          <SkillItem key={'health'} skillName='health' title='health' />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'knowledge'} skillName='knowledge' title='knowledge' />
          <SkillItem key={'explore'} skillName='explore' title='explore' />
          <SkillItem key={'will'} skillName='will' title='will' />
          <SkillItem key={'charm'} skillName='charm' title='charm' />
          <SkillItem key={'stress'} skillName='stress' title='stress' />
          <SkillItem key={'devotion'} skillName='devotion' title='devotion' />
        </div>
        <div className='flex flex-row gap-2 justify-center'>
          <SkillItem key={'combustion'} skillName='combustion' title='combustion' />
          <SkillItem key={'eletromag'} skillName='eletromag' title='eletromag' />
          <SkillItem key={'radiation'} skillName='radiation' title='radiation' />
          <SkillItem key={'entropy'} skillName='entropy' title='entropy' />
          <SkillItem key={'biomancy'} skillName='biomancy' title='biomancy' />
          <SkillItem key={'telepathy'} skillName='telepathy' title='telepathy' />
          <SkillItem key={'animancy'} skillName='animancy' title='animancy' />
        </div>

        <TextItem aria-label='notes' keyName='notes' mode='large'/>
        {/* <textarea aria-label='notes' className='border rounded p-1 min-h-32' onChange={val => setNotes(val.target.value)} value={notes} /> */}
        
        {/* <button type='button' className='border rounded p-2' onClick={handleSaveCharacterClick}>Save</button> */}
      </div>
      <div className='flex flex-col text-center md:col-span-5  items-center mx-2 gap-2'>
        {
          character ? 
          <>
            <ArmorPanel/>
            <WeaponPanel />
          </>
          :
          null
        }
        <span>Items</span>
      </div>
      {showConfirm && character && (
        <div className="fixed inset-0 flex items-center justify-center bg-black w-64 h-32 m-auto">
          <div className="p-4 rounded shadow-md w-64">
            <p className="mb-4">Are you sure you want to delete {character?.name}?</p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="px-3 py-1 border rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {handleDeleteCharacterClick(character?.name ?? ''); setShowConfirm(false)}}
                className="px-3 py-1 bg-red-500 text-white rounded"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SkillItem({ title, skillName}:{title: string, skillName: keyof Skills}){ 
  const {character, updateCharacter} = useCharacterStore(s => s)
  const value = character ? makeSkillSelector(skillName)(character) : 0
  const setValue = (e: React.ChangeEvent<HTMLInputElement>) => 
    updateCharacter(makeSkillUpdater(skillName, parseInt(e.target.value))) 
  const resetValue = () => 
    updateCharacter(resetSkill( skillName)) 

  return(
    <div className='flex flex-col w-10 md:w-16 overflow-hidden'>
      <label className='text-xs'>{title.slice(0,10)}</label>
      <input className='p-1 border border-white rounded w-10 md:w-16 text-center' title={title} type='number' inputMode="numeric" value={value} onChange={setValue} />
      <button type='button' className='text-xs bg-gray-800 border' onClick={resetValue}>Reset</button>
    </div>
  )
}

function StatDial ({stat, title}:{stat: keyof Characteristics, title: string}){
  const {character, updateCharacter} = useCharacterStore(s => s)
  const value = character ? makeCharacteristicSelector(stat)(character) : 0
  const setValue = (e: React.ChangeEvent<HTMLInputElement>) => 
    updateCharacter(makeCharacteristicUpdater(stat, parseInt(e.target.value))) 

  return(
    <div className='flex flex-col w-10 md:w-16 overflow-hidden'>
      <label className='text-xs'>{title}</label>
      <input className='p-1 border border-white rounded w-10 md:w-16 text-center' title={title} type='number' inputMode="numeric" value={value} onChange={setValue} />
    </div>
  )
}


const TextItem = ({keyName, mode}:{keyName: keyof Character, mode: 'normal' | 'large'}) => {
  const {character, updateCharacter} = useCharacterStore(s => s)
  const value = character ? makeTextSelector(keyName)(character) : ''
  const setValue = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>  ) => 
    updateCharacter(makeTextUpdater(keyName, e.target.value))

  return(
    <>
      {
        mode == 'large' ?
        <textarea aria-label='notes' className='border rounded p-1 min-h-32' value={value+''} onChange={setValue} /> :
        <div className='flex flex-col w-36 md:w-64 overflow-hidden justify-center align-center content-center text-center'>
          <input className='p-1 border border-white rounded w-36 md:w-64 text-center' title={keyName} type='text'  value={value+''} onChange={setValue} />
        </div>
      }
    </>
  )
}

function Movementinput  ({movementName, title}:{movementName: keyof Movement, title: string}){
  const {character, updateCharacter} = useCharacterStore(s => s)
  const value = character ? makeMovementSelector(movementName)(character) : 0
  const setValue = (e: React.ChangeEvent<HTMLInputElement>) => 
    updateCharacter(makeMovementUpdater(movementName, (parseFloat(e.target.value))))

  return(
    <div className='flex flex-col w-20 md:w-20 overflow-hidden justify-center align-center content-center text-center'>
      <label className='text-xs'>{title}</label>
      <div>
        <input className='p-1 border border-white rounded w-16 text-center' title={title} type='number' value={value} onChange={setValue} />
      </div>
    </div>
  )
}