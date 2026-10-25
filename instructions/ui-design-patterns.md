
# Core goals
1. this app is three things at once:
- is a content authoring tool for fallowRPG. The book's content, such as items, spells, abilities, terrain features and characters are curated in this app.
- a tabletop game support tool. The game needs to support tabletop play with real minis. anything that uses the board needs to have a manual version.
- a vtt. a game should be completely playable through the software.

2. Three kinds of users:
- Developer: curates catalogs through the app.
- GM: The GM needs to be able to control everything about their game, but be warned when they do something that deviates from the standard. Just like developer, but with personal data.
- Player: only follows the standard rules. They author their character.

3. This tool is meant to teach the game. 
- a player is supposed to identify what they want to do. Have a clear goal.
- a player is supposed to see and understand all of their options in any given situation
- the consequences of any action and the details of all the steps that led to them need to be displayed
- No tutorials, only goals and options

4. what the app should contain

game running:
- exploration
- downtime
- combat
- chase
- boardless game - tabletop hybrid

future canditates
- free exploration
- dungeon: dungeon clock, dungeon areas
- character sheet mode: only turn tracking, derived value calculation and character resource tracking

catalog - all GM editable content
- abilities
- spells
- containers
- items
- free character editor
- weapons
- armor
- ammunition
- terrain
- races
- maps


# Constraints

- Transparency. Every number on screen has an origin the player can trace. Derived values have their calculations explicit. Show an unavailable option closed, with its reason, instead of hiding it. Every action needs to have an explanation of how its consequences came to be.
- Clarity: Every possible action at any state needs to be visible when running the game. Their cost needs to be known, and its effect too. When applying the effect to another character, it is not necessary to show the consequence of the effect. 
- Information. Only show what is necessary to make a decision during gameplay. The game should be aware of all the decisions a player can attempt to do and show the minimum  relevant set.
- Devices and contexts. GM targeted screens are only for PC. Mobile version for players in tabletop is possible. 
- Parity. Anything that needs the board needs a manual version. State whether the manual version is a degraded fallback or an equal citizen.
- Fidelity to the book. The book and the app need to be in sync and terms should not be changed.
- Deviation. What a GM may override, and how loudly the UI notes it.
- Tabletop compatibility: offer Manual versions of board interactions. Understand that movement and positions and all triggers wont be tracked by the app, but manual inserts for those things should be provided.
- Picking characters. Whenever a command needs characters chosen (a GM test, a target, a party member), they are picked by clicking them where they already are: the roster in the top bar, a card when there is no board, or the token on the board. Never a checkbox or a list inside the tool's form. The form says who is picked; the chosen ones are marked in the top bar and on the board.
- Permissions:
  1. player creates character and plays the game modes
  2. GM does everything player does, but has access to GM tools in combat, free character editor, the catalog and free map builder. GM also controls the clocks. Saves personal data.
  3. Dev does everything a GM does, plus save the game base content in assets.


# Stance of unfinished state




