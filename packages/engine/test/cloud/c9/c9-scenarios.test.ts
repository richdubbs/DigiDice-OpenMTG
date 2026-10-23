/**
 * Cloud batch 3, row C9: an "instead" sentence that replaces another instruction or a whole sentence (render/self-replacement.ts#notWideReplacement, the fold in
 * parser/lower/riders.ts) and the one search for a card of each of two descriptions (`search.and`, effects/handlers/cards-library.ts), played through the engine
 * with synthetic cards compiled by the game's default compiler (invented names and wordings, design 6.10). Each test is named after the rule it checks.
 *
 *   CR 608.2c, 614.15           "All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures instead."
 *   CR 608.2c, 701.8a, 400.7    "Destroy target creature. If that creature is a Goblin, exile it instead."
 *   CR 608.2c, 701.19c          "... If you control a Swamp, instead destroy that creature. It can't be regenerated."
 *   CR 608.2c, 701.23a-b        "Search your library for a Forest card. If you control a Wizard, instead search your library for an artifact card. Reveal that card, ..."
 *   CR 608.2c, 701.23d          "Search ... for a Goblin card, reveal it, put it into your hand, then shuffle. If you control an Elf, instead search ... for any card, ..."
 *   CR 701.23a-b, 702.33d       "Search your library for a Forest card and an Island card, ..." / kicked "instead search ... for a Forest card and an Island card"
 *   CR 608.2c, 122.1            "Target creature gets +2/+2 until end of turn. If you control a Wizard, instead put a +1/+1 counter on it and it gets +1/+1 ..."
 *   CR 608.2c, 121.2, 701.9     "Target player draws two cards, then discards a card. If you control a Wizard, instead that player draws three cards, then discards two cards."
 * (CR numbers from memory: the rules folder is not in this checkout; see the PR body.)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, findAll, life, pass, scenario } from '../../m3/scenario';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({
    name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [],
    ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}),
  } as OracleCard);
}
/** Nothing of the card is left manual. */
const noManual = (d: CardDef): boolean => !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const ptOf = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const handNames = (s: GameState, p: PlayerId): string[] => s.zones.hand[p]!.map((id) => s.defs[s.objects[id]!.defId]!.name).sort();
const plusOne = (s: GameState, id: ObjectId): number => s.objects[id]!.counters?.['+1/+1'] ?? 0;

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
/** Answer the decisions until priority: payments automatic, targets in order, yes/no by `yes`, a search by `pick` (names in order) or else its first options. */
function drive(s0: GameState, o: { targets?: Targets; yes?: boolean; pick?: string[] } = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  const picks = [...(o.pick ?? [])];
  for (let guard = 0; guard < 40 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: p.options.slice(0, p.min).map((x) => x.id) });
    else if (p.kind === 'chooseObjects') {
      const want = picks.length > 0 ? p.options.filter((id) => s.defs[s.objects[id]!.defId]!.name === picks[0]).slice(0, 1) : [];
      if (want.length > 0) picks.shift();
      s = answer(s, { kind: 'chooseObjects', ids: want.length > 0 ? want : p.options.slice(0, p.min === 0 ? p.max : p.min) });
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else throw new Error(`unexpected decision ${p.kind}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Parameters<typeof drive>[1] = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Parameters<typeof drive>[1] = {}): GameState =>
  resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });

const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const WALL = card('Test Wall', 'Creature — Wall', 'Indestructible', { pt: ['1', '1'] });
const GOBLIN = card('Test Goblin', 'Creature — Goblin', '', { pt: ['1', '1'] });
const WIZARD = card('Test Wizard', 'Creature — Human Wizard', '', { pt: ['1', '1'] });
const ELF = card('Test Elf', 'Creature — Elf', '', { pt: ['1', '1'] });
const TRINKET = card('Test Trinket', 'Artifact', '');

describe('CR 608.2c, 614.15: "All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures instead."', () => {
  const BLIGHT = card('Test Blight', 'Sorcery', 'All creatures get -1/-1 until end of turn. If you gained life this turn, destroy all creatures instead.');
  const SALVE = card('Test Salve', 'Instant', 'You gain 1 life.');
  const defs = [BLIGHT, SALVE, BEAR, WALL];
  it('is understood', () => expect(noManual(BLIGHT)).toBe(true));
  it('CR 608.2c: with no life gained this turn, every creature gets -1/-1 and none is destroyed', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Blight'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = cast(s0, 'Test Blight');
    expect(ptOf(s, bear)).toBe('1/1');
    expect(findAll(s, 'Test Wall', 'battlefield')).toHaveLength(0); // 0/0 indestructible: put into the graveyard by the state-based action (CR 704.5f)
  });
  it('CR 614.15: after life was gained this turn, all creatures are destroyed INSTEAD: the indestructible one survives and gets no -1/-1', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Salve', 'Test Blight'], battlefield: ['Test Bear'] }, p2: { battlefield: ['Test Wall'] } });
    const l0 = life(s0, 'p1');
    const s1 = cast(s0, 'Test Salve');
    expect(life(s1, 'p1')).toBe(l0 + 1);
    const s = cast(s1, 'Test Blight');
    expect(findAll(s, 'Test Bear', 'battlefield')).toHaveLength(0);
    expect(findAll(s, 'Test Bear', 'graveyard', 'p1')).toHaveLength(1);
    const wall = find(s, 'Test Wall', 'battlefield');
    expect(ptOf(s, wall)).toBe('1/1');
  });
});

describe('CR 608.2c, 701.8a, 400.7: "Destroy target creature. If that creature is a Goblin, exile it instead."', () => {
  const PURGE = card('Test Purge', 'Instant', 'Destroy target creature. If that creature is a Goblin, exile it instead.');
  const defs = [PURGE, BEAR, GOBLIN];
  it('is understood', () => expect(noManual(PURGE)).toBe(true));
  it('CR 701.8a: a creature that is not a Goblin is destroyed (into its owner\'s graveyard)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Purge'] }, p2: { battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Purge', { targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] });
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
  });
  it('CR 400.7, 614.15: a Goblin is exiled instead: "it" is the target itself, never a card the destroy would have put into the graveyard', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Purge'] }, p2: { battlefield: ['Test Goblin'] } });
    const s = cast(s0, 'Test Purge', { targets: [[obj(find(s0, 'Test Goblin', 'battlefield'))]] });
    expect(findAll(s, 'Test Goblin', 'graveyard', 'p2')).toHaveLength(0);
    expect(findAll(s, 'Test Goblin', 'exile', 'p2')).toHaveLength(1);
  });
});

describe('CR 608.2c, 701.19c: "Target creature gets -1/-1 until end of turn. If you control a Swamp, instead destroy that creature. It can\'t be regenerated."', () => {
  const RUIN = card('Test Ruin', 'Instant', "Target creature gets -1/-1 until end of turn. If you control a Swamp, instead destroy that creature. It can't be regenerated.");
  const defs = [RUIN, BEAR];
  it('is understood, and "It can\'t be regenerated" modifies the destroy of the instead sentence only', () => {
    expect(noManual(RUIN)).toBe(true);
    const json = JSON.stringify(RUIN.faces[0]!.abilities);
    expect(json).toContain('"then":[{"op":"destroy","what":{"ref":"target","id":"t0"},"regeneration":"cant"}]');
    expect(json).not.toContain('"else":[{"op":"destroy"');
  });
  it('CR 608.2c: without a Swamp the creature gets -1/-1 and stays', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Ruin'] }, p2: { battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = cast(s0, 'Test Ruin', { targets: [[obj(bear)]] });
    expect(ptOf(s, bear)).toBe('1/1');
  });
  it('CR 614.15: with a Swamp the creature is destroyed instead', () => {
    const s0 = scenario(['Swamp'], { defs, p1: { hand: ['Test Ruin'], battlefield: ['Swamp'] }, p2: { battlefield: ['Test Bear'] } });
    const s = cast(s0, 'Test Ruin', { targets: [[obj(find(s0, 'Test Bear', 'battlefield'))]] });
    expect(findAll(s, 'Test Bear', 'graveyard', 'p2')).toHaveLength(1);
  });
});

describe('CR 608.2c, 701.23a-b: "Search your library for a Forest card. If you control a Wizard, instead search your library for an artifact card. Reveal that card, put it into your hand, then shuffle."', () => {
  const QUEST = card('Test Quest', 'Sorcery', 'Search your library for a Forest card. If you control a Wizard, instead search your library for an artifact card. Reveal that card, put it into your hand, then shuffle.');
  const defs = [QUEST, WIZARD, TRINKET];
  it('is understood', () => expect(noManual(QUEST)).toBe(true));
  it('CR 701.23b: without a Wizard only a Forest can be found; it is put into the hand', () => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Quest'], library: ['Test Trinket', 'Forest'] } });
    const s = cast(s0, 'Test Quest', { pick: ['Forest'] });
    expect(handNames(s, 'p1')).toContain('Forest');
    expect(handNames(s, 'p1')).not.toContain('Test Trinket');
  });
  it('CR 614.15: with a Wizard the search is for an artifact card instead (a Forest cannot be taken)', () => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Quest'], battlefield: ['Test Wizard'], library: ['Forest', 'Test Trinket'] } });
    const s1 = pass(pass(drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Quest', 'hand', 'p1') }))));
    // the one search offered: only the artifact
    expect(s1.pending?.kind).toBe('chooseObjects');
    const offered = (s1.pending as { options: ObjectId[] }).options.map((id) => s1.defs[s1.objects[id]!.defId]!.name);
    expect(offered).toEqual(['Test Trinket']);
    const s = resolveAll(drive(s1));
    expect(handNames(s, 'p1')).toContain('Test Trinket');
    expect(handNames(s, 'p1')).not.toContain('Forest');
  });
});

describe('CR 608.2c, 701.23d: "Search your library for a Goblin card, reveal it, put it into your hand, then shuffle. If you control an Elf, instead search your library for any card, put it into your hand, then shuffle."', () => {
  const COUNSEL = card('Test Counsel', 'Sorcery', 'Search your library for a Goblin card, reveal it, put it into your hand, then shuffle. If you control an Elf, instead search your library for any card, put it into your hand, then shuffle.');
  const defs = [COUNSEL, GOBLIN, ELF, TRINKET];
  it('is understood: the whole first sentence is the replaced branch', () => {
    expect(noManual(COUNSEL)).toBe(true);
    const steps = (COUNSEL.faces[0]!.abilities[0] as { effect: { steps: { op: string; then?: unknown[]; else?: unknown[] }[] } }).effect.steps;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.op).toBe('if');
    expect(steps[0]!.then).toHaveLength(3);
    expect(steps[0]!.else).toHaveLength(3);
  });
  it('CR 701.23b: without an Elf only a Goblin card can be taken', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Counsel'], library: ['Test Trinket', 'Test Goblin'] } });
    const s = cast(s0, 'Test Counsel', { pick: ['Test Goblin'] });
    expect(handNames(s, 'p1')).toContain('Test Goblin');
    expect(handNames(s, 'p1')).not.toContain('Test Trinket');
  });
  it('CR 701.23d, 614.15: with an Elf any card can be taken instead, and the found card is the one put into the hand', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Counsel'], battlefield: ['Test Elf'], library: ['Test Goblin', 'Test Trinket'] } });
    const s = cast(s0, 'Test Counsel', { pick: ['Test Trinket'] });
    expect(handNames(s, 'p1')).toContain('Test Trinket');
    expect(handNames(s, 'p1')).not.toContain('Test Goblin');
  });
});

describe('CR 701.23a-b: "Search your library for a Forest card and an Island card, put them into your hand, then shuffle."', () => {
  const TREK = card('Test Trek', 'Sorcery', 'Search your library for a Forest card and an Island card, put them into your hand, then shuffle.');
  const defs = [TREK];
  it('is understood', () => expect(noManual(TREK)).toBe(true));
  it('CR 701.23a: one card of each description is found and both are put into the hand', () => {
    const s0 = scenario(['Forest', 'Island'], { defs, p1: { hand: ['Test Trek'], library: ['Forest', 'Island', 'Forest'] } });
    const s = cast(s0, 'Test Trek', { pick: ['Forest', 'Island'] });
    expect(handNames(s, 'p1').filter((n) => n === 'Forest')).toHaveLength(1);
    expect(handNames(s, 'p1').filter((n) => n === 'Island')).toHaveLength(1);
  });
  it('CR 701.23b: a description no card has is not found; the other one still is', () => {
    const s0 = scenario(['Forest'], { defs, p1: { hand: ['Test Trek'], library: ['Forest', 'Plains'] } });
    const s = cast(s0, 'Test Trek', { pick: ['Forest'] });
    expect(handNames(s, 'p1')).toEqual(['Forest']);
  });
});

describe('CR 702.33d, 608.2c: "Kicker {1} / Search your library for a Forest card. If this spell was kicked, instead search your library for a Forest card and an Island card. Reveal those cards, ..."', () => {
  const JOURNEY = card('Test Journey', 'Sorcery', 'Kicker {1}\nSearch your library for a Forest card. If this spell was kicked, instead search your library for a Forest card and an Island card. Reveal those cards, put them into your hand, then shuffle.');
  const defs = [JOURNEY];
  it('is understood', () => expect(noManual(JOURNEY)).toBe(true));
  it('CR 702.33d: kicked, a Forest and an Island are found and put into the hand', () => {
    const s0 = scenario(['Forest', 'Island'], { defs, p1: { hand: ['Test Journey'], battlefield: ['Plains'], library: ['Forest', 'Island'] } });
    const s = cast(s0, 'Test Journey', { yes: true, pick: ['Forest', 'Island'] });
    expect(handNames(s, 'p1')).toEqual(['Forest', 'Island']);
  });
  it('CR 608.2c: not kicked, only the one Forest is found', () => {
    const s0 = scenario(['Forest', 'Island'], { defs, p1: { hand: ['Test Journey'], battlefield: ['Plains'], library: ['Forest', 'Island'] } });
    const s = cast(s0, 'Test Journey', { yes: false, pick: ['Forest'] });
    expect(handNames(s, 'p1')).toEqual(['Forest']);
  });
});

describe('CR 608.2c, 122.1: "Target creature gets +2/+2 until end of turn. If you control a Wizard, instead put a +1/+1 counter on it and it gets +1/+1 until end of turn."', () => {
  const BLESSING = card('Test Blessing', 'Instant', 'Target creature gets +2/+2 until end of turn. If you control a Wizard, instead put a +1/+1 counter on it and it gets +1/+1 until end of turn.');
  const defs = [BLESSING, BEAR, WIZARD];
  it('is understood', () => expect(noManual(BLESSING)).toBe(true));
  it('CR 608.2c: without a Wizard the creature gets +2/+2 and no counter', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Blessing'], battlefield: ['Test Bear'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = cast(s0, 'Test Blessing', { targets: [[obj(bear)]] });
    expect(ptOf(s, bear)).toBe('4/4');
    expect(plusOne(s, bear)).toBe(0);
  });
  it('CR 614.15: with a Wizard both instructions of the instead sentence happen and the +2/+2 does not', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Blessing'], battlefield: ['Test Bear', 'Test Wizard'] } });
    const bear = find(s0, 'Test Bear', 'battlefield');
    const s = cast(s0, 'Test Blessing', { targets: [[obj(bear)]] });
    expect(plusOne(s, bear)).toBe(1);
    expect(ptOf(s, bear)).toBe('4/4'); // 2/2, a +1/+1 counter, +1/+1 (not 6/6)
  });
});

describe('CR 608.2c, 121.2: "Target player draws two cards, then discards a card. If you control a Wizard, instead that player draws three cards, then discards two cards."', () => {
  const STUDY = card('Test Study', 'Instant', 'Target player draws two cards, then discards a card. If you control a Wizard, instead that player draws three cards, then discards two cards.');
  const defs = [STUDY, WIZARD];
  const handSize = (s: GameState): number => s.zones.hand['p1']!.length;
  it('is understood', () => expect(noManual(STUDY)).toBe(true));
  it('CR 608.2c: without a Wizard, two cards drawn and one discarded', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Study'] } });
    const h0 = handSize(s0);
    const s = cast(s0, 'Test Study', { targets: [[{ kind: 'player', id: 'p1' }]] });
    expect(handSize(s)).toBe(h0 - 1 + 2 - 1);
  });
  it('CR 614.15: with a Wizard, three drawn and two discarded instead (not both sentences)', () => {
    const s0 = scenario([], { defs, p1: { hand: ['Test Study'], battlefield: ['Test Wizard'] } });
    const h0 = handSize(s0);
    const s = cast(s0, 'Test Study', { targets: [[{ kind: 'player', id: 'p1' }]] });
    expect(handSize(s)).toBe(h0 - 1 + 3 - 2);
  });
});
