Rules in gear.tex with no way to work in the app

Cannot be represented at all
1. Blunt STR + Cut 1.5x STR on the same row (Halberd hook, Warhammer hook). The model has one STRmod for both columns. I encoded STRmod: 1 (blunt) and cut: 0. The attack-resolution skill also says a non-plain multiplier in the Cut column is a table error worth flagging — so this may be a rulebook fix rather than a model fix.
2. Grenade Blunt X / Cut X — variable by grenade type; stored as 0/0.
3. Net Cut: grapple — not a number. Stored cut: 0 and moved grapple into properties, which is how every other grapple attack in the file is encoded.
4. Unarmed RES: TGH — RES is a number plus RESmod (a STR multiplier), so I used RESmod: 0.5. That equals TGH only at size 3 and only for a character with no TGH base term. (Unarmed row 2's RES: STR maps cleanly to RESmod: 1.)
5. Size column (small/medium/large) and Price have no field in the weapon model. Note this Size is not scale — scale is the 1–7 creature size, and the instructions fix it at 3.
6. Bow footnote: "untrained characters spend an extra 3 AP per shot." Nothing models weapon training, so STR 13/STR 16 and the bow asterisk are inert text in properties.
7. Arrow types (bodkin → penetrating, broadhead → vicious, explosive) — no ammunition concept exists.
8. Shield table columns Insulation and Weight have nowhere to go. More importantly, gear.tex's Shields table gives shields no attack row at all (no Blunt/Cut/hand/range/properties). The shield bash rows in the file (blunt: 8, heavy I) are carried over from the old data and have no source in the rulebook — I updated only RES/penalty/deflection from the table. Tell me if you'd rather I strip the bash to a bare DEF row.
9. DEF blocking value (STR one-handed, 2×STR two-handed/shield) isn't computed anywhere — deflection on a shield row is the Cover column, a different quantity.

Fixed while migrating
- heavy II-III (Warhammer hammer head) wasn't in getAttacksList's recognized property list, so that row would have offered only a basic attack that the rulebook forbids. Added.

Interpretations I made — say the word if you disagree
- Rows carrying slow with a STR/2xSTR range (thrown Dagger, thrown Short Spear) are typed "ranged", so they resolve on Accuracy. gear.tex puts them in the melee tables but its property list says slow/fast/UF are "only for ranged weapons".
- STRmod applies to blunt only. Every STR-multiple entry in the tables is in the Blunt column with Cut 0; applying it to cut would give the wooden shaft attacks cutting damage they shouldn't have.