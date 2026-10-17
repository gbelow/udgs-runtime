'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, SectionLabel } from './ui'
import { useTray } from '../hooks/useTray'
import { DiceTray as Tray } from '../dice/tray'
import { playThrow, type TrayStage } from '../dice/play'

const SAY: Record<Exclude<TrayStage, 'done'>, string> = {
  fling: 'drag across the tray and let go to throw',
  rolling: 'rolling…',
  exploding: 'it explodes',
  draw: 'a draw: both again',
}

// The dice tray, where the log is while a throw is played out: the dice
// flung by hand, and what they came to once they land.
export default function DiceTray(){
  const { request, finish } = useTray()
  const canvas = useRef<HTMLCanvasElement>(null)
  const tray = useRef<Tray | null>(null)
  const [stage, setStage] = useState<TrayStage>('fling')

  useEffect(() => {
    if (!canvas.current) return
    tray.current = new Tray(canvas.current)
    return () => { tray.current?.dispose(); tray.current = null }
  }, [])

  useEffect(() => {
    if (!request || !tray.current) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    void playThrow(tray.current, request.thrown, setStage, () => stopped).then((landed) => {
      if (landed) timer = setTimeout(() => finish(request.id), 2500)
    })
    return () => { stopped = true; clearTimeout(timer) }
  }, [request, finish])

  if (!request) return null
  return(
    <div className='flex flex-col gap-1 h-full min-h-0'>
      <div className='flex flex-row gap-2 items-center'>
        <SectionLabel>{request.label}</SectionLabel>
        <span className='text-xs text-muted'>{stage === 'done' ? <>came to <span className='font-mono text-fg'>{request.thrown.die}</span></> : SAY[stage]}</span>
        <span className='ml-auto flex flex-row gap-1'>
          {stage === 'fling' ? <Button size='xs' variant='primary' onClick={() => tray.current?.release()}>throw</Button> : null}
          {stage === 'done' ? <Button size='xs' onClick={() => finish(request.id)}>go on</Button> : null}
        </span>
      </div>
      <canvas ref={canvas} className='flex-1 min-h-0 w-full touch-none cursor-grab rounded border border-line' />
    </div>
  )
}
