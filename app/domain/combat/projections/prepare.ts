import type { MovementOption } from '../rules/move'
import type { AmmoOption } from '../rules/attack'
import type { CombatState, PreparableKind, PrepareAction, PreparedTrigger } from '../types'
import { PREPARABLE_KINDS } from '../types'
import { SPELLS, isSpellKey } from '../../spells'
import { isCampaignCharacter } from '../../utils'
import { defRows, getAmmoOptions, getFreeAttackOptions } from '../rules/attack'
import { getSpellOptions } from '../rules/cast'
import { getMovementOptions } from '../rules/move'
import { getPrepared, getPreparedEvents, getPreparedMain, getPreparedZone, isDefenseMain, isPrepareComplete } from '../rules/prepared'
import { getFightName } from '../rules/fighters'
import type { AttackOptionView, SpellOptionView } from './actionPanel'

// combat.tex "Preparing a reaction", as the panel shows it: the action is
// declared first, and what it can wait for is offered from that — the zone it
// reaches grows with its own reach and the movement it carries.

export type PrepareView = {
  mains: { kind: PreparableKind; selected: boolean; available: boolean; reason: string | null }[]
  attacks: AttackOptionView[]
  ammo: AmmoOption[]
  // the rows a defense is made with
  defenses: { weaponKey: string; attack: string; weapon: string; selected: boolean }[]
  spells: SpellOptionView[]
  movements: MovementOption[]
  // what it can wait for, and for whom; the zone is how far from the preparer
  // the trigger reaches, null before the action is declared
  events: { event: PreparedTrigger['event']; label: string; selected: boolean }[]
  who: { id: string | null; name: string; selected: boolean }[]
  zone: number | null
  complete: boolean
}

export type PreparedRow = { id: string; actor: string; text: string }

export function getPrepareView(state: CombatState, open: PrepareAction): PrepareView | null {
  const actor = state.characters[open.actorId]
  if (!isCampaignCharacter(actor)) return null
  const strikes = getFreeAttackOptions(state, actor, 'strike')
  const shots = getFreeAttackOptions(state, actor, 'shoot')
  const spells = getSpellOptions(state, actor)
  const movements = getMovementOptions(state, actor).filter((m) => m.speed > 0)
  const rowsOf = (kind: PreparableKind) => defRows(actor).filter((row) => kind !== 'guard' || row.weapon.shield !== undefined)
  const defenseReason = (kind: PreparableKind) => (rowsOf(kind).length > 0 ? null : kind === 'guard' ? 'no shield in hand' : 'nothing to defend with')
  const reasons: Record<PreparableKind, string | null> = {
    strike: strikes.length > 0 ? null : 'no melee weapon in hand',
    shoot: shots.length > 0 ? null : 'no shooting weapon ready',
    cast: spells.some((s) => s.castable || s.quickenable) ? null : 'no spell castable now',
    move: movements.some((m) => m.available) ? null : 'cannot move',
    block: defenseReason('block'),
    intercept: defenseReason('intercept'),
    guard: defenseReason('guard'),
  }
  const rows = open.main === 'strike' ? strikes : open.main === 'shoot' ? shots : []
  const probe = getPreparedMain(open, '')
  const zone = open.main ? getPreparedZone(state, actor, open) : null
  return {
    mains: PREPARABLE_KINDS.map((kind) => ({ kind, selected: open.main === kind, available: reasons[kind] === null, reason: reasons[kind] })),
    attacks: rows.map((o) => ({ ...o, selected: o.weaponKey === open.weaponKey && o.attack === open.attack && o.variant === open.variant })),
    ammo: probe?.kind === 'shoot' ? getAmmoOptions(actor, probe) : [],
    defenses: isDefenseMain(open.main) ? rowsOf(open.main).map((row) => ({ weaponKey: row.wielded.key, attack: row.atk.name, weapon: row.weapon.name, selected: row.wielded.key === open.weaponKey && row.atk.name === open.attack })) : [],
    spells: open.main === 'cast' ? spells.map((o) => ({ ...o, name: SPELLS[o.key].name })) : [],
    movements: open.main === 'move' ? movements : [],
    events: getPreparedEvents(open.main).map((event) => ({ event, label: getEventLabel(event, zone), selected: open.trigger?.event === event })),
    who: [
      { id: null, name: 'anyone', selected: open.trigger?.who === null },
      ...Object.keys(state.characters).filter((id) => id !== actor.id).map((id) => ({ id, name: getFightName(state, id), selected: open.trigger?.who === id })),
    ],
    zone,
    complete: isPrepareComplete(state, actor, open),
  }
}

function getEventLabel(event: PreparedTrigger['event'], zone: number | null): string {
  switch (event) {
    case 'enters': return zone === null ? 'enters its reach' : `comes within ${zone} m`
    case 'sighted': return 'comes into sight'
    case 'attacked': return 'is attacked'
  }
}

// What each character has prepared in the round, for the table to read.
export function getPreparedRows(state: CombatState): PreparedRow[] {
  return getPrepared(state).map((p) => ({ id: p.id, actor: getFightName(state, p.actorId), text: getPreparedText(state, p) }))
}

function getPreparedText(state: CombatState, p: PrepareAction): string {
  const main = getPreparedMain(p, '')
  const what = main?.kind === 'strike' || main?.kind === 'shoot' ? `${main.kind} with ${main.attack}`
    : main?.kind === 'cast' && isSpellKey(main.key) ? `cast ${SPELLS[main.key].name}`
    : main?.kind === 'move' ? `${main.movement} move`
    : p.main === 'block' || p.main === 'intercept' || p.main === 'guard' ? `${p.main} with ${p.attack}`
    : ''
  const actor = state.characters[p.actorId]
  const zone = isCampaignCharacter(actor) ? getPreparedZone(state, actor, p) : null
  const who = p.trigger?.who ? getFightName(state, p.trigger.who) : 'anyone'
  return `${what} when ${who} ${p.trigger ? getEventLabel(p.trigger.event, zone) : ''}`.trim()
}
