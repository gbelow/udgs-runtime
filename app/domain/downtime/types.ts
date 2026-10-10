import { z } from 'zod'
import { ProficienciesSchema, SkillsSchema, type Proficiencies, type Skills } from '../types'
import { TestRollSchema } from '../play/test'
import { LIVING_LEVELS } from '../lists'
import type { CampaignState } from '../campaign/types'

const SkillKeySchema = z.enum(Object.keys(SkillsSchema.shape) as [keyof Skills, ...(keyof Skills)[]])
const TrainingKeySchema = z.enum([...Object.keys(SkillsSchema.shape), ...Object.keys(ProficienciesSchema.shape)] as [keyof Skills | keyof Proficiencies, ...(keyof Skills | keyof Proficiencies)[]])

// What a training teaches: a skill or proficiency, a formal knowledge by
// name, or an ability family. Attributes and talents are not trained in
// downtime.
export const TrainingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('trainable'), key: TrainingKeySchema }),
  z.object({ kind: z.literal('knowledge'), name: z.string() }),
  z.object({ kind: z.literal('ability'), family: z.string() }),
])
export type TrainingTarget = z.infer<typeof TrainingTargetSchema>

// story.tex "Job": "arbitrary skill or knowledge vs DL".
export const SkillRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('skill'), key: SkillKeySchema }),
  z.object({ kind: z.literal('knowledge'), name: z.string() }),
])
export type SkillRef = z.infer<typeof SkillRefSchema>

// The table's answer to a training request: a trainer is found, or not.
export const DECISIONS = ['pending', 'accepted', 'refused'] as const

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
})
export type DowntimeState = z.infer<typeof DowntimeStateSchema>

// Downtime runs on the whole roster at once, beside the campaign it moves.
export type Downtime = { campaign: CampaignState; downtime: DowntimeState }

export type DowntimeUpdater = (t: Downtime) => Downtime
