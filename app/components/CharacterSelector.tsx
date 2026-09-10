'use client'
import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { upsertBaseCharacter, deleteBaseCharacter, getCharacter, deleteCharacter, JsonObject } from '../actions';
import { useCharacterLibrary, useLoadCharacter } from '../hooks/useCharacterLibrary';
import { useGameTab } from '../hooks/useGameTab';
import { makeCharacter } from '../domain/factories';
import { groupByTags, TreeNode } from '../domain/character/grouping';
import { BaseCharacter, Character } from '../domain/types';

type NodeHandlers = {
  open: { [key: string]: boolean }
  toggle: (key: string) => void
  selectedGameTab: string
  onSelect: (character: Character) => void
  onCreate: (tags: string[]) => void
  onDelete: (name: string) => void
}

function nodeKey(node: TreeNode): string {
  return node.type === 'character' ? node.character.name : node.tags.join('/')
}

// Recursive renderer over the tag-derived tree. Depth drives styling: the
// top-level group is bold/dark, nested groups lighter — but the structure is
// otherwise uniform, so it handles any tag depth.
function CharacterTreeNode({ node, depth, handlers }: {
  node: TreeNode
  depth: number
  handlers: NodeHandlers
}) {
  if (node.type === 'character') {
    return (
      <div className="flex flex-row p-1 bg-gray-600 rounded cursor-pointer hover:bg-gray-500">
        <input
          type={'button'}
          className='text-center w-full hover:bg-gray-500 p-1'
          value={node.character.name}
          aria-label={node.character.name}
          onClick={() => handlers.onSelect(node.character)}
        />
        {handlers.selectedGameTab === 'edit' ? (
          <button
            className="w-6 text-left font-semibold p-1 bg-red-500 rounded"
            onClick={() => handlers.onDelete(node.character.name)}
          >
            -
          </button>
        ) : null}
      </div>
    )
  }

  const key = node.tags.join('/')
  const isOpen = !!handlers.open[key]
  const isTop = depth === 0

  return (
    <div className="mb-2">
      <div className="flex flex-row mb-1 gap-1">
        <button
          onClick={() => handlers.toggle(key)}
          className={`w-full text-left p-1 rounded ${isTop ? 'font-bold bg-gray-800' : 'font-semibold bg-gray-700'}`}
        >
          {node.label}
        </button>
        <button
          className="w-6 text-left font-semibold p-1 bg-gray-700 rounded"
          onClick={() => handlers.onCreate(node.tags)}
        >
          +
        </button>
      </div>
      {isOpen && (
        <div className="ml-4 mt-1 space-y-1">
          {node.children.map(child => (
            <CharacterTreeNode
              key={nodeKey(child)}
              node={child}
              depth={depth + 1}
              handlers={handlers}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CharacterSelector(){

  const [open, setOpen] = useState<{ [key: string]: boolean }>({});
  const [openCampaignChars, setOpenCampaignChars] = useState(false)
  const { tab: selectedGameTab } = useGameTab()
  const loadCharacter = useLoadCharacter()
  const {
    baseCharacterList,
    playerCharacterList,
    refreshBaseList: updateBaseCharacterList,
    refreshPlayerList: updatePlayerCharacterList,
  } = useCharacterLibrary()

  const handleSelectCharacterClick = (character: Character) => {
    loadCharacter(character)
  };

  const handleSelectPlayerClick  = async (characterId: string) => {
    const res = await getCharacter(characterId)
    if(!res.ok){ toast.error(res.error); return }
    if(!res.data) return
    handleSelectCharacterClick(res.data)
    await updatePlayerCharacterList()
  };

  const handleDeletePlayerClick  = async (characterId: string) => {
    const res = await deleteCharacter(characterId)
    if(!res.ok){ toast.error(res.error); return }
    toast.success('Character deleted.')
    await updatePlayerCharacterList()
  };

  const toggle = (key: string) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const createCharacter = async (tags: string[]) => {
    // The name is a base character's identity on disk, so it can't be blank —
    // prompt for one. `tags` already carries the group path the `+` was clicked
    // in, so the new character lands in that folder.
    const name = window.prompt('Character name')?.trim()
    if (!name) return
    const res = await upsertBaseCharacter(makeCharacter({ name }, tags))
    if(!res.ok){ toast.error(res.error); return }
    updateBaseCharacterList()
  }

  const handleDeleteBaseCharacter = async (name: string) => {
    const res = await deleteBaseCharacter(name)
    if(!res.ok){ toast.error(res.error); return }
    updateBaseCharacterList()
  }

  // The flat list from disk is parsed through the domain factory so the sidebar
  // groups by the schema-authoritative `tags` (with defaults applied) rather
  // than trusting raw JSON shape.
  const characters = useMemo<BaseCharacter[]>(
    () => Object.values(baseCharacterList)
      .filter((v): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v))
      .map(v => makeCharacter(v)),
    [baseCharacterList]
  )
  const tree = useMemo(() => groupByTags(characters), [characters])

  const handlers: NodeHandlers = {
    open,
    toggle,
    selectedGameTab,
    onSelect: handleSelectCharacterClick,
    onCreate: createCharacter,
    onDelete: handleDeleteBaseCharacter,
  }

  return (
    <div className="bg-gray-900 text-white p-2">
      {
        tree.map(node => (
          <CharacterTreeNode key={nodeKey(node)} node={node} depth={0} handlers={handlers} />
        ))
      }
      {
        <div>
          <input type={'button'} key={'oplay'} className='w-full font-bold bg-gray-800 rounded hover:bg-gray-500 p-1 text-left' value={'PCs'} aria-label={'oplay'} onClick={() => setOpenCampaignChars(!openCampaignChars)}/>
          {
            openCampaignChars && playerCharacterList.sort().map(el =>
              <div
                key={el.id}
                className="flex flex-row p-1 bg-gray-600 rounded cursor-pointer hover:bg-gray-500 ml-2"
              >
                <input type={'button'} key={el.id} className='w-full text-center hover:bg-gray-500 p-1  text-left' value={el.name} aria-label={el.name} onClick={() => handleSelectPlayerClick(el.id)}/>
                <button className="w-6 text-left font-semibold p-1 bg-red-500 rounded" onClick={() => handleDeletePlayerClick(el.id)}>
                  -
                </button>
              </div>
            )
          }
        </div>
      }
    </div>
  );
}
