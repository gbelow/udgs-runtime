'use client'
import { useState } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { WeaponPanel } from './WeaponPanel';
import { AFFLICTIONS as afflictionDefinitions} from '../domain/tables'
import { makeFullRoll } from './utils';
import { CombatStore, useCombatStore } from '../stores/useCombatStore';
import { AfflictionKey, Characteristics, Injuries, Movement, Resources, Skills } from '../domain/types';
import { useActiveCampaignCharacterUpdater } from '../hooks/useActiveCharacterUpdater';
import { startTurn } from '../domain/commands/startTurn';
import { useGetActiveCampaignCharacter } from '../hooks/useGetActiveCharacter';
import { makeCharacteristicSelector, makeInjuryUpdater, makeMovementSelector, makeResourceSelector, makeResourceUpdater, makeSkillSelector } from '../domain/selectors/factories';
import { actionSurge } from '../domain/commands/actionSurge';
import { restCharacter } from '../domain/commands/rest';
import { injuryMap } from '../domain/tables';
import { nextRound } from '../domain/commands/nextRound';
import { resetCombat } from '../domain/commands/resetCombat';
import { getAfflictions } from '../domain/selectors/afflictions';
import { isCampaignCharacter } from '../domain/utils';
import { addAffliction } from '../domain/commands/addAffliction';


