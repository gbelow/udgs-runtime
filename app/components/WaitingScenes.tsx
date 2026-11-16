'use client'
import { Play } from 'lucide-react'
import { Button, barred, selectClass } from './ui'
import { usePartyCommands } from '../hooks/useParty'
import { useScenePlayerOptions } from '../hooks/useScenePresets'
import type { WaitingSceneView } from '../domain/campaign/projections/scenes'

// A prepared scene waiting to be played: who meets it, the parties it brings
// in and who plays each line of them, given by the GM for this scene alone,
// and the buttons that play it or pass it by.
export function WaitingScene({ scene }: { scene: WaitingSceneView }){
  const { playScene, passBy, setScenePlayer } = usePartyCommands()
  const { options, bar } = useScenePlayerOptions()
  return(
    <div className='flex flex-col gap-1 border-t border-line pt-1'>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs font-medium'>{scene.name}</span>
        <span className='text-xs text-muted'>{scene.event ? `${scene.forced ? 'forced' : 'offered'} · from ${scene.event}` : 'loaded by the table'} · {scene.members.length > 0 ? `met by ${scene.members.join(', ')}` : 'nobody sent from the campaign'}</span>
        <Button size='xs' tone='accent' icon={Play} aria-label={`play ${scene.name}`} {...barred(scene.playBar)} onClick={() => playScene(scene)}>play</Button>
        {scene.forced ? null : <Button size='xs' weight='subtle' aria-label={`${scene.event ? 'pass by' : 'discard'} ${scene.name}`} title='the scene is gone; the preset stays in the catalog' onClick={() => passBy(scene.id)}>{scene.event ? 'pass by' : 'discard'}</Button>}
      </div>
      {scene.text ? <span className='text-xs text-muted'>{scene.text}</span> : null}
      <div className='flex flex-row flex-wrap gap-2'>
        {scene.parties.map((p, i) => (
          <div key={i} className='flex flex-col gap-0.5 px-1.5 py-1 rounded border border-line'>
            <span className='text-[10px] uppercase tracking-wider text-muted'>{p.name}</span>
            {p.members.map((m) => (
              <div key={m.slot} className='flex flex-row items-center gap-1'>
                <span className='text-xs'>{m.key} <span className='text-muted'>×{m.count}</span></span>
                <select aria-label={`${m.key} played by`} className={selectClass} {...barred(bar)}
                  value={m.player ?? ''} onChange={(e) => setScenePlayer(scene.id, m.slot, e.target.value || null)}>
                  <option value=''>the GM</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  {m.player && !options.some((o) => o.id === m.player) ? <option value={m.player}>{m.player}</option> : null}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
