'use client'
import { useState } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { WeaponPanel } from './WeaponPanel';
import { AFFLICTIONS as afflictionDefinitions} from '../domain/tables'
import { makeFullRoll } from './utils';
import { CombatStore, useCombatStore } from '../stores/useCombatStore';
import { AfflictionKey, Characteristics, Injuries, Movement, Resources, Skills } from '../domain/types';
import { injuryMap } from '../domain/tables';
import { saveCharacter } from '../actions';
import { useAppStore } from '../stores/useAppStore';
import { useSkillLens } from '../hooks/useSkillLens';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useResourceLens } from '../hooks/useResourceLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useAfflictionLens } from '../hooks/useAfflictionLens';
import { useGameCommands } from '../hooks/useGameCommands';
import { useActiveCharacterData } from '../hooks/useCharacterDataLens';
import { useShallow } from 'zustand/shallow';


export function PlayPanel(){

  const updatePlayerCharacterList = useAppStore(s => s.updatePlayerCharacterList)
  const { rest, actionSurge, } = useCharacterCommands()
  const { nextRound, startTurn, resetCombat, killCharacter } = useCombatCommands()
  const { savePlayerCharacter} = useGameCommands()
  const round = useCombatStore(s => s.round)
  const isThereActiveCharacter = useCombatStore(s => !!s.activeCharacterId)
  const { notes, fightName, hasActionSurge} = useActiveCharacterData() 

  const [injuries, setInjury] = useInjuryLens()

  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)

  const [rolledSkill, setRolledSkill] = useState({name:'', value:0})

  const rollSkill = (name:string, value: number) => {
    const roll = makeFullRoll()
    setRolledSkill({name, value:value+roll})
  }


  return(
    <div className='flex flex-col justify-center '>
      <div className='flex flex-col'>
        <div className='flex flex-row gap-2 w-full' >
          <span>
            Round: {round}
          </span>
          <input type='button' value='nextRound' aria-label='nextRound' className='p-1 border hover:bg-gray-500 rounded' onClick={nextRound} />              
          <input type='button' value='resetGame' aria-label='resetGame' className='p-1 border hover:bg-gray-500 rounded ml-auto mr-2' onClick={resetCombat} />
        </div>
        <div className='flex flex-row gap-2 w-full overflow-auto p-3'>
          <CharacterList />
        </div>
      </div>
      {
        isThereActiveCharacter ?
        <div className='grid grid-cols-1 md:grid-cols-12 py-1'>
          <div className='flex flex-col items-center justify-center md:col-span-7 flex flex-col gap-2 text-sm py-1 md:mr-2'>
            <div className='flex gap-2 text-xs h-8'>
              <input type='button' value='startTurn' aria-label='startTurn' className='p-1 border hover:bg-gray-500 rounded' onClick={startTurn } />  
              <span className='text-lg'>{fightName}</span>
              <input type='button' value='d10' aria-label='roll' className='p-1 border hover:bg-gray-500 rounded' onClick={() => setDice10(Math.floor(Math.random() * 10) + 1)}/>
              <span>
                Roll: {dice10}
              </span>
              <input type='button' value='d6' aria-label='roll' className='p-1 border hover:bg-gray-500 rounded' onClick={() => setDice6(Math.floor(Math.random() * 6) + 1)}/>
              <span>
                Roll: {dice6}
              </span>
              <input type='button' value='action surge' aria-label='action surge' className={'p-1 border hover:bg-gray-500 rounded '+(hasActionSurge ? 'bg-gray-500': '')} onClick={ actionSurge } />  
              <input type='button' value='rest' aria-label='rest' className={'p-1 border hover:bg-gray-500 rounded '} onClick={ rest } />
            </div>     
            {
              isThereActiveCharacter ?
              <div className='flex flex-row gap-2 justify-center '>
                <SimpleResource rssName={'AP'} />
                <SimpleResource rssName={'STA'} />
                <SimpleResource rssName={'exhaustion'} />
                <SimpleResource rssName={'hunger'} />
                <SimpleResource rssName={'thirst'} />
              </div>
              : null
            }                    
            <div className='flex flex-row gap-1 flex-wrap w-84 md:w-full justify-center items-center'>
              <span>Light</span>
              {
                injuries?.light.map((inj: number, ind: number) => <InjuryControl key={ind} cures={inj} type='light' setInj={(val) => setInjury('light', ind, val)} />)
              }
            </div>
            <div className='flex flex-row gap-1 justify-center'>
              <span>Serious</span>
              {
                injuries?.serious.map((inj: number, ind: number) => <InjuryControl key={ind} cures={inj} type='serious' setInj={(val) => setInjury('serious', ind, val)} />)
              }
            </div>
            <div className='flex flex-row gap-1 justify-center'>
              <span>Deadly</span>
              {
              injuries?.deadly.map((inj: number, ind: number) => <InjuryControl key={ind} cures={inj} type='deadly' setInj={(val) => setInjury('deadly', ind, val)} />)
              }
              <input type='button' value='KILL' aria-label='kill' className='p-1 border hover:bg-gray-500 rounded' onClick={ killCharacter} />

            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleMove moveName='basic' title={'basic (1AP)'} />
              <SimpleMove moveName='careful'  title={'care (1AP)'} />
              <SimpleMove moveName='crawl'  title={'crawl (1AP)'} />
              <SimpleMove moveName='run'  title={'run (2AP )'} />
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleMove moveName='swim'  title={'swim (1AP)'} />
              <SimpleMove moveName='fast swim'  title={'swim (1AP+1STA)'} />
              <SimpleMove moveName='jump'  title={'jump (1AP+1STA)'} />
              <SimpleMove moveName='stand'  title={'stand up'} />
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleCharacteristic propName={'STR'} />
              <SimpleCharacteristic propName={'AGI'} />
              <SimpleCharacteristic propName={'STA'} />
              <SimpleCharacteristic propName={'CON'} />
              <SimpleCharacteristic propName={'INT'} />
              <SimpleCharacteristic propName={'SPI'} />
              <SimpleCharacteristic propName={'DEX'} />
            </div>
            <div className='flex flex-row'>
              <h2 className='text-md'>Last roll:</h2>
              <span className='px-4'>{rolledSkill.name} : {rolledSkill.value}</span>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillName={'strike'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'accuracy'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'defend'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'reflex'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'grapple'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'cunning'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'SD'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillName={'balance'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'climb'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'strength'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'stealth'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'prestidigitation'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'health'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'swim'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillName={'knowledge'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'explore'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'will'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'charm'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'stress'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'acting'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'devotion'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillName={'combustion'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'eletromag'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'radiation'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'entropy'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'biomancy'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'telepathy'} rollSkill={rollSkill}/>
              <SimpleSkill skillName={'animancy'} rollSkill={rollSkill}/>
            </div>
            <textarea aria-label='notes' className='border rounded p-1 min-h-32 w-84 md:w-full justify-center ' value={notes} readOnly/>
            <button type='button' className='border rounded p-2' onClick={savePlayerCharacter}>Save</button>
          </div>
          <div className='flex flex-col md:col-span-5 gap-2 text-sm items-center'>
            <AfflictionsPannel />
            <ArmorPanel  />
            <div className='flex flex-row gap-2 text-center justify-center'>
              <SimpleCharacteristic propName={'RES'} />
              <SimpleCharacteristic propName={'TGH'} />
              <SimpleCharacteristic propName={'INS'} />
            </div>
            <WeaponPanel />
            <span>Items</span>
            {/* <textarea aria-label='pack' className='border rounded p-1 min-h-32 w-full' value={currentCharacter?.packItems ?? ''}  readOnly /> */}
          </div>
        </div>
        : null
      }
    </div>
  )
}

function InjuryControl({cures, setInj, type}: {cures: number, type:keyof Injuries, setInj: (val: number) => void }){
  const step = injuryMap[type]
  return(
    <div className={'flex flex-col border rounded-full text-center p-1 w-12 h-12 text-center items-center justify-center '+(cures>0 ? 'bg-red-600' : null)}>
      <input className='w-12 text-center' type='number' inputMode="numeric" aria-label={'injury'} value={cures} onChange={(e) => setInj(parseInt(e.target.value))} />
      <input type='button' aria-label={'causeInjury'} value={'+'} onClick={() => setInj(step)} />
    </div>
  )
}

function SimpleResource({rssName}: {rssName: keyof Resources}){

  const [ value, setValue] = useResourceLens(rssName)

  return(
    <div className='flex flex-row border rounded text-center justify-around p-1 w-16 overflow-hidden'>
      <div className='flex flex-col w-8 text-xs'>
        <span>{rssName.slice(0,10)}</span>
        <span>{value}</span>
      </div>
      <div className='flex flex-col gap-2'>
        <input type='button' className='border rounded-full w-4 h-4 font-bold text-center align-center justify-center ' aria-label={rssName} value={'+'} onClick={() => setValue(value+1)} />
        <input type='button' className='border rounded-full w-4 h-4 font-bold text-center align-center justify-center ' aria-label={rssName} value={'-'} onClick={() => setValue(value-1)} />
      </div>
      {/* <input type='number' inputMode="numeric" aria-label={name} value={value} onChange={(val) => setRss(val.target.value)} /> */}
    </div>
  )
}


function SimpleCharacteristic({propName}: {propName: keyof Characteristics}){
  const [value] = useCharacteristicLens(propName)
  return(
    <div className='flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs' >
      <span>{propName.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function SimpleSkill({skillName, rollSkill}: {skillName: keyof Skills, rollSkill?: (name:string, value:number)=> void}){
  const [value] = useSkillLens(skillName)
  return(
    <div className='flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs' onClick={() => rollSkill ? rollSkill(skillName, value) : null}>
      <span>{skillName.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function SimpleMove({moveName, title}: {moveName: keyof Movement, title: string}){
  const [value, setValue] = useMovementLens(moveName)

  return(
    <div className='flex flex-col border rounded text-center p-1 w-20 md:w-28 overflow-hidden text-xs'>
      <span>{title.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function AfflictionsPannel(){

  const [afflictions, setAffliction] = useAfflictionLens()
  const afflictionsList = Object.keys(afflictionDefinitions) as AfflictionKey[]

  return(
    <div className='flex flex-row w-84 md:w-full flex-wrap gap-2 justify-center text-xs'>
      {
        afflictionsList.map((item: AfflictionKey) => 
          <input type='button' key={item} className={'border p-1 ' + (afflictions?.includes(item) ? 'bg-red-500' : null)} 
            aria-label={item} value={item} onClick={ () => setAffliction(item)} />
        )
      }
    </div>
  )
}

function CharacterList(){
  const characters = useCombatStore(useShallow(s => s.characters))
  const setActiveCharacter = useCombatStore(s => s.setActiveCharacter)
  const activeCharacterId = useCombatStore(s => s.activeCharacterId)
  
  return(
    <div className='flex flex-row gap-2 w-full overflow-auto p-3'>
      {
        Object.entries(characters).map(([id, value]) => 
          <input className={'p-2 border h-12  '+(id  == activeCharacterId ? 'bg-red-500' : value.hasActionSurge ? 'bg-blue-400' : 'bg-gray-500')} 
            type='button' value={value.fightName} aria-label={value.fightName} key={id} 
            onClick={() => setActiveCharacter(id)}
          />
        )
      }
    </div>
  )
}
