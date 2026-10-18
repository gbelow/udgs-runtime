import { z } from 'zod'
import { without } from './utils'
import type { Collection } from './campaign/types'

// Who is at the screen. Picked from a list with no sign-in for now, so a
// profile is who someone says they are. `dice` is where they roll: the screen
// rolls for them at once, they throw in the dice tray, or they roll their own
// dice at the table and type in what they show. A profile saved when the only
// choice was their own dice or none keeps that choice.
export const DICE_PLACES = ['screen', 'tray', 'table'] as const
export type DicePlace = (typeof DICE_PLACES)[number]

export const ProfileSchema = z.preprocess(
  (raw) => (raw && typeof raw === 'object' && !('dice' in raw) && 'manualDice' in raw ? { ...raw, dice: raw.manualDice ? 'table' : 'screen' } : raw),
  z.object({
    id: z.string(),
    name: z.string().default(''),
    dice: z.enum(DICE_PLACES).catch('screen'),
  }),
)
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

// Who asks to bring which character into a campaign: the profile asking, by
// the id of the character they bring, one request per character.
export const JoinRequestsSchema = z.record(z.string(), z.string())
export type JoinRequests = z.infer<typeof JoinRequestsSchema>

// A saved campaign's row in the index: its name, who plays it and who asks
// to, and whether it is locked, so a profile's campaigns are listed, and
// joined, without opening each.
export const CampaignListingSchema = z.object({
  name: z.string().catch(''),
  members: CampaignMembersSchema.catch({}),
  requests: JoinRequestsSchema.catch({}),
  locked: z.boolean().catch(false),
}).catch({ name: '', members: {}, requests: {}, locked: false })
export type CampaignListing = z.infer<typeof CampaignListingSchema>

// A request as the screen lists it: the character brought, named, and the
// profile asking.
export type JoinRequestRow = { character: string; name: string; profile: string }

// A saved campaign as a profile sees it in the list: what they are in it, if
// anything, and the requests they may see — every one for its GM, their own
// for anyone else.
export type CampaignRow = { id: string; name: string; member: MemberRole | null; requests: JoinRequestRow[]; locked: boolean }

export function getCampaignRow(id: string, row: CampaignListing, profile: string | null, characterName: (id: string) => string): CampaignRow {
  const member = (profile && row.members[profile]) || null
  const requests = Object.entries(row.requests)
    .filter(([, by]) => member === 'gm' || by === profile)
    .map(([character, by]) => ({ character, name: characterName(character), profile: by }))
  return { id, name: row.name, member, requests, locked: row.locked }
}

// Why `profile` cannot ask to bring a character `owner` owns into a
// campaign: it is not theirs, or it is asked for already.
export function getJoinBar(row: CampaignListing, character: string, owner: string | null, profile: string | null): string | null {
  if (profile === null || owner !== profile) return 'only its owner brings a character'
  return character in row.requests ? 'asked for already' : null
}

// What the screen offers a profile for joining campaigns: the campaigns they
// may ask to bring a character into (any they are not the GM of), their
// characters, and the requests they have made and wait on.
export type JoinView = {
  campaigns: { id: string; name: string }[]
  characters: { id: string; name: string }[]
  pending: (JoinRequestRow & { campaign: string; campaignName: string })[]
}

export function getJoinView(rows: readonly CampaignRow[], characters: readonly { id: string; name: string; owner: string }[], profile: string | null): JoinView {
  return {
    campaigns: rows.filter((r) => r.member !== 'gm').map((r) => ({ id: r.id, name: r.name })),
    characters: characters.filter((c) => c.owner === profile).map((c) => ({ id: c.id, name: c.name })),
    pending: rows.filter((r) => r.member !== 'gm').flatMap((r) => r.requests.filter((q) => q.profile === profile).map((q) => ({ ...q, campaign: r.id, campaignName: r.name }))),
  }
}

// The open campaign's requests as its GM answers them: each with the name of
// the profile asking.
export function getRequestRows(rows: readonly CampaignRow[], campaign: string, profiles: readonly ProfileListing[]): (JoinRequestRow & { profileName: string })[] {
  const row = rows.find((r) => r.id === campaign)
  if (!row || row.member !== 'gm') return []
  return row.requests.map((q) => ({ ...q, profileName: profiles.find((p) => p.id === q.profile)?.name || 'a profile' }))
}

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

// The profile each character in a campaign is played by, by character id,
// kept with the campaign; null for one the GM took back. A character missing
// from it is the GM's.
export const CharacterOwnersSchema = z.record(z.string(), z.string().nullable())
export type CharacterOwners = z.infer<typeof CharacterOwnersSchema>

// Whose character `id` is, if a player's.
export function getOwner(id: string, owners: CharacterOwners): string | undefined {
  return owners[id] ?? undefined
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

// Whether the dice of a character `owner` owns are `profile`'s to throw on
// their own screen, as `role`: a player's own characters' dice, the GM's
// every character no player plays. The GM answers a player's die only by
// taking it over, never by itself.
export function isOwnRoller(owner: string | undefined, profile: string | null, role: Role): boolean {
  return owner === undefined ? hasGmTools(role) : profile !== null && owner === profile
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
// party's own business, open to whoever plays one of them), the profile that
// wrote something (or the GM: a note in the journal), the GM (the
// parties, the clock, what the table enters, the scene's grid, brush and
// repositioning tool), or nobody for one that only picks whom to look at or
// does nothing.
export type Actor = { id: string } | { anyOf: readonly string[] } | { author: string | null } | 'gm' | null

// Who is at the screen, as far as whom they may act for goes: their profile
// and role, whether the action bar is switched to GM, the profiles there are,
// and whose each character in play is.
export type Viewer = { profile: string | null; role: Role; gmMode: boolean; profiles: readonly ProfileListing[]; ownerOf: (id: string) => string | undefined }

// Why the viewer cannot act for `actor`, or null when they can.
export function getActorBar(actor: Actor, v: Viewer): string | null {
  if (actor === null) return null
  if (actor === 'gm') return hasGmTools(v.role) ? null : "the GM's to do"
  if ('author' in actor) return canChangeEntry(actor.author, v.profile, v.role) ? null : "someone else's to change"
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
