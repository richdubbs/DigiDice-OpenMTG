/**
 * WP21 acceptance scenarios (design 15.1 rule 4): cards whose abilities come from parseCard with the WP21 templates (no hand-written JSON) are cast and
 * resolved through the real engine (`applyAction`: announcement WP7, interpreter WP10, pipeline WP11, handlers WP14) or read through the layer system (WP9).
 * Doom Blade, Wrath of God, Raise the Alarm, Swords to Plowshares, a synthetic bounce spell, and the statics of Rancor and Bonesplitter.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, DecisionAnswer, GameState } from '../../../src/index';
import { getChars, hasKeyword } from '../../../src/index';
import { parseCard } from '../../../src/parser/parse';
import { getCard } from '../../fixtures';
import { drive, objectTarget } from '../announce/support';
import { act, find, passBoth, scenario, synth } from '../helpers';
import { withAbilities } from '../zones/support';
import { artifact, board, creature, enchantment, nth, tweak } from '../statics/fixtures';
import { card, fullyAutomated, NEIGHBORS, options } from './support';

const OPTS = options(NEIGHBORS);

/** The abilities parseCard gives the card (every one automated and through the render gate, or the test fails here). */
function parsed(c: Parameters<typeof parseCard>[0]): AbilityDef[] {
  const f = parseCard(c, OPTS).faces[0]!;
  expect(fullyAutomated(f), `${c.name}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
  return f.abilities;
}

const LANDS = ['Plains', 'Plains', 'Plains', 'Plains', 'Swamp', 'Swamp', 'Island', 'Island'];
const castAndResolve = (s: GameState, name: string, answers: DecisionAnswer[]): GameState => passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand') }), answers));
const onBattlefield = (s: GameState, name: string): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name).length;

const BOUNCE = synth({ name: 'Test Bounce', cost: '{U}', type: 'Instant', abilities: parsed(card('Test Bounce', 'Instant', "Return target nonwhite creature to its owner's hand.")) });

function game(): GameState {
  let s = scenario(['Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Swords to Plowshares', 'Grizzly Bears', 'Hill Giant', 'Plains', 'Swamp', 'Island'], {
    defs: [BOUNCE],
    p1: { hand: ['Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Swords to Plowshares', 'Test Bounce'], battlefield: [...LANDS, 'Hill Giant'] },
    p2: { battlefield: ['Grizzly Bears'] },
  });
  for (const name of ['Doom Blade', 'Wrath of God', 'Raise the Alarm', 'Swords to Plowshares']) s = withAbilities(s, name, parsed(getCard(name)));
  return s;
}

describe('WP21 parsed cards through the real engine', () => {
  it('CR 701.8a (Doom Blade): destroys the targeted creature', () => {
    const s = game();
    const t = castAndResolve(s, 'Doom Blade', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield', 'p2'))] }]);
    expect(onBattlefield(t, 'Grizzly Bears')).toBe(0);
  });

  it('CR 701.8a, 701.19c (Wrath of God): every creature is destroyed', () => {
    const t = castAndResolve(game(), 'Wrath of God', []);
    expect(onBattlefield(t, 'Grizzly Bears') + onBattlefield(t, 'Hill Giant')).toBe(0);
  });

  it('CR 111.1, 111.4 (Raise the Alarm): two 1/1 white Soldier creature tokens, each named "Soldier Token"', () => {
    const t = castAndResolve(game(), 'Raise the Alarm', []);
    const tokens = t.zones.battlefield.filter((id) => t.objects[id]!.kind === 'token');
    expect(tokens).toHaveLength(2);
    for (const id of tokens) {
      const ch = getChars(t, id);
      expect([ch.name, ch.power, ch.toughness, ch.colors, ch.subtypes]).toEqual(['Soldier Token', '1', '1', ['W'], ['Soldier']]);
    }
  });

  it('CR 701.13a, 608.2h (Swords to Plowshares): the creature is exiled and its controller gains life equal to its last known power', () => {
    const s = game();
    const giant = find(s, 'Hill Giant', 'battlefield', 'p1');
    const t = castAndResolve(s, 'Swords to Plowshares', [{ kind: 'chooseTargets', targets: [objectTarget(giant)] }]);
    expect(t.zones.exile.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Hill Giant')).toBe(true);
    expect(t.players.find((p) => p.id === 'p1')!.life).toBe(23);
  });

  it('CR 400.3, 400.7 (a parsed bounce spell): the creature goes to its owner\'s hand', () => {
    const s = game();
    const t = castAndResolve(s, 'Test Bounce', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield', 'p2'))] }]);
    expect(onBattlefield(t, 'Grizzly Bears')).toBe(0);
    expect(t.zones.hand['p2']!.some((id) => t.defs[t.objects[id]!.defId]!.name === 'Grizzly Bears')).toBe(true);
  });
});

describe('WP21 parsed statics through the layer system (CR 613)', () => {
  const bear = creature('Test Bear', '2', '2');

  it('CR 303.4, 613.4c, 613.1f (Rancor): the enchanted creature gets +2/+0 and trample; nothing else does', () => {
    // the parsed static alone: with its "Enchant creature" line an Aura put onto the board unattached would go to the graveyard (CR 704.5m)
    const rancor = enchantment('Test Rancor', '{G}', [parsed(getCard('Rancor')).find((a) => a.kind === 'static')!], 'Enchantment — Aura');
    let s = board([bear, rancor], ['Test Bear', 'Test Bear', 'Test Rancor']);
    const [b0, b1, r] = [nth(s, 'Test Bear', 0), nth(s, 'Test Bear', 1), nth(s, 'Test Rancor')];
    s = tweak(s, (t) => { t.objects[r]!.attachedTo = b0; });
    expect([getChars(s, b0).power, hasKeyword(getChars(s, b0), 'trample')]).toEqual(['4', true]);
    expect([getChars(s, b1).power, hasKeyword(getChars(s, b1), 'trample')]).toEqual(['2', false]);
  });

  it('CR 301.5, 613.4c (Bonesplitter): the equipped creature gets +2/+0', () => {
    const splitter = artifact('Test Splitter', '{1}', parsed(getCard('Bonesplitter')), 'Artifact — Equipment');
    let s = board([bear, splitter], ['Test Bear', 'Test Splitter']);
    const [b, e] = [nth(s, 'Test Bear'), nth(s, 'Test Splitter')];
    expect(getChars(s, b).power).toBe('2');
    s = tweak(s, (t) => { t.objects[e]!.attachedTo = b; });
    expect([getChars(s, b).power, getChars(s, b).toughness]).toEqual(['4', '2']);
  });
});
