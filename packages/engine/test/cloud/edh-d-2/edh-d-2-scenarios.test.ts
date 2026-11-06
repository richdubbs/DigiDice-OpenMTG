/**
 * Commander lane edh-d, round edh-d-2 (EDHREC ranks 11,251-12,500): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Each group has its negative cases. CR cites are from the Comprehensive Rules text of 2026-09-25 (media.wizards.com), fetched in the session.
 *
 *   CR 701.23a-b, 404.1, 608.2c   "Search target opponent's library for up to three creature cards and put them into their graveyard. Then that player shuffles."
 *   CR 118.8, 601.2b, 601.2f      "As an additional cost to cast this spell, you may sacrifice any number of creatures / exile any number of creature cards from your graveyard. ... costs {2} less ..."
 *   CR 103.4, 107.1a, 119.5       "up to one target player's life total becomes half their starting life total, rounded down."
 *   CR 701.17a-c, 608.2c-d, 110.2 "Mill four cards. You may put a permanent card from among them onto the battlefield."
 *   CR 701.20a, 402.3, 608.2c-d   "You may reveal your hand and put all land cards from it onto the battlefield. If you do, discard your hand."
 *   CR 602.2b, 400.3, 608.2c      "Remove three +1/+1 counters from this creature: Return it to its owner's hand."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type OracleCard, type TargetChoice } from '../../../src/index';
import { act, answer, find, life, scenario } from '../../m3/scenario';
import { cast, resolveAll } from '../cmd3/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as OracleCard);
}
const full = (d: CardDef): boolean => d.automation.level === 'full';
const castable = (s: GameState, player: 'p1' | 'p2', name: string): boolean => legalActions(s, player).some((l) => l.kind === 'cast' && l.object === find(s, name, 'hand', player));
const names = (s: GameState, zone: 'hand' | 'graveyard' | 'library', p: string): string[] => (s.zones[zone][p] ?? []).map((id) => s.objects[id]!.defId).sort();
const battlefieldOf = (s: GameState, p: string): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId).sort();

/** Answer every decision but priority from the script: a number for a count, the first options (or `pick`) for objects, automatic payment, the given targets. */
function drive(s0: GameState, o: { numbers?: number[]; pick?: (opts: string[]) => string[]; targets?: TargetChoice[]; yes?: boolean } = {}): GameState {
  let s = s0;
  const numbers = [...(o.numbers ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: numbers.shift() ?? p.min });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: o.pick ? o.pick(p.options) : p.options.slice(0, p.min) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: o.targets ?? [] });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
const castDriven = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState => drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o);
/** Cast, then let both players pass until the stack is empty, answering what is asked. */
function castAndResolve(s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = castDriven(s0, name, o);
  for (let guard = 0; guard < 12 && s.zones.stack.length > 0 && !s.result; guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }), o);
  return s;
}
void cast;
void resolveAll;

