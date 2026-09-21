# chargenfallow ↔ Foundry

`chargenfallow-bridge` is a Foundry VTT module (written against the v12 API,
not yet exercised against a live Foundry) that carries a scene to a
chargenfallow fight and back, through the mailbox at
`<server>/api/vtt/<fight id>`.

## The contract

A **snapshot** is what either side writes to the mailbox:

```json
{
  "version": 1,
  "board": {
    "origin": { "q": 12, "r": 9 },
    "radius": 14,
    "placements": { "<character id>": { "cell": { "q": 10, "r": 9 }, "orientation": 0, "elevation": 0, "focus": null } },
    "terrain": { "11,8": { "blocking": true, "transparent": false } }
  },
  "roster": [{ "id": "<character id>", "name": "Ana" }],
  "source": "vtt",
  "updatedAt": 1727000000000
}
```

- `board` is chargenfallow's own board (`app/domain/combat/types.ts`): axial
  hex cells, pointy-top, one cell one metre, terrain keyed by `"q,r"`. The app
  reads it through `makeBoard`, which keeps what it can read and drops the
  rest, so a snapshot can be partial but never breaks the fight.
- `roster` lists the fight's characters so the module can match tokens to
  character ids by name (case-insensitive), or by the token flag
  `flags.chargenfallow-bridge.characterId`.
- `source` says who wrote it; each side ignores its own echo.

## Install

Copy `chargenfallow-bridge/` into Foundry's `Data/modules/`, enable it in the
world, and set the server URL and fight id in its settings. The scene must use
a **row (pointy-top) hexagonal grid**.

Two buttons appear in the token controls:

- **Send board** — reads tokens, walls (rasterized to blocking cells; open
  doors are skipped; sight-less walls are transparent) and elevation, and
  POSTs the snapshot. Type the same fight id into the board panel's link field
  in chargenfallow and press **pull** (or turn **auto** on).
- **Apply board** — GETs the snapshot the app last **push**ed and moves the
  tokens the fight moved.

Elevation is converted through the scene's grid distance, so a 5 ft grid still
comes through as one metre per cell.

## Without Foundry

The board panel's **copy** and **paste** buttons move the same snapshot through
the clipboard, and `curl` can play the VTT:

```sh
curl -X POST localhost:3000/api/vtt/test -H 'Content-Type: application/json' \
  -d '{"board":{"placements":{"<id>":{"cell":{"q":1,"r":0}}}},"source":"vtt","updatedAt":1}'
curl localhost:3000/api/vtt/test
```
