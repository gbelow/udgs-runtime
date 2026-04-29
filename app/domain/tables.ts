
export const SkillPenaltyTable = {
  "mobility":[
    ""
  ],
  "injury":[
    "will",
    "grapple",
    "strength",
    "climb",
    "swim",
  ],
  "sensory":[
    "strike", "defend", "accuracy", "reflex", "cunning", "balance", "climb", "exploration", "stealth", "prestidigitation"
  ],
  "mental":[
    "knowledge",
    "explore",
    "will",
    "insight",
    "cunning",
    "combustion",
    "eletromag",
    "radiation",
    "entropy",
    "biomancy",
    "telepathy",
    "animancy",
  ],
  "health":[
    "health"
  ]
}

export const SMArr = [-2,-1,0,1,2,3,4]
export const dmgArr = [0.5, 0.75, 1, 1.5, 2, 3, 4]
export const injuryMap = {t1: 1, t2: 5, t3: 10, t4: 20}
export const injuryDefaults = {injuryLevel: 0, wounds: [], hemorrhage: 0, potion:0, injuryThreshold: 10, unconsciousThreshold: 40, deathThreshold: 50}

export const CONVICTIONS = {
  adaptation: {
    id: 'adaptation',
    name: 'Adaptation',
    bonuses: {
      even: { charm: 1, stress: 1, will: 1 },
    },
  },
  domination: {
    id: 'domination',
    name: 'Domination',
    bonuses: {
      odd: { charm: 1, stress: 1, will: 1 },
    },
    bonusPerLevel: {},
  },
  stoicism: {
    id: 'stoicism',
    name: 'Stoicism',
    bonuses: {
      odd: { stress: 1, will: 1 },
    },
    bonusPerLevel: {},
  },
  fatalism: {
    id: 'fatalism',
    name: 'Fatalism',
    bonuses: {
      perLevel: { will: 1 },
    },
    bonusPerLevel: {},
  },
  ferocity: {
    id: 'ferocity',
    name: 'Ferocity',
    bonuses: {
      perLevel: { stress: 1 },
      odd: { will: 1 },
    },
    bonusPerLevel: {
      even: { will: 1 },
    },
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
    bonuses: {
      odd: { stress: 1, will: 1 },
    },
    bonusPerLevel: {},
  },
  hedonism: {
    id: 'hedonism',
    name: 'Hedonism',
    bonuses: {
      perLevel: { charm: 1 },
    },
    bonusPerLevel: {},
  },
}

export const AFFLICTIONS = {
  prone: { mobility: 0, controlable: true},
  grappled: { mobility: 0, controlable: true},
  immobile: { mobility: 0, controlable: true},
  limp: { mobility: 0, controlable: true},

  disoriented: { sensory: 2, controlable: true},
  oblivious: { sensory: 5, controlable: true},
  blind: { sensory: 0, controlable: true},
  deaf: { sensory: 0, controlable: true},

  fear: { mental: 1, controlable: true},
  rage: { mental: 1, controlable: true},
  confused: { mental: 3, controlable: true},
  // seduced: { controlable: true},
  distracted: { controlable: true},
  dominated: { controlable: true},
  
  weakened: { health: 1, controlable: true},
  malnourished: { health: 1, controlable: true},
  thirsty: { health: 1, controlable: true},
  dehydrated: { health: 1, controlable: true},
  tired: { mental: 1, controlable: true},
  exhausted: { mental: 2, controlable: true},
  sick: { health: 2, controlable: true},
}
