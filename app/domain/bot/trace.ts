// What a bot weighed when it chose, for a person to read: each option it had,
// its value broken into the parts the bot weighs, and which it took.

export type OptionScore = {
  label: string
  value: number
  wounds: number
  threat: number
  engage: number
  resources: number
}

export type Decision = {
  // `turn`: what to do with its turn; `answer`: whether and how to defend
  kind: 'turn' | 'answer'
  actorId: string
  actor: string
  options: OptionScore[]
  chosen: number
}

export type Trace = (decision: Decision) => void
