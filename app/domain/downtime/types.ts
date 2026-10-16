import { z } from 'zod'
import { KnowledgesSchema, ProficienciesSchema, SkillsSchema, type Knowledges, type Proficiencies, type Skills } from '../types'
import { TestRollSchema } from '../play/test'
import { CallsSchema } from '../play/calls'
import { LIVING_LEVELS } from '../lists'
import type { CampaignState } from '../campaign/types'

const SkillKeySchema = z.enum(Object.keys(SkillsSchema.shape) as [keyof Skills, ...(keyof Skills)[]])
type TrainingKey = keyof Skills | keyof Proficiencies | keyof Knowledges
const TrainingKeySchema = z.enum([...Object.keys(SkillsSchema.shape), ...Object.keys(ProficienciesSchema.shape), ...Object.keys(KnowledgesSchema.shape)] as [TrainingKey, ...TrainingKey[]])

// What a training teaches: a skill, proficiency or formal knowledge, or an
// ability family. Attributes and talents are not trained in downtime, and a
// specific knowledge is learned, never trained.
export const TrainingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trainable'), key: TrainingKeySchema }),
  z.object({ kind: z.literal('ability'), family: z.string() }),
])
export type TrainingTarget = z.infer<typeof TrainingTargetSchema>

// story.tex "Job": "arbitrary skill or knowledge vs DL" — a knowledge by
// name, formal or specific.
export const SkillRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill'), key: SkillKeySchema }),
  z.object({ kind: z.literal('knowledge'), name: z.string() }),
])
export type SkillRef = z.infer<typeof SkillRefSchema>

// The table's answer to a training request: a trainer is found, or not.
export const DECISIONS = ['pending', 'accepted', 'refused'] as const

// What of an activity the table enters, rather than whoever plays the
// character: its DL, the trainer's rate and whether a trainer is found, the
// wage, the doctor's capacity and price, and what a learning test can gain
// and reach.
const TABLE_TERMS: readonly string[] = ['DL', 'rate', 'decision', 'wage', 'capacity', 'price', 'gains', 'max']

export function isTableTerm(key: string): boolean {
  return TABLE_TERMS.includes(key)
}

// story.tex "Downtime": one activity, done day after day until its days are
// over and then resolved whole. A training is for `XP` XP, over 10 days each;
// prices and wages are in coppers. The table enters every DL, rate and wage.
export const BlockSchema = z.discriminatedUnion('kind', [
  // "Training": with a trainer, at the trainer's rate a day
  z.object({ kind: z.literal('training'), target: TrainingTargetSchema, XP: z.number().default(1), rate: z.number().default(0), decision: z.enum(DECISIONS).default('pending') }),
  // "Training without trainer"
  z.object({ kind: z.literal('self'), target: TrainingTargetSchema, XP: z.number().default(1) }),
  // "Job": a wage a day, for the employer
  z.object({ kind: z.literal('job'), days: z.number().default(10), test: SkillRefSchema, DL: z.number().default(5), wage: z.number().default(0) }),
  // "Healing": a doctor's IL a day, at a price per IL
  z.object({ kind: z.literal('doctor'), days: z.number().default(1), capacity: z.number().default(4), price: z.number().default(10) }),
  // story.tex "Learning tests": levels of a specific knowledge by degree, up
  // to a limit
  z.object({
    kind: z.literal('learning'), days: z.number().default(30), test: SkillRefSchema, DL: z.number().default(5),
    knowledge: z.string().default(''), gains: z.tuple([z.number(), z.number(), z.number(), z.number()]).default([0, 1, 2, 3]), max: z.number().default(4),
  }),
])
export type Block = z.infer<typeof BlockSchema>
export type BlockKind = Block['kind']

// story.tex "Downtime": what a character can spend their days on; a training
// is with a trainer or alone.
export const ACTIVITIES = ['training', 'job', 'doctor', 'learning'] as const
export type Activity = (typeof ACTIVITIES)[number]

// One character's downtime: how they live, whether someone houses them, and
// the one activity they are on ("Only one thing can be done per day").
// `elapsed` is the days already spent on it, as of the clock reading `at`;
// time spent anywhere else since interrupts it.
export const PlanSchema = z.object({
  living: z.enum(LIVING_LEVELS).default('medium'),
  housed: z.boolean().default(false),
  block: BlockSchema.nullable().default(null),
  elapsed: z.number().default(0),
  at: z.number().default(0),
})
export type Plan = z.infer<typeof PlanSchema>

// What a character's days came to, line by line, as the table reads it.
export const DowntimeResultSchema = z.object({
  name: z.string(),
  what: z.string(),
  roll: TestRollSchema.nullable().default(null),
  note: z.string().default(''),
})
export type DowntimeResult = z.infer<typeof DowntimeResultSchema>

export const DowntimeStateSchema = z.object({
  plans: z.record(z.string(), PlanSchema).default({}),
  results: z.array(DowntimeResultSchema).default([]),
  // the tests the passing days have called for, waiting on their dice, and
  // how many days they are
  calls: CallsSchema.default({}),
  passing: z.number().nullable().default(null),
})
export type DowntimeState = z.infer<typeof DowntimeStateSchema>

// Downtime runs on the whole roster at once, beside the campaign it moves.
export type Downtime = { campaign: CampaignState; downtime: DowntimeState }

export type DowntimeUpdater = (t: Downtime) => Downtime
