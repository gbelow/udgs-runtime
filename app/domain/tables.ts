
export const SkillPenaltyTable = {
  "mobility":[
    ""
  ],
  "injury":[
    "will",
    "grapple",
    // "strength",
    "climb",
    "swim",
  ],
  "sensory":[
    "strike", 
    "defend", 
    "accuracy", 
    "reflex", 
    "detection", 
    "balance", 
    "climb", 
    "exploration", 
    "stealth", 
    "prestidigitation"
  ],
  "mental":[
    "knowledge",
    "explore",
    "will",
    "insight",
    "cunning",
  ],
  "health":[
    "health"
  ]
}

export const SMArr = [-2,-1,0,1,2,3,4]
export const dmgArr = [0.5, 0.75, 1, 1.5, 2, 3, 4]

export const injuryMap: Record<string, { IL: number; woundChance: number }> = {
  T0: { IL: 1, woundChance: 0 },
  T1: { IL: 5, woundChance: 0 },
  T2: { IL: 10, woundChance: 0.5 },
  T3: { IL: 20, woundChance: 1 },
  T4: { IL: 30, woundChance: 1 },
  T5: { IL: 50, woundChance: 1 },
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
  confused: { mental: 2, controlable: true},
  // seduced: { controlable: true},
  // distracted: { controlable: true},
  dominated: { controlable: true},
  
  weakened: { health: 1, controlable: true},
  malnourished: { health: 1, controlable: true},
  thirsty: { health: 1, controlable: true},
  dehydrated: { health: 1, controlable: true},
  tired: { mental: 1, controlable: true},
  exhausted: { mental: 1, controlable: true},
  sick: { health: 2, controlable: true},
}

export const magic_types = {
  alchemy: {proficiency: 'sorcery', skill: 'alchemy'},
  animancy: { proficiency: 'sorcery', skill: 'animancy'},
  biomancy: {proficiency: 'sorcery', skill: 'biomancy'},
  divine: {proficiency: 'sorcery', skill: 'devotion'},
  miracle: {proficiency: 'devotion', skill: 'devotion'},
}

export const knowledges_list = [
  'alchemy',
  'animancy',
  'biomancy',
  'architecture',
  'geography',
  'chemstry',
  'physics',
  'medicine',
  'smithing',
  'survival',
]


export const CONVICTIONS = {
  adaptation: {
    id: 'adaptation',
    name: 'Adaptation',
    
  },
  domination: {
    id: 'domination',
    name: 'Domination',
  },
  stoicism: {
    id: 'stoicism',
    name: 'Stoicism',
  },
  fatalism: {
    id: 'fatalism',
    name: 'Fatalism',
  },
  ferocity: {
    id: 'ferocity',
    name: 'Ferocity',
  },
  guardian: {
    id: 'guardian',
    name: 'Guardian',
  },
  hedonism: {
    id: 'hedonism',
    name: 'Hedonism',
  },
  providentialism: {
    id: 'providentialism',
    name: 'Providencialism',
  },
}

