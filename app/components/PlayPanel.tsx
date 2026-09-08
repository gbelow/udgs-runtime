'use client'
import { useState } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { WeaponPanel } from './WeaponPanel';
import { AFFLICTIONS as afflictionDefinitions} from '../domain/tables'
import { makeFullRoll } from './utils';
import { useCombatStore } from '../stores/useCombatStore';
import { AfflictionKey, Characteristics, Injuries, Movement, Resources, Skills } from '../domain/types';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip, isAfflicted } from './SkillTooltip';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useResourceLens } from '../hooks/useResourceLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useAfflictionLens } from '../hooks/useAfflictionLens';
import { useGameCommands } from '../hooks/useGameCommands';
import { useActiveCharacterData } from '../hooks/useCharacterData';
import { useShallow } from 'zustand/shallow';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useKnowledgeLens } from '../hooks/useKnowledgeLens';


export function PlayPanel(){

  const { rest, actionSurge, } = useCharacterCommands()
  const { nextRound, startTurn, resetCombat, killCharacter } = useCombatCommands()
  const { savePlayerCharacter} = useGameCommands()
  const { isCharacterDead } = useInjuryLens()
  const round = useCombatStore(s => s.round)
  const isThereActiveCharacter = useCombatStore(s => !!s.activeCharacterId)
  const { notes, fightName, hasActionSurge} = useActiveCharacterData() 

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
            <div className='flex flex-row gap-4'>                  
              <InjuryControl type='potion' />
              <DamageControl />
              <InjuryControl type='injuryLevel' />
              <InjuryControl type='hemorrhage' />
              <input type="button" className={'border p-2 h-12 m-auto ' + (isCharacterDead() ? 'bg-red-500' : '') } onClick={killCharacter} value="Kill" /> 
            </div>                  
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleMove moveName='basic' title={'basic (1AP)'} />
              <SimpleMove moveName='careful'  title={'care (1AP)'} />
              <SimpleMove moveName='crawl'  title={'crawl (1AP)'} />
              <SimpleMove moveName='run'  title={'run (2AP )'} />
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleMove moveName='swim'  title={'swim (1AP)'} />
              {/* <SimpleMove moveName='fast swim'  title={'swim (1AP+1STA)'} /> */}
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
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleCharacteristic propName={'melee'} />
              <SimpleCharacteristic propName={'ranged'} />
              <SimpleCharacteristic propName={'awareness'} />
              <SimpleCharacteristic propName={'charisma'} />
              <SimpleCharacteristic propName={'sorcery'} />
              <SimpleCharacteristic propName={'conviction1'} />
              <SimpleCharacteristic propName={'conviction2'} />
              <SimpleCharacteristic propName={'devotion'} />
            </div>
            <div className='flex flex-row'>
              <h2 className='text-md'>Last roll:</h2>
              <span className='px-4'>{rolledSkill.name} : {rolledSkill.value}</span>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillId={'strike'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'accuracy'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'defend'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'reflex'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'grapple'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'cunning'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'SD'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillId={'balance'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'climb'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'detection'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'stealth'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'prestidigitation'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'health'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'swim'} rollSkill={rollSkill}/>
            </div>
            <div className='flex flex-row gap-2 justify-center'>
              {/* <SimpleSkill skillId={'knowledge'} rollSkill={rollSkill}/> */}
              <SimpleSkill skillId={'explore'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'will'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'persuasion'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'deception'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'insight'} rollSkill={rollSkill}/>
              {/* <SimpleSkill skillId={'devotion'} rollSkill={rollSkill}/> */}
            </div>
            {/* <div className='flex flex-row gap-2 justify-center'>
              <SimpleSkill skillId={'combustion'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'eletromag'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'radiation'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'entropy'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'biomancy'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'telepathy'} rollSkill={rollSkill}/>
              <SimpleSkill skillId={'animancy'} rollSkill={rollSkill}/>
            </div> */}
            <KnowledgesPanel />
            <textarea aria-label='notes' className='border rounded p-1 min-h-32 w-84 md:w-full justify-center ' value={notes} readOnly/>
            <button type='button' className='border rounded p-2' onClick={savePlayerCharacter}>Save</button>
          </div>
          <div className='flex flex-col md:col-span-5 gap-2 text-sm items-center'>
            <AfflictionsPannel />
            <ArmorPanel  />
            <div className='flex flex-row gap-2 text-center justify-center'>
              {/* <SimpleCharacteristic propName={'RES'} /> */}
              {/* <SimpleCharacteristic propName={'TGH'} /> */}
              {/* <SimpleCharacteristic propName={'INS'} /> */}
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

function DamageButton({amount}: {amount: number}){
  const { injuries, setInjury } = useInjuryLens()

  const dealDamage = () => {
    setInjury('injuryLevel', injuries.injuryLevel + amount);
  }

  return(
    <div className='flex flex-row'>
      <input type='button' className='border p-1' aria-label={`cause${amount}Injury`} value={amount} onClick={ dealDamage} />
    </div>
  )
}

function DamageControl(){

  return(
    <div className='flex flex-row gap-4 justify-center items-center'>      
      <div className='flex flex-col justify-center items-center gap-2 ml-4'>
        <span className='text-xs'>Cause Injury</span>
        <div className='flex flex-row gap-2' >
          <DamageButton amount={5} />
          <DamageButton amount={10} />
        </div>
        <div className='flex flex-row gap-2'>
          <DamageButton amount={20} />
          <DamageButton amount={30} />
        </div>
      </div>      
    </div>
  )
}

  function InjuryControl({type}: {type: 'injuryLevel' | 'hemorrhage' | 'potion'}){

  const {injuries, setInjury} = useInjuryLens()
  const { cureIL } = useCharacterCommands()

  const value = injuries[type]
  return(
    <div className='flex flex-col gap-1 flex-wrap w-84 md:w-full justify-center items-center'>
        <span>{type === 'injuryLevel' ? 'Injury Level' : type === 'hemorrhage' ? 'Hemorrhage' : 'Potion'}</span>     
        <div className={'flex flex-col border rounded-full text-center p-1 w-16 h-16 text-center items-center justify-center '+(value>0 ? 'bg-red-600' : null)}>
          <input className='w-12 text-center' type='number' inputMode="numeric" aria-label={'injury'} value={value} onChange={(e) => setInjury( type, parseInt(e.target.value))} />
          <div className='flex flex-row gap-2'>
            <input type='button' aria-label={'causeInjury'} value={'+'} onClick={() => setInjury( type, value + 1)} />
            <input type='button' aria-label={'healInjury'} value={'-'} onClick={() => type == 'injuryLevel' ? cureIL(value - 1) : setInjury( type, value - 1)} />
          </div>
        </div>
      </div>
  )
}

function SimpleResource({rssName}: {rssName: keyof Resources}){

  const [ value, setValue] = useResourceLens(rssName)
  const { updateSTA } = useCharacterCommands()

  return(
    <div className='flex flex-row border rounded text-center justify-around p-1 w-16 overflow-hidden'>
      <div className='flex flex-col w-8 text-xs'>
        <span>{rssName.slice(0,10)}</span>
        <input className='w-12 text-center' type='number' inputMode="numeric" aria-label={rssName} value={value} onChange={(e) => setValue(parseInt(e.target.value) ?? 0)} />
      </div>
      <div className='flex flex-col gap-2'>
        <input type='button' className='border rounded-full w-4 h-4 font-bold text-center align-center justify-center ' aria-label={rssName} value={'+'} onClick={() => setValue(value+1)} />
        <input type='button' className='border rounded-full w-4 h-4 font-bold text-center align-center justify-center ' aria-label={rssName} value={'-'} onClick={() => rssName == 'STA' ? updateSTA(value-1) : setValue(value-1)} />
      </div>
    </div>
  )
}


function SimpleCharacteristic({propName}: {propName: keyof Characteristics}){
  const [value, , terms] = useCharacteristicLens(propName)
  const [name] = useTrainableNameLens(propName)
  return(
    <SkillTooltip terms={terms} total={value}>
      <div className='flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs' >
        <span>{name.slice(0,10)}</span>
        <span>{value}</span>
      </div>
    </SkillTooltip>
  )
}

function SimpleSkill({skillId, rollSkill}: {skillId: keyof Skills, rollSkill?: (name:string, value:number)=> void}){
  const [value, , terms] = useSkillLens(skillId)
  const [name] = useTrainableNameLens(skillId)
  const afflicted = isAfflicted(terms)
  return(
    <SkillTooltip terms={terms} total={value}>
      <div className={`flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs ${afflicted ? 'border-red-500' : ''}`} onClick={() => rollSkill ? rollSkill(name, value) : null}>
        <span>{name.slice(0,10)}</span>
        <span className={afflicted ? 'text-red-400' : ''}>{value}</span>
      </div>
    </SkillTooltip>
  )
}

function KnowledgesPanel(){
  const { knowledges } = useKnowledgeLens()
  const names = Object.keys(knowledges)

  if(!names.length) return null

  return(
    <div className='flex flex-row gap-2 justify-center flex-wrap'>
      {names.map(name => <SimpleKnowledge key={name} name={name} />)}
    </div>
  )
}

function SimpleKnowledge({name}: {name: string}){
  const { getValue } = useKnowledgeLens()
  const value = getValue(name)
  return(
    <div className='flex flex-col border rounded text-center p-1 w-10 md:w-16 overflow-hidden text-xs' >
      <span>{name.slice(0,10)}</span>
      <span>{value}</span>
    </div>
  )
}

function SimpleMove({moveName, title}: {moveName: keyof Movement, title: string}){
  const [value] = useMovementLens(moveName)

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
