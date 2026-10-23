/**
 * CMDF items 2 and 3 (Commander follow-ups): rule hooks that read the `commander` filter field ("commander spells you cast cost {1} less / have cascade",
 * CR 903.3d; `rfilter:commander`), "when you cast your commander" triggers (CR 903.3d, 903.3e), and "for each time you've cast your / a commander from the
 * command zone this game" (CR 903.8; the `commanderCasts` quantity, both wordings). Real fixture cards on the game path where Oracle has them (Flamekin
 * Herald, Jirina Kudro, Font of Magic, The Swarmlord, Captain Vargus Wrath, Jyoti), invented wordings otherwise (design 6.10); nothing is mocked.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, ENGINE_CAPABILITIES, getChars, legalActions, type CardDef, type GameState, type OracleCard } from '../../src/index';
import { compiledDefs } from '../fixtures';
import { drive } from '../m5/cr-examples/helpers';
import { scenario } from '../m5/helpers';
import { act, answerUntilPriority, commanderRec, commanderScenario, find, forests, inCommand, legend, lifeOf, pass, tweak, untappedForests } from '../m11/rules/helpers';

const def = (name: string): CardDef => compiledDefs([name])[0]!;
const synth = (name: string, cost: string, type: string, text: string, pt?: [string, string]): CardDef =>
  compileCard({ name, layout: 'normal', mana_cost: cost, type_line: type, oracle_text: text, colors: [], ...(pt ? { power: pt[0], toughness: pt[1] } : {}) } as unknown as OracleCard);
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"');

const TITANIA = legend('Test Titania', '{1}{G}', ['2', '2'], ['G']);
const BOB = legend('Test Bob Commander', '{G}', ['1', '1'], ['G']);
const BEAR = synth('Test Bear', '{1}{G}', 'Creature — Bear', '', ['2', '2']);
const DISCOUNT = synth('Test Commander Discount', '{G}', 'Enchantment', 'Commander spells you cast cost {1} less to cast.');
const HERALD_TRIGGER = synth('Test Herald Bell', '{G}', 'Enchantment', 'Whenever you cast your commander, you gain 2 life.');
const GROWTH = synth('Test Growth', '{2}{G}', 'Instant', 'You gain 1 life.');

const castFromCommand = (s: GameState, name: string): GameState => answerUntilPriority(act(s, { type: 'cast', player: 'p1', card: inCommand(s, name) }));
const castFromHand = (s: GameState, name: string): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }));
const castOnce = (s: GameState, name: string, n = 1): GameState => tweak(s, (t) => { commanderRec(t, 'p1', name).casts = n; });

describe('CMDF item 2: "commander spells you cast ..." in the rule hooks (CR 903.3d, 601.2f; rfilter:commander)', () => {
  it('rfilter:commander is a capability; "Commander spells you cast cost {1} less to cast." and Flamekin Herald are full', () => {
    expect(ENGINE_CAPABILITIES.has('rfilter:commander')).toBe(true);
    expect(full(DISCOUNT), JSON.stringify(DISCOUNT.automation)).toBe(true);
    expect(full(def('Flamekin Herald'))).toBe(true);
  });

  it('CR 903.3d, 601.2f: a commander spell cast from the command zone costs {1} less, the tax included; a noncommander spell does not', () => {
    let s = castOnce(commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [DISCOUNT, BEAR], p1: { battlefield: [...forests(6), 'Test Commander Discount'], hand: ['Test Bear'] } }), 'Test Titania');
    s = castFromCommand(s, 'Test Titania');
    expect(untappedForests(s, 'p1')).toBe(3); // {1}{G} + {2} tax - {1}
    s = pass(pass(s));
    s = castFromHand(s, 'Test Bear');
    expect(untappedForests(s, 'p1')).toBe(1); // {1}{G}: not a commander
  });

  it('CR 903.3: outside a Commander game no spell is a commander spell: nothing costs less', () => {
    let s = scenario(['Forest'], { p1: { battlefield: ['Forest', 'Forest', 'Test Commander Discount'], hand: ['Test Bear'] }, defs: [DISCOUNT, BEAR] });
    s = castFromHand(s, 'Test Bear');
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped)).toHaveLength(2);
  });

  it('CR 903.3d, 702.85a: Flamekin Herald: a commander spell has cascade (its cascade trigger goes on the stack); a noncommander spell has not', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Flamekin Herald'], defs: [BEAR], p1: { battlefield: [...forests(4), 'Flamekin Herald'], hand: ['Test Bear'] } });
    s = castFromCommand(s, 'Test Titania');
    const spell = s.zones.stack.find((id) => s.objects[id]!.defId === TITANIA.id)!;
    expect(getChars(s, spell).keywords.map((k) => k.keyword)).toContain('cascade');
    expect(s.zones.stack).toHaveLength(2); // the spell and its cascade trigger (CR 702.85a)
    s = drive(pass(pass(s))); // the cascade trigger resolves: the library is Forests, nothing to cast
    s = pass(pass(s)); // Titania resolves
    s = castFromHand(s, 'Test Bear');
    expect(s.zones.stack).toHaveLength(1);
    expect(getChars(s, s.zones.stack[0]!).keywords.map((k) => k.keyword)).not.toContain('cascade');
  });
});

describe('CMDF item 3: "when you cast your commander" (CR 903.3d, 903.3e)', () => {
  it('the trigger is full; it triggers on the cast of your commander from the command zone, and not on a noncommander spell', () => {
    expect(full(HERALD_TRIGGER), JSON.stringify(HERALD_TRIGGER.automation)).toBe(true);
    expect(JSON.stringify(HERALD_TRIGGER.faces[0]!.abilities[0])).toContain('"spell":{"commander":true,"owner":"you"}');
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [HERALD_TRIGGER, BEAR], p1: { battlefield: [...forests(4), 'Test Herald Bell'], hand: ['Test Bear'] } });
    s = castFromCommand(s, 'Test Titania');
    expect(s.zones.stack).toHaveLength(2);
    s = pass(pass(s));
    expect(lifeOf(s, 'p1')).toBe(42);
    s = pass(pass(s));
    s = castFromHand(s, 'Test Bear');
    expect(s.zones.stack).toHaveLength(1);
  });

  it('CR 903.3d: casting your commander from anywhere (here, its owner\'s hand) is casting your commander', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [HERALD_TRIGGER], p1: { battlefield: [...forests(2), 'Test Herald Bell'] } });
    s = tweak(s, (t) => {
      const id = t.zones.command.find((x) => t.objects[x]!.defId === TITANIA.id)!;
      t.zones.command = t.zones.command.filter((x) => x !== id);
      t.objects[id]!.zone = 'hand';
      t.zones.hand['p1']!.push(id);
    });
    s = castFromHand(s, 'Test Titania');
    expect(commanderRec(s, 'p1', 'Test Titania').casts).toBe(0); // not from the command zone: no tax and not counted (CR 903.8)
    expect(s.zones.stack).toHaveLength(2);
  });

  it('an opponent casting their commander does not trigger it ("you cast your commander")', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], defs: [HERALD_TRIGGER], p1: { battlefield: ['Test Herald Bell'] }, p2: { battlefield: forests(1) } });
    s = tweak(s, (t) => { t.turn.activePlayer = 'p2'; t.pending = { ...t.pending!, player: 'p2' }; });
    const cast = legalActions(s, 'p2').find((a) => a.kind === 'cast');
    expect(cast?.label).toBe('Cast Test Bob Commander from the command zone');
    s = answerUntilPriority(act(s, cast!.action));
    expect(s.zones.stack).toHaveLength(1);
  });
});

describe('CMDF item 3: "for each time you\'ve cast your / a commander from the command zone this game" (CR 903.8)', () => {
  it('the cards are full on the game path: Jirina Kudro, Jyoti, Moag Ancient, Captain Vargus Wrath, The Swarmlord, Font of Magic', () => {
    for (const n of ['Jirina Kudro', 'Jyoti, Moag Ancient', 'Captain Vargus Wrath', 'The Swarmlord', 'Font of Magic']) expect(full(def(n)), `${n}: ${JSON.stringify(def(n).automation)}`).toBe(true);
    for (const n of ['Jirina Kudro', 'Captain Vargus Wrath', 'Font of Magic', 'The Swarmlord']) expect(JSON.stringify(def(n).faces), n).toContain('"q":"commanderCasts"');
  });

  it('CR 903.8: Jirina Kudro ("a commander") creates one token for each cast of your commanders from the command zone', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Jirina Kudro', 'Mountain', 'Plains', 'Swamp'], p1: { battlefield: [...forests(1), 'Mountain', 'Plains', 'Swamp'], hand: ['Jirina Kudro'] } });
    s = castOnce(s, 'Test Titania', 2);
    s = castFromHand(s, 'Jirina Kudro');
    s = drive(pass(pass(s))); // Jirina resolves; its enters trigger goes on the stack
    s = drive(pass(pass(s)));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(2);
  });

  it('CR 903.8, 601.2f: Font of Magic: an instant costs {1} less for each cast of your commander from the command zone', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['Font of Magic'], defs: [GROWTH], p1: { battlefield: [...forests(3), 'Font of Magic'], hand: ['Test Growth'] } });
    s = castOnce(s, 'Test Titania', 2);
    s = castFromHand(s, 'Test Growth');
    expect(untappedForests(s, 'p1')).toBe(2); // {2}{G} - {2}
  });

  it('CR 903.8, 614.1c: The Swarmlord enters with two +1/+1 counters for each cast of your commander from the command zone', () => {
    let s = commanderScenario({ p1Commanders: [TITANIA], p2Commanders: [BOB], cards: ['The Swarmlord', 'Island', 'Mountain'], p1: { battlefield: [...forests(4), 'Island', 'Mountain'], hand: ['The Swarmlord'] } });
    s = castOnce(s, 'Test Titania', 2);
    s = castFromHand(s, 'The Swarmlord');
    s = drive(pass(pass(s)));
    expect(s.objects[find(s, 'The Swarmlord', 'battlefield')]!.counters['+1/+1']).toBe(4);
  });

  it('CR 903.8: outside a Commander game no commander was ever cast: Jirina creates nothing', () => {
    let s = scenario(['Jirina Kudro', 'Forest', 'Mountain', 'Plains', 'Swamp'], { p1: { battlefield: ['Forest', 'Mountain', 'Plains', 'Swamp'], hand: ['Jirina Kudro'] } });
    s = castFromHand(s, 'Jirina Kudro');
    s = drive(pass(pass(s)));
    s = drive(pass(pass(s)));
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.kind === 'token')).toHaveLength(0);
  });
});
