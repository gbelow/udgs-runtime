import { z } from 'zod'
import { without } from './utils'
import type { Collection } from './campaign/types'

// Who is at the screen. Picked from a list with no sign-in for now, so a
// profile is who someone says they are. `manualDice` is someone who rolls
// their own dice at the table and types in what they show, where the screen
// would otherwise roll for them.
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  manualDice: z.boolean().default(false),
})
export type Profile = z.infer<typeof ProfileSchema>

export type ProfileListing = { id: string; name: string }

// A player character's row in the index: its name, and the profile it
// belongs to, or none for one saved before there were profiles.
export const CharacterListingSchema = z.object({
  name: z.string().catch(''),
  owner: z.string().nullable().catch(null),
}).catch({ name: '', owner: null })
export type CharacterListing = z.infer<typeof CharacterListingSchema>

// Why a profile cannot go by `name`.
export function getProfileNameBar(name: string): string | null {
  return name.trim() ? null : 'name the profile'
}

// Who is at the screen, as far as the rules a character is held to go. A
// player only follows the standard rules; the GM and the developer have the
// GM's tools, and the developer is a GM on the dev server.
export type Role = 'player' | 'gm' | 'dev'

export function hasGmTools(role: Role): boolean {
  return role !== 'player'
}

// Who plays a campaign and as what, by profile id.
export const CampaignMembersSchema = z.record(z.string(), z.enum(['gm', 'player']))
export type CampaignMembers = z.infer<typeof CampaignMembersSchema>
export type MemberRole = CampaignMembers[string]

// The role of `profile` in a campaign with these members. A campaign nobody
// has joined yet, the one played before it is ever saved, is the GM's of
// whoever is at the screen. On the dev server a GM is the developer; a player
// stays a player.
export function getCampaignRole(members: CampaignMembers, profile: string | null, devServer: boolean): Role {
  const role = Object.keys(members).length === 0 ? 'gm' : (profile && members[profile]) || 'player'
  return devServer && role === 'gm' ? 'dev' : role
}

// Why `profile` cannot be made `role` (or taken out, with null): a campaign
// always keeps a GM.
export function getMemberBar(members: CampaignMembers, profile: string, role: MemberRole | null): string | null {
  if (role === 'gm' || members[profile] !== 'gm') return null
  return Object.values(members).filter((r) => r === 'gm').length > 1 ? null : 'a campaign keeps at least one GM'
}

export function setMember(members: CampaignMembers, profile: string, role: MemberRole | null): CampaignMembers {
  if (getMemberBar(members, profile, role)) return members
  return role ? { ...members, [profile]: role } : without(members, profile)
}

// A saved campaign's row in the index: its name and who plays it, so a
// profile's campaigns are listed without opening each.
export const CampaignListingSchema = z.object({
  name: z.string().catch(''),
  members: CampaignMembersSchema.catch({}),
}).catch({ name: '', members: {} })
export type CampaignListing = z.infer<typeof CampaignListingSchema>

// Whether `profile` reads a collection: it is theirs, shared with them, or
// shared with a campaign `inCampaign` says they read it through.
export function canReadCollection(c: Collection, profile: string | null, inCampaign: (campaign: string) => boolean): boolean {
  return profile !== null && (c.owner === profile || c.shared.profiles.includes(profile) || c.shared.campaigns.some(inCampaign))
}

// Whether `profile` changes what `owner` owns: only its owner, or the
// developer.
export function isOwnerOrDev(owner: string | null, profile: string | null, devServer: boolean): boolean {
  return devServer || (profile !== null && owner === profile)
}

// Whose player characters `profile` sees: their own, and those of everyone
// playing a campaign they are the GM of.
export function getOwnersSeenBy(profile: string, campaigns: readonly CampaignMembers[]): Set<string> {
  return new Set([profile, ...campaigns.filter((m) => m[profile] === 'gm').flatMap((m) => Object.keys(m))])
}

// The profile each player character in play belongs to, by character id, as
// the campaign was opened or as the GM has assigned them since; null for one
// the GM took back. A character missing from it is the GM's.
export const CharacterOwnersSchema = z.record(z.string(), z.string().nullable())
export type CharacterOwners = z.infer<typeof CharacterOwnersSchema>

