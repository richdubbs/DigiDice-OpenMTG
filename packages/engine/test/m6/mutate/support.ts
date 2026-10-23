/**
 * Helpers of the M6-9 tests (m6 design 3.7, 5 "M6-9"): real fixture cards compiled by the default compiler (the game path), placed with the milestone 3
 * `scenario` helper and driven by real actions and answers. Synthetic cards are hand-built JSON of invented text (`equivalent`). Nothing is mocked.
 */
import type { AbilityDef, CardDef, DecisionAnswer, GameState, ObjectId, PlayerId } from '../../../src/index';
import { act, drive, equivalent, put, scenario, target, tweak } from '../dfc/support';

export { act, answer, drive, equivalent, find, looks, put, resolveTop, scenario, target, tweak } from '../dfc/support';

export const GEMRAZER = 'Gemrazer';
export const ELVES = 'Llanowar Elves';
export const BEARS = 'Grizzly Bears';
export const VANGUARD = 'Elite Vanguard';
export const LEYLINE = 'Leyline of the Void';

/** Put it on top / under (CR 702.140c). */
export const OVER: DecisionAnswer = { kind: 'chooseOption', ids: ['over'] };
export const UNDER: DecisionAnswer = { kind: 'chooseOption', ids: ['under'] };

/** "Whenever a creature enters, you gain 1 life." (an invented watcher, hand-built). */
export const ENTER_WATCH = equivalent({ name: 'Test Arrival Watcher', type_line: 'Enchantment' }, [{
  kind: 'triggered', text: 'Whenever a creature enters, you gain 1 life.', trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'] }, to: 'battlefield' }] },
  effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] },
} as AbilityDef]);

/** "Whenever a creature dies, you gain 10 life." / "Whenever a creature card is put into a graveyard from anywhere, you gain 1 life." */
export const DEATH_WATCH = equivalent({ name: 'Test Death Watcher', type_line: 'Enchantment' }, [{
  kind: 'triggered', text: 'Whenever a creature dies, you gain 10 life.', trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }] },
  effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 10 }] },
} as AbilityDef]);
export const GRAVE_WATCH = equivalent({ name: 'Test Grave Watcher', type_line: 'Enchantment' }, [{
  kind: 'triggered', text: 'Whenever a creature card is put into a graveyard from anywhere, you gain 1 life.',
  trigger: { on: [{ ev: 'zoneChange', subject: { isCard: true, types: ['Creature'] }, to: 'graveyard' }] },
  effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: 1 }] },
} as AbilityDef]);

/** "Destroy target creature." as a {0} instant (hand-built). */
export const DOOM = equivalent({ name: 'Test Doom', type_line: 'Instant', mana_cost: '{0}' }, [{
  kind: 'spell', text: 'Destroy target creature.',
  effect: { targets: [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 }], steps: [{ op: 'destroy', what: { ref: 'target', id: 't0' } }] },
} as AbilityDef]);

/** A game in p1's first main phase: three Forests, `field` on p1's battlefield, Gemrazer and `hand` in p1's hand, `theirs` on p2's battlefield. */
export function table(field: string[], opts: { hand?: string[]; theirs?: string[]; more?: string[]; defs?: CardDef[] } = {}): GameState {
  const names = [GEMRAZER, 'Forest', ...field, ...(opts.hand ?? []), ...(opts.theirs ?? []), ...(opts.more ?? [])].filter((n) => !(opts.defs ?? []).some((d) => d.name === n));
  return scenario(names, {
    p1: { battlefield: ['Forest', 'Forest', 'Forest', ...field], hand: [GEMRAZER, ...(opts.hand ?? [])] }, p2: { battlefield: opts.theirs ?? [] }, defs: opts.defs ?? [],
  });
}

/** Cast `name` from p1's hand for its mutate cost targeting `onto` (CR 702.140a): the spell is on the stack. */
export function mutate(s: GameState, onto: ObjectId, name = GEMRAZER, player: PlayerId = 'p1'): GameState {
  const card = s.zones.hand[player]!.find((id) => s.defs[s.objects[id]!.defId]!.name === name)!;
  return drive(act(s, { type: 'cast', player, card, method: 'mutate' }), [target(onto)]);
}

/** A token on p1's battlefield that is a copy of `name` (its definition is the card's: CR 111.1, 707.2). */
export function tokenOf(s: GameState, name: string, owner: PlayerId = 'p1'): { s: GameState; id: ObjectId } {
  let id = '';
  const t = tweak(s, (x) => {
    id = put(x, owner, 'battlefield', name);
    x.objects[id]!.kind = 'token';
    delete x.objects[id]!.cardId;
  });
  return { s: t, id };
}

/** "Exile target creature. Return that card to the battlefield under its owner's control." as a {0} instant (hand-built). */
export const BLINK = equivalent({ name: 'Test Blink', type_line: 'Instant', mana_cost: '{0}' }, [{
  kind: 'spell', text: "Exile target creature. Return that card to the battlefield under its owner's control.",
  effect: {
    targets: [{ id: 't0', kind: 'object', filter: { types: ['Creature'] }, text: 'target creature', min: 1, max: 1 }],
    steps: [
      { op: 'move', what: { ref: 'target', id: 't0' }, to: { zone: 'exile' }, as: 'gone' },
      { op: 'move', what: { ref: 'bound', name: 'gone' }, to: { zone: 'battlefield', controller: 'owner' } },
    ],
  },
} as AbilityDef]);
