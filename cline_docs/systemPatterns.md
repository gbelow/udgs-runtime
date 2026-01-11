
## 1) Known repo facts (ground truth extracted)

- Gear penalties currently affect AGI (`getAGI = AGI - getGearPenalties`).
- Wound thresholds RES/TGH/INS are derived via STR + base + DM and floored.
- `makeCharacter` deep-merges nested objects so partial JSON templates work.
- `equipArmor` scales armor by character size via `scaleArmor` helper.

## 2) Open questions / “ask before changing”

- Is there a `Rulebook.md` and/or `rule_graph.json` intended to exist in this repo?
  - `.clinerules` references them, but they are not present right now.
  - If you want me to add them, tell me desired format/content.

## 3) Task prompt template (copy/paste for new work)

**Task:** <one sentence>

**Constraints:**
- Domain logic in `app/domain/**`
- No derived state in components
- Preserve formula invariants

**Acceptance criteria:**
- <observable behavior>
- <tests or manual steps>