describe('CR 701.23a-b, 404.1, 608.2c: "Search target opponent\'s library for up to three creature cards and put them into their graveyard."', () => {
  const FINALE = card('Test Dust Purge', 'Sorcery', "Destroy all creatures, then search target opponent's library for up to three creature cards and put them into their graveyard. Then that player shuffles.");
  const SEEK = card('Test Echo Seeker', 'Sorcery', "Search target player's library for up to three cards with flashback and put them into that player's graveyard. Then the player shuffles.");
  const OGRE = card('Test Dune Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const BIRD = card('Test Dune Bird', 'Creature — Bird', '', { pt: ['1', '1'] });
  const ECHO = card('Test Echo Spell', 'Sorcery', 'Draw a card.\nFlashback {2}{R}');
  const PLAIN = card('Test Plain Spell', 'Sorcery', 'Draw a card.');
  const DEFS = [FINALE, SEEK, OGRE, BIRD, ECHO, PLAIN];
  const game = (): GameState => scenario(['Plains'], {
    defs: DEFS,
    p1: { hand: ['Test Dust Purge', 'Test Echo Seeker'], battlefield: ['Test Dune Bird'], library: ['Test Dune Ogre', 'Test Echo Spell'] },
    p2: { library: ['Test Dune Ogre', 'Test Dune Ogre', 'Test Dune Bird', 'Test Dune Bird', 'Test Plain Spell', 'Test Echo Spell', 'Test Echo Spell', 'Test Echo Spell', 'Test Echo Spell'], battlefield: ['Test Dune Ogre'] },
  });
  const P2: TargetChoice[] = [{ kind: 'player', id: 'p2' }];
  it('the synthetic cards are automated', () => {
    expect(full(FINALE)).toBe(true);
    expect(full(SEEK)).toBe(true);
  });
  it('destroys every creature, then puts up to three creature cards of the opponent\'s library into THEIR graveyard; only creature cards are offered and the caster\'s graveyard gets none', () => {
    let offered: string[] = [];
    const lib0 = game().zones.library['p2']!.length;
    const lib1 = game().zones.library['p1']!.length;
    const s = castAndResolve(game(), 'Test Dust Purge', { targets: P2, pick: (opts) => { offered = opts.map((id) => id); return opts.slice(0, 3); } });
    expect(offered).toHaveLength(4); // the four creature cards of p2's library; the Plain Spell and the Echo Spells are not offered
    expect(names(s, 'graveyard', 'p2').filter((n) => n === 'Test Dune Ogre' || n === 'Test Dune Bird')).toHaveLength(4); // the destroyed Ogre and the 3 found
    expect(names(s, 'graveyard', 'p2')).toHaveLength(4);
    expect(names(s, 'library', 'p2')).toHaveLength(lib0 - 3);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Dune Bird', 'Test Dust Purge']); // the caster's Bird and the spell: nothing found goes to the caster's graveyard
    expect(names(s, 'library', 'p1')).toHaveLength(lib1); // the caster's own library is never searched
    expect(battlefieldOf(s, 'p1').concat(battlefieldOf(s, 'p2')).filter((n) => n.startsWith('Test Dune'))).toEqual([]);
  });
  it('negative: choosing none moves nothing (up to three, CR 701.23b)', () => {
    const lib0 = game().zones.library['p2']!.length;
    const s = castAndResolve(game(), 'Test Dust Purge', { targets: P2, pick: () => [] });
    expect(names(s, 'library', 'p2')).toHaveLength(lib0);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Dune Ogre']); // only the destroyed Ogre
  });
  it('"cards with flashback": only the cards with that keyword are offered, and they go to the target player\'s graveyard', () => {
    let offered: string[] = [];
    const lib0 = game().zones.library['p2']!.length;
    const lib1 = game().zones.library['p1']!.length;
    const s = castAndResolve(game(), 'Test Echo Seeker', { targets: P2, pick: (opts) => { offered = opts; return opts.slice(0, 3); } });
    expect(offered).toHaveLength(4);
    expect(names(s, 'graveyard', 'p2')).toEqual(['Test Echo Spell', 'Test Echo Spell', 'Test Echo Spell']);
    expect(names(s, 'library', 'p2')).toHaveLength(lib0 - 3);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Echo Seeker']);
    expect(names(s, 'library', 'p1')).toHaveLength(lib1);
  });
  it('"cards with flashback" targeting yourself searches your own library', () => {
    const lib0 = game().zones.library['p2']!.length;
    const s = castAndResolve(game(), 'Test Echo Seeker', { targets: [{ kind: 'player', id: 'p1' }], pick: (opts) => opts.slice(0, 3) });
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Echo Seeker', 'Test Echo Spell']);
    expect(names(s, 'library', 'p2')).toHaveLength(lib0);
  });
});

describe('CR 118.8, 601.2b, 601.2f: "As an additional cost to cast this spell, you may sacrifice any number of creatures. This spell costs {2} less to cast for each creature sacrificed this way."', () => {
  const TYRANT = card('Test Hunger Tyrant', 'Creature — Avatar', "As an additional cost to cast this spell, you may sacrifice any number of creatures. This spell costs {2} less to cast for each creature sacrificed this way.\nWhen this creature enters, up to one target player's life total becomes half their starting life total, rounded down.", { cost: '{4}{B}', pt: ['5', '5'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DEFS = [TYRANT, BEAR];
  const game = (mine: number, theirs = 0): GameState => scenario(['Swamp'], {
    defs: DEFS, life: 40,
    p1: { hand: ['Test Hunger Tyrant'], battlefield: ['Swamp', ...Array<string>(mine).fill('Test Bear')] },
    p2: { battlefield: Array<string>(theirs).fill('Test Bear') },
  });
  it('the synthetic card is automated', () => {
    expect(full(TYRANT)).toBe(true);
  });
  it('two creatures sacrificed take {4} off {4}{B}: one Swamp pays the rest; the sacrificed creatures are gone', () => {
    const s = castDriven(game(2), 'Test Hunger Tyrant', { numbers: [2] });
    expect(s.zones.stack).toHaveLength(1);
    expect(battlefieldOf(s, 'p1')).toEqual(['Swamp']);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Bear', 'Test Bear']);
  });
  it('one creature is not enough for one Swamp ({2}{B} left): a number that leaves the cost unpayable is refused', () => {
    expect(() => castDriven(game(2), 'Test Hunger Tyrant', { numbers: [1] })).toThrow();
  });
  it('negative: with no creature of your own (the opponent\'s are not yours to sacrifice) the cost stays {4}{B}', () => {
    expect(castable(game(0, 3), 'p1', 'Test Hunger Tyrant')).toBe(false);
    expect(castable(game(2), 'p1', 'Test Hunger Tyrant')).toBe(true);
  });
  it('negative: the cost is only reduced for creatures sacrificed (announcing 0 pays {4}{B} in full)', () => {
    const s = scenario(['Swamp'], { defs: DEFS, life: 40, p1: { hand: ['Test Hunger Tyrant'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp', 'Swamp', 'Test Bear'] } });
    const t = castDriven(s, 'Test Hunger Tyrant', { numbers: [0] });
    expect(t.zones.stack).toHaveLength(1);
    expect(battlefieldOf(t, 'p1').filter((n) => n === 'Test Bear')).toHaveLength(1);
    expect(t.zones.battlefield.filter((id) => t.objects[id]!.defId === 'Swamp' && t.objects[id]!.tapped)).toHaveLength(5);
  });
  it('CR 103.4, 107.1a, 119.5: when it enters, the target player\'s life total becomes half the starting life total (20 of 40), whatever it was', () => {
    let s = castAndResolve(game(2), 'Test Hunger Tyrant', { numbers: [2], targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(20);
    expect(life(s, 'p1')).toBe(40);
    s = game(2);
    s = { ...s, players: s.players.map((p) => (p.id === 'p2' ? { ...p, life: 7 } : p)) };
    s = castAndResolve(s, 'Test Hunger Tyrant', { numbers: [2], targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(20); // set, not lowered (CR 119.5)
  });
  it('negative: "up to one" - choosing no player changes nobody\'s life', () => {
    const s = castAndResolve(game(2), 'Test Hunger Tyrant', { numbers: [2], targets: [] });
    expect(life(s, 'p1')).toBe(40);
    expect(life(s, 'p2')).toBe(40);
  });
  it('the half of an odd starting life total is rounded down (21 of 41... 2 players of a 25-life game: 12)', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, life: 25, p1: { hand: ['Test Hunger Tyrant'], battlefield: ['Swamp', 'Test Bear', 'Test Bear'] } });
    const s = castAndResolve(s0, 'Test Hunger Tyrant', { numbers: [2], targets: [{ kind: 'player', id: 'p2' }] });
    expect(life(s, 'p2')).toBe(12);
  });
});

describe('CR 118.8, 601.2b, 601.2f, 406.1: "As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard. This spell costs {2} less to cast for each card exiled this way."', () => {
  const GOREX = card('Test Grave Tyrant', 'Creature — Zombie', 'As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard. This spell costs {2} less to cast for each card exiled this way.', { cost: '{4}{B}', pt: ['3', '3'] });
  const OGRE = card('Test Dune Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const PLAIN = card('Test Plain Spell', 'Sorcery', 'Draw a card.');
  const DEFS = [GOREX, OGRE, PLAIN];
  const exiled = (s: GameState): string[] => s.zones.exile.map((id) => s.objects[id]!.defId).sort();
  it('the synthetic card is automated', () => {
    expect(full(GOREX)).toBe(true);
  });
  it('two creature cards exiled from your graveyard take {4} off {4}{B}; a noncreature card stays', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Grave Tyrant'], battlefield: ['Swamp'], graveyard: ['Test Dune Ogre', 'Test Plain Spell', 'Test Dune Ogre'] } });
    expect(castable(s0, 'p1', 'Test Grave Tyrant')).toBe(true);
    const s = castDriven(s0, 'Test Grave Tyrant', { numbers: [2], pick: (opts) => opts.filter((id) => s0.objects[id]!.defId === 'Test Dune Ogre') });
    expect(s.zones.stack).toHaveLength(1);
    expect(exiled(s)).toEqual(['Test Dune Ogre', 'Test Dune Ogre']);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Plain Spell']);
  });
  it('negative: a noncreature card cannot be exiled for it, so one Swamp does not pay {4}{B}', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Grave Tyrant'], battlefield: ['Swamp'], graveyard: ['Test Plain Spell', 'Test Plain Spell'] } });
    expect(castable(s0, 'p1', 'Test Grave Tyrant')).toBe(false);
  });
  it('CR 607.2a, 608.2d: "Whenever ~ attacks or dies, choose a card at random exiled with ~ and put that card into its owner\'s hand": only a card the cost exiled, and it goes to its owner\'s hand', () => {
    const TYRANT = card('Test Grave Warden', 'Creature — Zombie', "As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard. This spell costs {2} less to cast for each card exiled this way.\nWhenever this creature attacks or dies, choose a card at random exiled with this creature and put that card into its owner's hand.", { cost: '{4}{B}', pt: ['3', '3'] });
    const SMITE = card('Test Smite', 'Instant', 'Destroy target creature.');
    expect(full(TYRANT)).toBe(true);
    const s0 = scenario(['Swamp'], { defs: [TYRANT, SMITE, OGRE, PLAIN], p1: { hand: ['Test Grave Warden', 'Test Smite'], battlefield: ['Swamp'], graveyard: ['Test Dune Ogre', 'Test Dune Ogre'], exile: ['Test Plain Spell'] } });
    let s = castDriven(s0, 'Test Grave Warden', { numbers: [2], pick: (opts) => opts.filter((id) => s0.objects[id]!.defId === 'Test Dune Ogre') });
    for (let i = 0; i < 6 && s.zones.stack.length > 0; i++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    expect(battlefieldOf(s, 'p1')).toEqual(['Swamp', 'Test Grave Warden']);
    const warden = find(s, 'Test Grave Warden', 'battlefield', 'p1');
    s = castAndResolve(s, 'Test Smite', { targets: [{ kind: 'object', id: warden }] });
    expect(names(s, 'hand', 'p1')).toEqual(['Test Dune Ogre']); // one of the two cards the cost exiled, not the Plain Spell exiled otherwise
    expect(s.zones.exile.map((id) => s.objects[id]!.defId).sort()).toEqual(['Test Dune Ogre', 'Test Plain Spell']);
  });
  it('negative: the opponent\'s graveyard is not yours to exile from', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Grave Tyrant'], battlefield: ['Swamp'] }, p2: { graveyard: ['Test Dune Ogre', 'Test Dune Ogre'] } });
    expect(castable(s0, 'p1', 'Test Grave Tyrant')).toBe(false);
  });
});

describe('CR 701.17a-c, 608.2c-d, 110.2: "Mill four cards. You may put a permanent card from among them onto the battlefield."', () => {
  const RITE = card('Test Delve Rite', 'Sorcery', 'Mill four cards. You may put a permanent card from among them onto the battlefield.');
  const OGRE = card('Test Dune Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const PLAIN = card('Test Plain Spell', 'Sorcery', 'Draw a card.');
  const DEFS = [RITE, OGRE, PLAIN];
  const game = (library: string[]): GameState => scenario(['Plains'], { defs: DEFS, p1: { hand: ['Test Delve Rite'], library: [...library, 'Plains', 'Plains'] } });
  it('the synthetic card is automated', () => {
    expect(full(RITE)).toBe(true);
  });
  it('mills four, offers only permanent cards among the four milled, and puts the chosen one onto the battlefield under your control', () => {
    let offered: string[] = [];
    const s0 = game(['Test Plain Spell', 'Test Dune Ogre', 'Test Plain Spell', 'Test Dune Ogre']);
    const s = castAndResolve(s0, 'Test Delve Rite', { pick: (opts) => { offered = opts; return opts.slice(0, 1); } });
    expect(offered).toHaveLength(2); // the two Ogres, not the Plain Spells
    expect(battlefieldOf(s, 'p1')).toEqual(['Test Dune Ogre']);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Delve Rite', 'Test Dune Ogre', 'Test Plain Spell', 'Test Plain Spell']);
    expect(names(s, 'library', 'p1')).toHaveLength(s0.zones.library['p1']!.length - 4);
  });
  it('negative: a permanent card in the library below the four milled is not offered, and choosing none leaves all four in the graveyard', () => {
    let offered = -1;
    const s = castAndResolve(game(['Test Plain Spell', 'Test Plain Spell', 'Test Dune Ogre', 'Test Plain Spell', 'Test Dune Ogre']), 'Test Delve Rite', { pick: (opts) => { offered = opts.length; return []; } });
    expect(offered).toBe(1);
    expect(battlefieldOf(s, 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Delve Rite', 'Test Dune Ogre', 'Test Plain Spell', 'Test Plain Spell', 'Test Plain Spell']);
  });
  it('negative: with no permanent card among the four milled nothing enters', () => {
    const s = castAndResolve(game(['Test Plain Spell', 'Test Plain Spell', 'Test Plain Spell', 'Test Plain Spell']), 'Test Delve Rite', { pick: (opts) => opts.slice(0, 1) });
    expect(battlefieldOf(s, 'p1')).toEqual([]);
  });
});

describe('CR 701.20a, 402.3, 608.2c-d, 400.3: "You may reveal your hand and put all land cards from it onto the battlefield. If you do, discard your hand."', () => {
  const RITE = card('Test Land Rite', 'Sorcery', 'You may reveal your hand and put all land cards from it onto the battlefield. If you do, discard your hand.');
  const OGRE = card('Test Dune Ogre', 'Creature — Ogre', '', { pt: ['2', '2'] });
  const PLAIN = card('Test Plain Spell', 'Sorcery', 'Draw a card.');
  const DEFS = [RITE, OGRE, PLAIN];
  const game = (): GameState => scenario(['Plains', 'Island'], { defs: DEFS, p1: { hand: ['Test Land Rite', 'Plains', 'Island', 'Test Plain Spell', 'Test Dune Ogre'] }, p2: { hand: ['Plains', 'Test Plain Spell'] } });
  it('the synthetic card is automated', () => {
    expect(full(RITE)).toBe(true);
  });
  it('puts every land card of your hand onto the battlefield, then discards the rest of the hand; the opponent\'s hand is untouched', () => {
    const s = castAndResolve(game(), 'Test Land Rite', { yes: true });
    expect(battlefieldOf(s, 'p1')).toEqual(['Island', 'Plains']);
    expect(names(s, 'hand', 'p1')).toEqual([]);
    expect(names(s, 'graveyard', 'p1')).toEqual(['Test Dune Ogre', 'Test Land Rite', 'Test Plain Spell']);
    expect(names(s, 'hand', 'p2')).toEqual(['Plains', 'Test Plain Spell']);
  });
  it('negative: answering no puts nothing onto the battlefield and discards nothing', () => {
    const s = castAndResolve(game(), 'Test Land Rite', { yes: false });
    expect(battlefieldOf(s, 'p1')).toEqual([]);
    expect(names(s, 'hand', 'p1')).toEqual(['Island', 'Plains', 'Test Dune Ogre', 'Test Plain Spell']);
  });
});

describe('CR 602.2b, 400.3, 608.2c: "Remove three +1/+1 counters from this creature: Return it to its owner\'s hand."', () => {
  const OOZE = card('Test Bog Oozeling', 'Creature — Ooze', "Remove three +1/+1 counters from this creature: Return it to its owner's hand.", { pt: ['1', '1'] });
  const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
  const DEFS = [OOZE, BEAR];
  const activate = (s: GameState): GameState => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Bog Oozeling', 'battlefield', 'p1'), ability: 'p:0:0' });
  it('the synthetic card is automated', () => {
    expect(full(OOZE)).toBe(true);
  });
  it('with three counters it returns ITSELF to its owner\'s hand (not another creature)', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Bog Oozeling', counters: { '+1/+1': 3 } }, 'Test Bear'] } });
    const s = resolveAll(activate(s0));
    expect(names(s, 'hand', 'p1')).toEqual(['Test Bog Oozeling']);
    expect(battlefieldOf(s, 'p1')).toEqual(['Test Bear']);
  });
  it('negative (review): when the cost itself moved the card, "it" is not read as that card (CR 400.7, 400.7j): sacrifice, discard, exile and return of ~ leave "Return it" manual', () => {
    for (const cost of ['Sacrifice this artifact', 'Discard this card', "Return this artifact to its owner's hand"]) {
      expect(full(card('Test Odd Relic', 'Artifact', `${cost}: Return it to its owner's hand.`)), cost).toBe(false);
    }
  });
  it('negative: with two counters the ability cannot be activated', () => {
    const s0 = scenario([], { defs: DEFS, p1: { battlefield: [{ name: 'Test Bog Oozeling', counters: { '+1/+1': 2 } }, 'Test Bear'] } });
    expect(legalActions(s0, 'p1').some((l) => l.kind === 'activate' && l.object === find(s0, 'Test Bog Oozeling', 'battlefield', 'p1'))).toBe(false);
  });
});

describe('CR 113.6m, 400.7, 614.1c, 122.6: "{3}{B}: Return this card from your graveyard to the battlefield tapped with two +1/+1 counters on it."', () => {
  const MOTH = card('Test Grave Moth', 'Artifact Creature — Insect', "{3}{B}: Return this card from your graveyard to the battlefield tapped with two +1/+1 counters on it.", { cost: '{B}', pt: ['1', '1'] });
  const DEFS = [MOTH];
  const activate = (s: GameState): GameState => act(s, { type: 'activate', player: 'p1', source: find(s, 'Test Grave Moth', 'graveyard', 'p1'), ability: 'p:0:0' });
  it('the synthetic card is automated', () => {
    expect(full(MOTH)).toBe(true);
  });
  it('from the graveyard it returns tapped with two +1/+1 counters, for {3}{B}', () => {
    const s0 = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: ['Test Grave Moth'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'] } });
    const s = resolveAll(drive(activate(s0)));
    const id = find(s, 'Test Grave Moth', 'battlefield', 'p1');
    expect(s.objects[id]!.tapped).toBe(true);
    expect(s.objects[id]!.counters['+1/+1']).toBe(2);
    expect(names(s, 'graveyard', 'p1')).toEqual([]);
  });
  it('negative: not from the battlefield or the hand, and not without the mana', () => {
    const inHand = scenario(['Swamp'], { defs: DEFS, p1: { hand: ['Test Grave Moth'], battlefield: ['Swamp', 'Swamp', 'Swamp', 'Swamp'] } });
    expect(legalActions(inHand, 'p1').some((l) => l.kind === 'activate' && l.object === find(inHand, 'Test Grave Moth', 'hand', 'p1'))).toBe(false);
    const poor = scenario(['Swamp'], { defs: DEFS, p1: { graveyard: ['Test Grave Moth'], battlefield: ['Swamp', 'Swamp'] } });
    expect(legalActions(poor, 'p1').some((l) => l.kind === 'activate' && l.object === find(poor, 'Test Grave Moth', 'graveyard', 'p1'))).toBe(false);
  });
});
