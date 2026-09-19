'use client'
import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { upsertBaseCharacter, deleteBaseCharacter, getCharacter, deleteCharacter, JsonObject } from '../actions';
import { useCharacterLibrary, useLoadCharacter } from '../hooks/useCharacterLibrary';
import { useGameTab } from '../hooks/useGameTab';
import { makeCharacter } from '../domain/factories';
import { groupByTags, TreeNode } from '../domain/character/grouping';
import { BaseCharacter, Character } from '../domain/types';
import { ListButton } from './ui';

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
      <div className="flex flex-row items-center gap-1">
        <ListButton className='grow py-0.5' aria-label={node.character.name} onClick={() => handlers.onSelect(node.character)}>{node.character.name}</ListButton>
        {handlers.selectedGameTab === 'edit' ? (
          <button type='button' className="w-5 text-xs text-muted hover:text-bad cursor-pointer" title={`delete ${node.character.name}`}
            onClick={() => handlers.onDelete(node.character.name)}>×</button>
        ) : null}
      </div>
    )
  }

  const key = node.tags.join('/')
  const isOpen = !!handlers.open[key]
  const isTop = depth === 0

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-row items-center gap-1">
        <button type='button' onClick={() => handlers.toggle(key)}
          className={`grow text-left px-1 py-0.5 rounded cursor-pointer hover:bg-raised ${isTop ? 'text-[10px] uppercase tracking-wider text-muted' : 'text-sm text-muted'}`}>
          <span className='inline-block w-3 text-muted'>{isOpen ? '▾' : '▸'}</span>{node.label}
        </button>
        <button type='button' className="w-5 text-xs text-muted hover:text-good cursor-pointer" title='new character here'
          onClick={() => handlers.onCreate(node.tags)}>+</button>
      </div>
      {isOpen && (
        <div className="ml-3 pl-1 border-l border-line flex flex-col gap-0.5">
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
    <div className="flex flex-col gap-1 text-sm">
      {
        tree.map(node => (
          <CharacterTreeNode key={nodeKey(node)} node={node} depth={0} handlers={handlers} />
        ))
      }
      {
        <div>
          <button type='button' key={'oplay'} className='w-full text-left px-1 py-0.5 rounded cursor-pointer hover:bg-raised text-[10px] uppercase tracking-wider text-muted' aria-label={'oplay'} onClick={() => setOpenCampaignChars(!openCampaignChars)}>
            <span className='inline-block w-3'>{openCampaignChars ? '▾' : '▸'}</span>PCs
          </button>
          {
            openCampaignChars && playerCharacterList.sort().map(el =>
              <div key={el.id} className="flex flex-row items-center gap-1 ml-3 pl-1 border-l border-line">
                <ListButton className='grow py-0.5' aria-label={el.name} onClick={() => handleSelectPlayerClick(el.id)}>{el.name}</ListButton>
                <button type='button' className="w-5 text-xs text-muted hover:text-bad cursor-pointer" title={`delete ${el.name}`} onClick={() => handleDeletePlayerClick(el.id)}>×</button>
              </div>
            )
          }
        </div>
      }
    </div>
  );
}
