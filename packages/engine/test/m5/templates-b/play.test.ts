/**
 * WP20 end to end: what the WP20 templates produce is played through the real engine (`applyAction`, the WP10 spine, the WP11 pipeline, the WP12/WP13
 * handlers), so a template that parses and renders correctly also DOES the right thing. Card definitions get their abilities from `parseCard` with the
 * bootstrap + WP20 templates (and the test-only neighbors of ./support.ts), never from hand-written JSON. Synthetic cards use invented wordings
 * (design 6.10); the fixture cards are the golden cards of the package.
 */
import { describe, expect, it } from 'vitest';
import { parseCard } from '../../../src/parser/parse';
import type { CardDef, DecisionAnswer, GameState, OracleCard } from '../../../src/index';
import { clone } from '../../../src/util/clone';
import { getCard } from '../../fixtures';
import { drive, objectTarget, playerTarget } from '../announce/support';
import { act, answer, find, inGraveyard, legal, lifeOf, onBattlefield, passBoth, pool, scenario, synth } from '../helpers';
import { NEIGHBORS, automated, options } from './support';

const opts = options(NEIGHBORS);

/** Every face's abilities, from the parser; the card must be fully automated. */
function parsed(card: OracleCard): CardDef['faces'][number]['abilities'][] {
  const faces = parseCard(card, opts).faces;
  for (const f of faces) expect(automated(f.abilities), `${card.name}: ${JSON.stringify(f.abilities)}`).toBe(true);
  return faces.map((f) => f.abilities);
}

/** Replace the abilities of a fixture card's definition by the parser's (test setup only). */
function withParsed(s: GameState, card: OracleCard): GameState {
  const t = clone(s);
  const abilities = parsed(card);
  const id = Object.keys(t.defs).find((k) => t.defs[k]!.name === card.name)!;
  const def = t.defs[id]!;
  t.defs = { ...t.defs, [id]: { ...def, faces: def.faces.map((f, i) => ({ ...f, abilities: abilities[i] ?? f.abilities })) } };
  return t;
}

/** A synthetic card whose abilities come from parsing `text`. */
function card(name: string, type: string, cost: string, text: string): CardDef {
  const [abilities] = parsed({ name, layout: 'normal', type_line: type, mana_cost: cost, oracle_text: text } as OracleCard);
  return synth({ name, cost, type, abilities: abilities! });
}

const cast = (s: GameState, name: string, answers: DecisionAnswer[], face?: number): GameState =>
  passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand'), ...(face !== undefined ? { face } : {}) }), answers));

const handOf = (s: GameState, p: string): number => s.zones.hand[p]!.length;
const libraryOf = (s: GameState, p: string): number => s.zones.library[p]!.length;

