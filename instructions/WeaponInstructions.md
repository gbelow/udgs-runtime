I have  a model of a weapon. I need you to take a list of latex entries and translate them into the model format.

"ShortSword": {
  "name": "ShortSword",
  "handed": "one",
  "penalty": 0,
  "scale": 3,
  "attacks": [
    {
      "type": "melee",
      "blunt": 8,
      "cut": 8,
      "STRmod": 0,
      "heavyMod": 0,
      "range": "short",
      "RES": 50,
      "RESmod": 0,
      "AP": 3,
      "reload": 0,
      "deflection": 0,
      "properties": "precise, draw",
      "handed": "one"
     },
  ]
}

transform energy of old models into blunt
create cut. it doesnt exist. delete SHP, it doesnt exist anymore
penalty is a positive number.
scale is always 3.
AP for melee weapons is always 3. For ranged ones it is explicit in the book. if they are a string, put the first value as ap and the second as reload, otherwise reload is 0.
deflection is always 0.
heavyMod is 0.5 when property heavy I is present, 1 when heavy 2 and 1.5 when heavy 3.
heavy now has ranges: heavy I - II means that basic attack is not available, only heavy I and heavy II.
StrMod exists when damage is STR or a multiple of it. When that happens, energy is 0 and StrMod is the multiple. Currently, not weapons are using this