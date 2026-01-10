
export const SkillPenaltyTable = {
  "mobility": [
    "strike",
    "defend",
    "reflex",
    "accuracy",
    "sneak",
    "prestidigitation",
    "balance",
    "climb",
  ],
  "injury":[
    "strike",
    "defend",
    "reflex",
    "accuracy",
    "grapple",
    "sneak",
    "prestidigitation",
    "balance",
    "strength",
    "swim",
    "climb",
  ],
  "vision":[
    "strike",
    "defend",
    "reflex",
    "accuracy",
    "grapple",
    "sneak",
    "prestidigitation",
    "balance",
    "climb",
    "explore",
    "cunning",
    "detect"
  ],
  "mental":[
    "strike",
    "reflex",
    "accuracy",
    "sneak",
    "prestidigitation",
    "balance",
    "climb",
    "knowledge",
    "spellcast",
    "explore",
    "will",
    "cunning",
    "combustion",
    "eletromag",
    "radiation",
    "entropy",
    "biomancy",
    "telepathy",
    "animancy",
    "detect"
  ],
  "health":[
    "health"
  ]
}

export const SMArr = [-2,-1,0,1,2,3,4]
export const dmgArr = [0.5, 0.75, 1, 1.5, 2, 3, 4]
export const injuryMap = {light:2, serious: 10, deadly: 20}

export const AFFLICTIONS = {
  prone: { mobility: 3, controlable: true},
  grappled: { mobility: 3, controlable: true},
  immobile: { mobility: 3, controlable: true},
  limp: { mobility: 3, controlable: true},

  dazzled: { vision: 2, controlable: true},
  blind: { vision: 8, controlable: true},

  fear: { mental: 1, controlable: true},
  rage: { mental: 1, controlable: true},
  confused: { mental: 3, controlable: true},
  seduced: { controlable: true},
  distracted: { controlable: true},
  dominated: { controlable: true},
  
  weakened: { health: 2, controlable: true},
  malnourished: { health: 2, controlable: true},
  thirsty: { health: 2, controlable: true},
  dehydrated: { health: 2, controlable: true},
  tired: { mental: 1, controlable: true},
  exhausted: { mental: 2, controlable: true},
  sick: { health: 2, controlable: true},
}