describe('WP20 damage templates played (CR 120, 601.2d, 608.2b)', () => {
  const board = (): GameState => withParsed(withParsed(scenario(['Fireball', 'Fire // Ice', 'Mountain', 'Grizzly Bears', 'Hill Giant'], {
    p1: { hand: ['Fireball', 'Fire // Ice'], battlefield: Array(6).fill('Mountain') },
    p2: { battlefield: ['Grizzly Bears', 'Hill Giant'] },
  }), getCard('Fireball')), getCard('Fire // Ice'));

  it('CR 601.2d: Fire (eff.damage.divided) divides 2 damage 1 and 1 between a creature and a player as announced', () => {
    const s = board();
    const t = cast(s, 'Fire // Ice', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield')), playerTarget('p2')] }, { kind: 'chooseDivision', amounts: [1, 1] }], 0);
    expect(t.objects[find(t, 'Hill Giant', 'battlefield')]!.damage).toBe(1);
    expect(lifeOf(t, 'p2')).toBe(19);
  });

  it('CR 107.1a, 608.2b: Fireball (eff.damage.evenly.down) X = 4 at a creature and a player: 2 each', () => {
    const s = board();
    const t = cast(s, 'Fireball', [{ kind: 'chooseNumber', n: 4 }, { kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield')), playerTarget('p2')] }]);
    expect(onBattlefield(t, 'Grizzly Bears')).toBe(false);
    expect(lifeOf(t, 'p2')).toBe(18);
  });

  it('CR 120.3, 608.2h: subject-led damage (eff.damage.equal): the creature deals damage equal to its power, the spell deals none', () => {
    const bite = card('Example Bite', 'Sorcery', '{1}{G}', 'Target Giant you control deals damage equal to its power to target creature an opponent controls.');
    const s = scenario(['Forest', 'Hill Giant', 'Grizzly Bears'], { p1: { hand: ['Example Bite'], battlefield: ['Forest', 'Forest', 'Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [bite] });
    const t = cast(s, 'Example Bite', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield'))] }, { kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    expect(inGraveyard(t, 'Grizzly Bears', 'p2')).toBe(true);
    expect(t.objects[find(t, 'Hill Giant', 'battlefield')]!.damage).toBe(0); // one-sided: not a fight
  });

  it('CR 701.14a: fight (eff.fight): each creature deals damage equal to its power to the other', () => {
    const brawl = card('Example Brawl', 'Sorcery', '{G}', 'Target creature you control fights target creature you don\'t control.');
    const s = scenario(['Forest', 'Hill Giant', 'Grizzly Bears'], { p1: { hand: ['Example Brawl'], battlefield: ['Forest', 'Hill Giant'] }, p2: { battlefield: ['Grizzly Bears'] }, defs: [brawl] });
    const t = cast(s, 'Example Brawl', [{ kind: 'chooseTargets', targets: [objectTarget(find(s, 'Hill Giant', 'battlefield'))] }, { kind: 'chooseTargets', targets: [objectTarget(find(s, 'Grizzly Bears', 'battlefield'))] }]);
    expect(inGraveyard(t, 'Grizzly Bears', 'p2')).toBe(true);
    expect(t.objects[find(t, 'Hill Giant', 'battlefield')]!.damage).toBe(2);
  });
});

describe('WP20 life and card templates played (CR 119, 121, 701.9, 701.17, 700.3)', () => {
  it('CR 119.3: "Each opponent loses 3 life and you gain 3 life." (eff.loselife, eff.gainlife)', () => {
    const drain = card('Example Drain', 'Sorcery', '{B}', 'Each opponent loses 3 life and you gain 3 life.');
    const s = scenario(['Swamp'], { p1: { hand: ['Example Drain'], battlefield: ['Swamp'] }, defs: [drain] });
    const t = cast(s, 'Example Drain', []);
    expect([lifeOf(t, 'p1'), lifeOf(t, 'p2')]).toEqual([23, 17]);
  });

  it('CR 119.5: "Target player\'s life total becomes 7." (eff.setlife): the player loses the difference', () => {
    const reset = card('Example Reset', 'Sorcery', '{W}', "Target player's life total becomes 7.");
    const s = scenario(['Plains'], { p1: { hand: ['Example Reset'], battlefield: ['Plains'] }, defs: [reset] });
    const t = cast(s, 'Example Reset', [{ kind: 'chooseTargets', targets: [playerTarget('p2')] }]);
    expect(lifeOf(t, 'p2')).toBe(7);
  });

  it('CR 701.17a: Jace Beleren -10 (eff.mill): target player mills twenty cards', () => {
    const s0 = withParsed(scenario(['Jace Beleren'], { p1: { battlefield: [{ name: 'Jace Beleren', counters: { loyalty: 10 } }] } }), getCard('Jace Beleren'));
    const jace = find(s0, 'Jace Beleren', 'battlefield');
    const before = libraryOf(s0, 'p2');
    const t = passBoth(drive(act(s0, { type: 'activate', player: 'p1', source: jace, ability: 'p:0:2' }), [{ kind: 'chooseTargets', targets: [playerTarget('p2')] }]));
    expect(libraryOf(t, 'p2')).toBe(before - 20);
    expect(t.zones.graveyard.p2!.length).toBe(20);
  });

  it('CR 701.9a, 121.2: "Draw four cards, then discard a card." (bootstrap draw, eff.discard.you)', () => {
    const loot = card('Example Loot', 'Sorcery', '{U}', 'Draw four cards, then discard a card.');
    const s = scenario(['Island'], { p1: { hand: ['Example Loot'], battlefield: ['Island'] }, defs: [loot] });
    let t = passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Example Loot', 'hand') }), []));
    expect(t.pending?.kind).toBe('chooseObjects'); // the discard choice (CR 701.9b)
    t = answer(t, { kind: 'chooseObjects', ids: [t.zones.hand.p1![0]!] });
    expect(handOf(t, 'p1')).toBe(3);
    expect(t.zones.graveyard.p1!.length).toBe(2); // the discarded card and the sorcery
  });

  it('CR 700.3, 608.2d: a Fact or Fiction-like spell (eff.reveal.top, eff.piles, eff.piles.handgrave): the opponent separates, the caster picks a pile', () => {
    const insight = card('Example Insight', 'Instant', '{U}', 'Reveal the top four cards of your library. An opponent separates those cards into two piles. Put one pile into your hand and the other into your graveyard.');
    const s = scenario(['Island'], { p1: { hand: ['Example Insight'], battlefield: ['Island'] }, defs: [insight] });
    const top = s.zones.library.p1!.slice(0, 4);
    let t = passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Example Insight', 'hand') }), []));
    expect(t.pending).toMatchObject({ kind: 'chooseObjects', player: 'p2' });
    t = answer(t, { kind: 'chooseObjects', ids: top.slice(0, 1) });
    expect(t.pending).toMatchObject({ kind: 'chooseOption', player: 'p1' });
    t = answer(t, { kind: 'chooseOption', ids: ['pile2'] }); // the pile of three
    t = drive(t, []);
    expect(handOf(t, 'p1')).toBe(3);
    expect(t.zones.graveyard.p1!.length).toBe(2); // the pile of one and the instant
  });
});

describe('WP20 mana templates played (CR 106.6, 605.1a)', () => {
  // an invented land: "{T}: Add {C}{C}. Spend this mana only to cast a creature spell." (eff.mana.C2 + rid.mana.creature)
  const grotto = (): CardDef => card('Example Grotto', 'Land', '', '{T}: Add {C}{C}. Spend this mana only to cast a creature spell.');

  it('CR 106.6: the restricted mana pays for a creature spell', () => {
    const golem = synth({ name: 'Example Golem', cost: '{2}', type: 'Artifact Creature — Golem', pt: ['2', '2'], abilities: [] });
    const s = scenario([], { p1: { hand: ['Example Golem'], battlefield: ['Example Grotto'] }, defs: [grotto(), golem] });
    expect(legal(s, 'p1', 'cast').map((a) => a.label).join(' ')).toMatch(/Example Golem/);
    const t = passBoth(drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Example Golem', 'hand') }), []));
    expect(onBattlefield(t, 'Example Golem', 'p1')).toBe(true);
  });

  it('CR 106.6: the restricted mana cannot pay for a noncreature spell of the same cost (it is not castable)', () => {
    const idol = synth({ name: 'Example Idol', cost: '{2}', type: 'Artifact', abilities: [] });
    const s = scenario([], { p1: { hand: ['Example Idol'], battlefield: ['Example Grotto'] }, defs: [grotto(), idol] });
    expect(legal(s, 'p1', 'cast').some((a) => /Example Idol/.test(a.label))).toBe(false);
  });

  it('CR 106.1a, 605.3b: "{T}: Add two mana in any combination of colors." (eff.mana.any2) adds two units, each of a color chosen on activation', () => {
    const prism = card('Example Prism', 'Artifact', '{4}', '{T}: Add two mana in any combination of colors.');
    const s = scenario([], { p1: { battlefield: ['Example Prism'] }, defs: [prism] });
    let t = act(s, { type: 'activate', player: 'p1', source: find(s, 'Example Prism', 'battlefield'), ability: 'p:0:0' });
    for (const color of ['G', 'U'] as const) { expect(t.pending?.kind).toBe('chooseColor'); t = answer(t, { kind: 'chooseColor', color }); }
    expect(pool(t, 'p1')).toBe('GU');
  });
});
