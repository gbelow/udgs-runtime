import { z } from 'zod'
import { without } from './utils'
import type { Collection } from './campaign/types'

// Who is at the screen. Picked from a list with no sign-in for now, so a
// profile is who someone says they are.
export const ProfileSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
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
// GM's tools, and the developer is whoever runs the dev server.
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
// whoever is at the screen.
export function getCampaignRole(members: CampaignMembers, profile: string | null, devServer: boolean): Role {
  if (devServer) return 'dev'
  if (Object.keys(members).length === 0) return 'gm'
  return (profile && members[profile]) || 'player'
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

// The profile each player character in play belongs to, by character id.
// A character missing from it is the GM's.
export type CharacterOwners = Record<string, string>

// Whose character `id` is: as the campaign was opened, or, for a player
// character brought in since, as the player characters listed say.
export function getOwner(id: string, owners: CharacterOwners, listed: readonly { id: string; owner: string }[]): string | undefined {
  return owners[id] ?? listed.find((c) => c.id === id)?.owner
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

// A campaign's members as its members list shows them: each named, the one
// at the screen marked, with why they cannot be taken out or made a player.
export type MemberRow = ProfileListing & { role: MemberRole; me: boolean; removeBar: string | null; playerBar: string | null }

export function getMemberRows(members: CampaignMembers, profiles: readonly ProfileListing[], me: string | null): MemberRow[] {
  return profiles.filter((p) => p.id in members).map((p) => ({
    ...p, role: members[p.id], me: p.id === me,
    removeBar: getMemberBar(members, p.id, null), playerBar: getMemberBar(members, p.id, 'player'),
  }))
}
