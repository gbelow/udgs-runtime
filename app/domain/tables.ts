
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