export function PlayPanel(){

  const {
    characters, removeCharacter, updateCombatState, 
    round, activeCharacterId} = useCombatStore()

  const currentCharacter = useGetActiveCampaignCharacter()
  const characterUpdater = useActiveCampaignCharacterUpdater()

  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)

  const [rolledSkill, setRolledSkill] = useState({name:'', value:0})

  const handleStartTurnClick = () => {    
    updateCombatState(startTurn)
  }
  
  const killCharacter = () => {
    if(!currentCharacter || !currentCharacter.id ) return
    removeCharacter(currentCharacter.id)
  }

  const doActionSurge = () => {
    characterUpdater(actionSurge)
  }

  const doRest = () => {
    characterUpdater(restCharacter)
  }

  const updateInjury = (type: keyof Injuries, index: number, value: number) => {
    characterUpdater( makeInjuryUpdater(type, index, value))
  }

  const passRound = () => {
    updateCombatState(nextRound)
  }

  const resetFight = () => {
    updateCombatState(resetCombat)
  }


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
          <input type='button' value='nextRound' aria-label='nextRound' className='p-1 border hover:bg-gray-500 rounded' onClick={passRound} />              
          <input type='button' value='resetGame' aria-label='resetGame' className='p-1 border hover:bg-gray-500 rounded ml-auto mr-2' onClick={resetFight} />
        </div>
        <div className='flex flex-row gap-2 w-full overflow-auto p-3'>
          {
            Object.entries(characters).map(([id, value]) => 
              <input className={'p-2 border h-12  '+(id  == activeCharacterId ? 'bg-red-500' : value.hasActionSurge ? 'bg-blue-400' : 'bg-gray-500')} 
                type='button' value={value.fightName} aria-label={value.fightName} key={id} 
                onClick={() => {
                  updateCombatState((s: CombatStore) => ({...s, activeCharacterId: id}))
                }}
              />
            )
          }
        </div>
      </div>
      {
        currentCharacter ?
        <div className='grid grid-cols-1 md:grid-cols-12 py-1'>
          <div className='flex flex-col items-center justify-center md:col-span-7 flex flex-col gap-2 text-sm py-1 md:mr-2'>
            <div className='flex gap-2 text-xs h-8'>
              <input type='button' value='startTurn' aria-label='startTurn' className='p-1 border hover:bg-gray-500 rounded' onClick={handleStartTurnClick } />  
              <span className='text-lg'>{currentCharacter.fightName}</span>
              <input type='button' value='d10' aria-label='roll' className='p-1 border hover:bg-gray-500 rounded' onClick={() => setDice10(Math.floor(Math.random() * 10) + 1)}/>
              <span>
                Roll: {dice10}
              </span>
              <input type='button' value='d6' aria-label='roll' className='p-1 border hover:bg-gray-500 rounded' onClick={() => setDice6(Math.floor(Math.random() * 6) + 1)}/>
              <span>
                Roll: {dice6}
              </span>
              <input type='button' value='action surge' aria-label='action surge' className={'p-1 border hover:bg-gray-500 rounded '+(currentCharacter.hasActionSurge ? 'bg-gray-500': '')} onClick={ doActionSurge } />  
              <input type='button' value='rest' aria-label='rest' className={'p-1 border hover:bg-gray-500 rounded '} onClick={ doRest } />
            </div>     
            {
              currentCharacter ?
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
                currentCharacter?.injuries?.light.map((inj, ind) => <InjuryControl key={ind} cures={inj} type='light' setInj={(val) => updateInjury('light', ind, val)} />)
              }
            </div>
            <div className='flex flex-row gap-1 justify-center'>
              <span>Serious</span>
              {
                currentCharacter?.injuries?.serious.map((inj, ind) => <InjuryControl key={ind} cures={inj} type='serious' setInj={(val) => updateInjury('serious', ind, val)} />)
              }
            </div>
            <div className='flex flex-row gap-1 justify-center'>
              <span>Deadly</span>
              {
              currentCharacter?.injuries?.deadly.map((inj, ind) => <InjuryControl key={ind} cures={inj} type='deadly' setInj={(val) => updateInjury('deadly', ind, val)} />)
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
            {/* <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill name={'Mobilidade'} value={currentCharacter.resources.penalties.mobility}/>
              <SimpleSkill name={'Ferimento'} value={currentCharacter.resources.penalties.injury}  />
              <SimpleSkill name={'Visão'} value={currentCharacter.resources.penalties.vision}/>
              <SimpleSkill name={'Mental'} value={currentCharacter.resources.penalties.mental}/>
              <SimpleSkill name={'Saúde'} value={currentCharacter.resources.penalties.health}/>
            </div> */}
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
              <ZimpleSkill skillName={'strike'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'accuracy'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'defend'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'reflex'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'grapple'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'cunning'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'SD'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <ZimpleSkill skillName={'balance'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'climb'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'strength'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'stealth'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'prestidigitation'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'health'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'swim'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <ZimpleSkill skillName={'knowledge'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'explore'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'will'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'charm'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'stress'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'acting'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'devotion'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <ZimpleSkill skillName={'combustion'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'eletromag'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'radiation'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'entropy'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'biomancy'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'telepathy'} rollSkill={rollSkill}/>
              <ZimpleSkill skillName={'animancy'} rollSkill={rollSkill}/>
            </div>
            <textarea aria-label='notes' className='border rounded p-1 min-h-32 w-84 md:w-full justify-center ' value={currentCharacter.notes} readOnly/>
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

  const character = useGetActiveCampaignCharacter()
  const value = character && isCampaignCharacter(character) ? makeResourceSelector(rssName)(character) : 0
  const charUpdater = useActiveCampaignCharacterUpdater()
  
  const updater = (value: number) => 
    charUpdater((c) => isCampaignCharacter(c) ? makeResourceUpdater(rssName, value )(c) : c)

  return(
    <div className='flex flex-row border rounded text-center justify-around p-1 w-16 overflow-hidden'>
      <div className='flex flex-col w-8 text-xs'>
        <span>{rssName.slice(0,10)}</span>
        <span>{value}</span>
      </div>
      <div className='flex flex-col gap-2'>
        <input type='button' className='border rounded-full w-4 h-4 font-bold text-center align-center justify-center ' aria-label={rssName} value={'+'} onClick={() => updater(value+1)} />
        <input type='button' className='border rounded-full w-4 h-4 font-bold text-center align-center justify-center ' aria-label={rssName} value={'-'} onClick={() => updater(value-1)} />
      </div>
      {/* <input type='number' inputMode="numeric" aria-label={name} value={value} onChange={(val) => setRss(val.target.value)} /> */}
    </div>
  )
}


function SimpleCharacteristic({propName}: {propName: keyof Characteristics}){
  const character = useGetActiveCampaignCharacter()
  const value = character ? makeCharacteristicSelector(propName)(character) : 0
  return(
    <div className='flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs' >
      <span>{propName.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function ZimpleSkill({skillName, rollSkill}: {skillName: keyof Skills, rollSkill?: (name:string, value:number)=> void}){
  const character = useGetActiveCampaignCharacter()
  const value = character ? makeSkillSelector(skillName)(character) : 0
  return(
    <div className='flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs' onClick={() => rollSkill ? rollSkill(skillName, value) : null}>
      <span>{skillName.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function SimpleMove({moveName, title}: {moveName: keyof Movement, title: string}){
  const character = useGetActiveCampaignCharacter()
  const value = character ? makeMovementSelector(moveName)(character) : 0

  return(
    <div className='flex flex-col border rounded text-center p-1 w-20 md:w-28 overflow-hidden text-xs'>
      <span>{title.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function AfflictionsPannel(){
  const character = useGetActiveCampaignCharacter()
  const afflictions = character ? getAfflictions(character) : []
  const afflictionsList = Object.keys(afflictionDefinitions) as AfflictionKey[]
  const characterUpdater = useActiveCampaignCharacterUpdater()
  
  const setAffliction = (item: AfflictionKey) => 
    characterUpdater((c) => isCampaignCharacter(c) ? addAffliction(item)(c) : c)

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

function symmetricDifference(arr: AfflictionKey[], item: AfflictionKey) {
  return arr.includes(item) ? arr.filter(el => el != item) : [...arr, item]
}