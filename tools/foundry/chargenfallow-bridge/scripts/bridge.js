// chargenfallow bridge: the VTT's side of the mailbox at
// <server>/api/vtt/<fight>. "Send" reads the scene into a board snapshot in
// game units and POSTs it; "Apply" GETs the latest snapshot and moves the
// tokens the fight moved. Written against the Foundry v12 API.
//
// Units: one hex is one metre in chargenfallow. Token elevation is scaled
// by the scene's grid distance so a 5 ft grid still lands on whole metres
// per cell.

const MODULE = 'chargenfallow-bridge'

Hooks.once('init', () => {
  game.settings.register(MODULE, 'serverUrl', {
    name: 'chargenfallow server',
    hint: 'Where the app is served, e.g. http://localhost:3000',
    scope: 'world', config: true, type: String, default: 'http://localhost:3000',
  })
  game.settings.register(MODULE, 'fightId', {
    name: 'Fight id',
    hint: "The id typed into the board panel's link field.",
    scope: 'world', config: true, type: String, default: '',
  })
})

Hooks.on('getSceneControlButtons', (controls) => {
  const tools = [
    { name: 'cf-send', title: 'Send board to chargenfallow', icon: 'fas fa-upload', button: true, onClick: () => send().catch(fail) },
    { name: 'cf-apply', title: 'Apply chargenfallow board', icon: 'fas fa-download', button: true, onClick: () => apply().catch(fail) },
  ]
  // v12 hands an array of control groups; v13 an object keyed by name.
  const token = Array.isArray(controls) ? controls.find((c) => c.name === 'token') : controls.token
  if (!token) return
  if (Array.isArray(token.tools)) token.tools.push(...tools)
  else for (const t of tools) token.tools[t.name] = { ...t, order: 100 }
})

function fail(e) {
  console.error(`${MODULE}:`, e)
  ui.notifications.error(`${MODULE}: ${e.message ?? e}`)
}

function mailboxUrl() {
  const server = game.settings.get(MODULE, 'serverUrl').replace(/\/$/, '')
  const fight = game.settings.get(MODULE, 'fightId')
  if (!fight) throw new Error('set a fight id in the module settings')
  return `${server}/api/vtt/${encodeURIComponent(fight)}`
}

// ---------------------------------------------------------------------------
// The grid

function hexGrid() {
  const grid = canvas.grid
  if (!grid.isHexagonal) throw new Error('the scene needs a hexagonal grid')
  // chargenfallow's hexes are pointy-top: rows, not columns.
  if (grid.columns) throw new Error('the scene grid must be a row (pointy-top) hex grid')
  return grid
}

function cellOf(point) {
  const { q, r } = hexGrid().getCube(point)
  return { q, r }
}

function key(cell) {
  return `${cell.q},${cell.r}`
}

// A token's anchor cell: the cell under its centre for a one-hex token, and
// under the top-left hex for a bigger one, which is where chargenfallow
// anchors a blob.
function anchorOf(token) {
  const doc = token.document
  if (doc.width <= 1 && doc.height <= 1) return cellOf(token.center)
  const size = canvas.grid.size
  return cellOf({ x: doc.x + size / 2, y: doc.y + size / 2 })
}

// ---------------------------------------------------------------------------
// Scene -> snapshot

async function fetchRoster() {
  const res = await fetch(mailboxUrl())
  if (!res.ok) return []
  const snap = await res.json()
  return Array.isArray(snap.roster) ? snap.roster : []
}

// Which character a token stands for: a flag set on the token, or the
// roster entry whose name is the token's.
function characterIdOf(token, roster) {
  const flagged = token.document.getFlag(MODULE, 'characterId')
  if (flagged) return flagged
  const name = token.document.name.trim().toLowerCase()
  return roster.find((c) => c.name.trim().toLowerCase() === name)?.id ?? null
}

function readWalls() {
  const terrain = {}
  const step = canvas.grid.size / 4
  for (const wall of canvas.walls.placeables) {
    const doc = wall.document
    if (doc.door && doc.ds === CONST.WALL_DOOR_STATES.OPEN) continue
    const [x1, y1, x2, y2] = doc.c
    const length = Math.hypot(x2 - x1, y2 - y1)
    const samples = Math.max(1, Math.ceil(length / step))
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const cell = cellOf({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t })
      const k = key(cell)
      terrain[k] = { ...(terrain[k] ?? {}), blocking: true, transparent: doc.sight === CONST.WALL_SENSE_TYPES.NONE }
    }
  }
  return terrain
}

async function send() {
  hexGrid()
  const roster = await fetchRoster()
  const metresPerUnit = 1 / (canvas.scene.grid.distance || 1)
  const placements = {}
  const unmatched = []
  for (const token of canvas.tokens.placeables) {
    const id = characterIdOf(token, roster)
    if (!id) { unmatched.push(token.document.name); continue }
    placements[id] = { cell: anchorOf(token), orientation: 0, elevation: token.document.elevation * metresPerUnit, focus: null }
  }
  const rect = canvas.dimensions.sceneRect
  const origin = cellOf({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
  const radius = Math.ceil(Math.max(rect.width, rect.height) / canvas.grid.size / 2) + 1
  const snapshot = {
    version: 1,
    board: { placements, terrain: readWalls(), origin, radius },
    roster,
    source: 'vtt',
    updatedAt: Date.now(),
  }
  const res = await fetch(mailboxUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot) })
  if (!res.ok) throw new Error(`mailbox answered ${res.status}`)
  ui.notifications.info(`${MODULE}: sent ${Object.keys(placements).length} tokens` + (unmatched.length ? `; unmatched: ${unmatched.join(', ')}` : ''))
}

// ---------------------------------------------------------------------------
// Snapshot -> scene

async function apply() {
  const grid = hexGrid()
  const res = await fetch(mailboxUrl())
  if (!res.ok) throw new Error(res.status === 404 ? 'nothing in the mailbox yet' : `mailbox answered ${res.status}`)
  const snap = await res.json()
  if (snap.source !== 'app') { ui.notifications.info(`${MODULE}: the mailbox holds the scene's own snapshot`); return }
  const roster = Array.isArray(snap.roster) ? snap.roster : []
  const unitsPerMetre = canvas.scene.grid.distance || 1
  const updates = []
  for (const token of canvas.tokens.placeables) {
    const id = characterIdOf(token, roster)
    const placement = id ? snap.board?.placements?.[id] : null
    if (!placement) continue
    const { q, r } = placement.cell
    const { x, y } = grid.getTopLeftPoint({ q, r, s: -q - r })
    updates.push({ _id: token.id, x, y, elevation: placement.elevation * unitsPerMetre })
  }
  await canvas.scene.updateEmbeddedDocuments('Token', updates)
  ui.notifications.info(`${MODULE}: moved ${updates.length} tokens`)
}