// Whose character `id` is: as the campaign was opened or assigned since, or,
// for a player character brought in since, as the player characters listed
// say.
export function getOwner(id: string, owners: CharacterOwners, listed: readonly { id: string; owner: string }[]): string | undefined {
  return id in owners ? owners[id] ?? undefined : listed.find((c) => c.id === id)?.owner
}

// Whom the GM may give a character in play to: the campaign's members, and
// whoever plays them now.
export function getOwnerOptions(members: CampaignMembers, profiles: readonly ProfileListing[], owner: string | null): ProfileListing[] {
  return profiles.filter((p) => p.id in members || p.id === owner)
}

// Why a character cannot be given to `owner` in a campaign with these
// members: only a member plays one.
export function getAssignBar(members: CampaignMembers, owner: string | null): string | null {
  return owner === null || owner in members ? null : 'only a member of the campaign plays a character'
}

// Whether `profile`, as `role` in the campaign, plays a character `owner`
// owns: a player plays only their own, and a GM plays everyone.
export function canControl(owner: string | undefined, profile: string | null, role: Role): boolean {
  return hasGmTools(role) || (profile !== null && owner === profile)
}

// Why `profile`, as `role`, cannot play a character `owner` owns: someone
// else plays them, named from `profiles`, or the GM does.
export function getControlBar(owner: string | undefined, profile: string | null, role: Role, profiles: readonly ProfileListing[]): string | null {
  if (canControl(owner, profile, role)) return null
  const name = owner ? profiles.find((p) => p.id === owner)?.name : undefined
  return owner ? `played by ${name || 'another player'}` : 'played by the GM'
}

// Whether `profile`, as `role` in the campaign, may change or throw away a
// journal entry `author` wrote: the GM any, a player only their own notes.
export function canChangeEntry(author: string | null, profile: string | null, role: Role): boolean {
  return hasGmTools(role) || (profile !== null && author === profile)
}

// Whom a press or a click acts for, so that the screen lets it be made only
// by whoever plays them: a character by id, any of several characters (a
// party's own business, open to whoever plays one of them), the GM (the
// parties, the clock, what the table enters), the GM with the action bar
// switched to GM (the scene's brush and repositioning tool), or nobody for
// one that only picks whom to look at or does nothing.
export type Actor = { id: string } | { anyOf: readonly string[] } | 'gm' | 'gmTool' | null

// Who is at the screen, as far as whom they may act for goes: their profile
// and role, whether the action bar is switched to GM, the profiles there are,
// and whose each character in play is.
export type Viewer = { profile: string | null; role: Role; gmMode: boolean; profiles: readonly ProfileListing[]; ownerOf: (id: string) => string | undefined }

// Why the viewer cannot act for `actor`, or null when they can.
export function getActorBar(actor: Actor, v: Viewer): string | null {
  if (actor === null) return null
  if (actor === 'gm') return hasGmTools(v.role) ? null : "the GM's to do"
  if (actor === 'gmTool') return hasGmTools(v.role) && v.gmMode ? null : 'a GM tool: switch the action bar to GM'
  if ('anyOf' in actor) return actor.anyOf.some((id) => canControl(v.ownerOf(id), v.profile, v.role)) ? null : 'nobody you play is in it'
  return getControlBar(v.ownerOf(actor.id), v.profile, v.role, v.profiles)
}

// A campaign's members as its members list shows them: each named, the one
// at the screen marked, with why they cannot be taken out or made a player.
export type MemberRow = ProfileListing & { role: MemberRole; me: boolean; removeBar: string | null; playerBar: string | null }

export function getMemberRows(members: CampaignMembers, profiles: readonly ProfileListing[], me: string | null): MemberRow[] {
  return profiles.filter((p) => p.id in members).map((p) => ({
    ...p, role: members[p.id], me: p.id === me,
    removeBar: getMemberBar(members, p.id, null), playerBar: getMemberBar(members, p.id, 'player'),
  }))
}
