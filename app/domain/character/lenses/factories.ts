import { CampaignCharacter, Character, Lens, Resources, Trainable, Trainables } from "../../types";

// ---- composable core ----
// A Lens's default setter is always a plain, unmodified write to its own
// subject's field — inversion (writing through derived modifiers) is a
// concern layered on top by makeInvertingSetter, not a property of focusing.

function compose2<A, B, C>(outer: Lens<A, B>, inner: Lens<B, C>): Lens<A, C> {
  return {
    get: (a) => inner.get(outer.get(a)),
    set: (a, value) => outer.set(a, inner.set(outer.get(a), value)),
  };
}

export function composeLens<A, B, C>(l1: Lens<A, B>, l2: Lens<B, C>): Lens<A, C>;
export function composeLens<A, B, C, D>(l1: Lens<A, B>, l2: Lens<B, C>, l3: Lens<C, D>): Lens<A, D>;
export function composeLens<A, B, C, D, E>(l1: Lens<A, B>, l2: Lens<B, C>, l3: Lens<C, D>, l4: Lens<D, E>): Lens<A, E>;
export function composeLens<A, B, C, D, E>(
  l1: Lens<A, B>,
  l2: Lens<B, C>,
  l3?: Lens<C, D>,
  l4?: Lens<D, E>
): Lens<A, B> | Lens<A, C> | Lens<A, D> | Lens<A, E> {
  const l12 = compose2(l1, l2);
  if (!l3) return l12;
  const l123 = compose2(l12, l3);
  if (!l4) return l123;
  return compose2(l123, l4);
}

export function makePropLens<T, K extends keyof T>(key: K): Lens<T, T[K]> {
  return {
    get: (t) => t[key],
    set: (t, value) => ({ ...t, [key]: value }),
  };
}

export function makeResourceLens(keyName: keyof Resources): Lens<CampaignCharacter, number> {
  return composeLens(makePropLens<CampaignCharacter, 'resources'>('resources'), makePropLens<Resources, keyof Resources>(keyName));
}

export function makeInvertingSetter<T extends Character>(
  getter: (c: T) => number,
  readBase: (c: T) => number,
  writeBase: (c: T, base: number) => T,
): (subject: T, value: number) => T {
  return (subject: T, value: number): T => {
    const modifiers = getter(subject) - readBase(subject);
    return writeBase(subject, value - modifiers);
  };
}


type CreatureNumber = 'size' | 'height' | 'TGH'

export function makeInvertingLens<T extends Character> (
  propertyName: CreatureNumber,
  getter: (c: T) => number,
  setter?: (c: T, value: number) => T): Lens<T, number> {
  const baseLens = makePropLens<T, CreatureNumber>(propertyName);
  return {
    get: getter,
    set: setter ?? makeInvertingSetter(getter, baseLens.get, baseLens.set)
  };
}


export function makeTrainableValueLens<T extends Character>(
  trainableName: keyof Trainables,
  getter: (c: T) => number,
  setter?: (c: T, value: number) => T
): Lens<T, number> {
  const baseLens = composeLens(
    makePropLens<T, 'trainables'>('trainables'),
    makePropLens<Trainables, keyof Trainables>(trainableName),
    makePropLens<Trainable, 'value'>('value')
  );

  return {
    get: getter,
    set: setter ?? makeInvertingSetter(getter, baseLens.get, baseLens.set)
  };
}

export function makeTrainableNameLens<T extends Character>(
  trainableName: keyof Trainables
): Lens<T, string> {
  return composeLens(
    makePropLens<T, 'trainables'>('trainables'),
    makePropLens<Trainables, keyof Trainables>(trainableName),
    makePropLens<Trainable, 'name'>('name')
  );
}