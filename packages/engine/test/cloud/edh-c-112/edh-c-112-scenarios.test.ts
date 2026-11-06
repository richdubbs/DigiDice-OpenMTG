/**
 * Commander lane edh-c, round edh-c-112 (EDHREC ranks 17,001-17,500, fifth pass): the round's readings played through the engine with synthetic cards (invented names, design 6.10),
 * compiled by the game's default compiler. Alice (p1) is the active player of turn 1. CR cites checked against the Comprehensive Rules of 2026-09-25.
 *
 *   CR 303.4, 122.1, 613.4c           "Enchanted creature gets +1/+1 for each +1/+1 counter on other creatures you control." (Gleam of Authority)
 *   CR 205.1a, 613.1f, 613.4b, 611.2a "Until end of turn, ~ becomes a Human with base power and toughness 1/1, loses all abilities, and gains hexproof." (Chromium, the Mutable)
 *   CR 613.4b, 611.2c, 608.2h         "If you do, ~ has base power and base toughness each equal to the number of cards exiled this way." (Trench Gorger)
 *   CR 201.2, 400.3, 110.2a           "Each player returns all cards with the same name as that spell from their graveyard to the battlefield." (Bloodbond March)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type CardDef, type GameState, type ObjectId, type OracleCard, type PlayerId } from '../../../src/index';
import { activatedAbilities } from '../../../src/index';
import { getChars } from '../../../src/rules/characteristics';
import { act, answer, find, pass, put, scenario } from '../../m3/scenario';
import { tweak } from '../../m4/helpers';

function card(name: string, type: string, text: string, o: { pt?: [string, string]; cost?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: o.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(o.pt ? { power: o.pt[0], toughness: o.pt[1] } : {}) } as OracleCard);
}
const noManual = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const pt = (s: GameState, id: ObjectId): string => { const c = getChars(s, id)!; return `${c.power}/${c.toughness}`; };
const kw = (s: GameState, id: ObjectId, name: string): boolean => getChars(s, id)!.keywords.some((k) => k.keyword === name);
const count = (s: GameState, p: PlayerId, zone: 'hand' | 'graveyard' | 'battlefield' | 'exile' | 'library', name: string): number =>
  Object.values(s.objects).filter((o) => o.zone === zone && o.owner === p && s.defs[o.defId]!.name === name).length;
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

type Targets = ({ kind: 'player'; id: PlayerId } | { kind: 'object'; id: ObjectId })[][];
interface Opts { targets?: Targets; yes?: boolean }
/** Answer the decisions until priority: payments automatic, targets in order, yes/no by `yes`, a choice of objects takes the first options (all of them for "any number"). */
function drive(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  const q = [...(o.targets ?? [])];
  for (let guard = 0; guard < 60 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: q.shift() ?? [] });
    else if (p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: p.options.slice(0, p.min === 0 ? p.max : p.min) });
    else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else throw new Error(`unexpected decision ${p.kind}: ${p.prompt}`);
  }
  return s;
}
function resolveAll(s0: GameState, o: Opts = {}): GameState {
  let s = s0;
  for (let i = 0; i < 16 && s.zones.stack.length > 0; i++) s = drive(pass(pass(s)), o);
  return s;
}
const cast = (s: GameState, name: string, o: Opts = {}): GameState => resolveAll(drive(act(s, { type: 'cast', player: 'p1', card: find(s, name, 'hand', 'p1') }), o), o);
const obj = (id: ObjectId): { kind: 'object'; id: ObjectId } => ({ kind: 'object', id });
const plr = (id: PlayerId): { kind: 'player'; id: PlayerId } => ({ kind: 'player', id });

const BEARS = card('Test Bears', 'Creature — Bear', '', { pt: ['2', '2'] });
const OGRE = card('Test Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });

describe('CR 303.4, 122.1, 613.4c: "Enchanted creature gets +1/+1 for each +1/+1 counter on other creatures you control."', () => {
  const GLEAM = card('Test Gleam', 'Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +1/+1 for each +1/+1 counter on other creatures you control.');
  const start = (): GameState => scenario([], { p1: { battlefield: [{ name: 'Test Bears', counters: { '+1/+1': 2 } }, { name: 'Test Ogre', counters: { '+1/+1': 3 } }] }, p2: { battlefield: [{ name: 'Test Bears', counters: { '+1/+1': 4 } }] }, defs: [GLEAM, BEARS, OGRE] });
  const enchant = (s: GameState, to: ObjectId): GameState => tweak(s, (t) => { const id = put(t, 'p1', 'battlefield', 'Test Gleam'); t.objects[id]!.attachedTo = to; });
  it('is automated', () => expect(noManual(GLEAM)).toBe(true));
  it('counts the counters on the Aura controller\'s other creatures, never the enchanted creature\'s own and never an opponent\'s', () => {
    let s = start();
    const bears = find(s, 'Test Bears', 'battlefield', 'p1');
    const ogre = find(s, 'Test Ogre', 'battlefield', 'p1');
    expect(pt(s, bears)).toBe('4/4'); // 2/2 with two counters
    s = enchant(s, bears);
    expect(pt(s, bears)).toBe('7/7'); // + the 3 counters on the Ogre
    expect(pt(s, ogre)).toBe('6/6'); // unaffected: 3/3 with three counters
  });
  it('on an opponent\'s creature, every +1/+1 counter on the Aura controller\'s creatures counts', () => {
    let s = start();
    const theirs = find(s, 'Test Bears', 'battlefield', 'p2');
    s = enchant(s, theirs);
    expect(pt(s, theirs)).toBe('11/11'); // 2/2 + 4 counters + (2 + 3) counters on p1's creatures
  });
});

describe('CR 205.1a, 613.1f, 613.4b, 611.2a: "Until end of turn, ~ becomes a Human with base power and toughness 1/1, loses all abilities, and gains hexproof."', () => {
  const DRAKE = card('Test Drake', 'Legendary Creature — Elder Dragon', 'Flying\nDiscard a card: Until end of turn, ~ becomes a Human with base power and toughness 1/1, loses all abilities, and gains hexproof. It can\'t be blocked this turn.', { pt: ['5', '5'] });
  const FILLER = card('Test Filler', 'Sorcery', 'You gain 1 life.');
  it('is automated', () => expect(noManual(DRAKE)).toBe(true));
  it('becomes a 1/1 Human without flying but with hexproof until the turn ends, a legendary creature still, and is itself again afterwards', () => {
    let s = scenario([], { p1: { hand: ['Test Filler'], battlefield: ['Test Drake'] }, defs: [DRAKE, FILLER] });
    const id = find(s, 'Test Drake', 'battlefield', 'p1');
    expect(pt(s, id)).toBe('5/5');
    expect(kw(s, id, 'flying')).toBe(true);
    const key = activatedAbilities(s, s.objects[id]!).find((i) => i.def.isMana !== true)!.key;
    s = drive(act(s, { type: 'activate', player: 'p1', source: id, ability: key } as never));
    s = resolveAll(s);
    const c = getChars(s, id)!;
    expect(pt(s, id)).toBe('1/1');
    expect(c.subtypes).toEqual(['Human']);
    expect(c.supertypes).toContain('Legendary');
    expect(c.types).toContain('Creature');
    expect(kw(s, id, 'flying')).toBe(false);
    expect(kw(s, id, 'hexproof')).toBe(true);
    // to the end of the turn: the effects are over
    for (let i = 0; i < 80 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'upkeep'); i++) {
      if (s.pending?.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
      else if (s.pending?.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
      else if (s.pending?.kind === 'chooseObjects') s = drive(s);
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    expect(pt(s, id)).toBe('5/5');
    expect(kw(s, id, 'flying')).toBe(true);
    expect(kw(s, id, 'hexproof')).toBe(false);
  });
});

describe('CR 613.4b, 611.2c, 608.2h: "When ~ enters, you may search your library for any number of land cards, exile them, then shuffle. If you do, ~ has base power and base toughness each equal to the number of cards exiled this way."', () => {
  const GORGER = card('Test Gorger', 'Creature — Leviathan', 'Trample\nWhen this creature enters, you may search your library for any number of land cards, exile them, then shuffle. If you do, this creature has base power and base toughness each equal to the number of cards exiled this way.', { pt: ['6', '6'], cost: '{0}' });
  const CAVE = card('Test Cave', 'Land', '');
  const start = (): GameState => scenario([], { p1: { hand: ['Test Gorger'], library: ['Test Cave', 'Test Cave', 'Test Cave', 'Test Bears'] }, defs: [GORGER, CAVE, BEARS] });
  it('is automated', () => expect(noManual(GORGER)).toBe(true));
  it('searching for every land card: they are exiled and its base power and toughness are that many; later changes to the exile do not change it', () => {
    let s = cast(start(), 'Test Gorger', { yes: true });
    const id = find(s, 'Test Gorger', 'battlefield', 'p1');
    const exiled = Object.values(s.objects).filter((o) => o.zone === 'exile' && o.owner === 'p1').length; // the three caves and the basic lands the scenario puts into the library
    expect(count(s, 'p1', 'exile', 'Test Cave')).toBe(3);
    expect(exiled).toBeGreaterThan(3);
    expect(count(s, 'p1', 'library', 'Test Bears')).toBe(1);
    expect(pt(s, id)).toBe(`${exiled}/${exiled}`);
    s = tweak(s, (t) => { const ex = Object.values(t.objects).find((o) => o.zone === 'exile')!; t.zones.exile = t.zones.exile.filter((x) => x !== ex.id); ex.zone = 'graveyard'; t.zones.graveyard['p1']!.push(ex.id); });
    expect(pt(s, id)).toBe(`${exiled}/${exiled}`);
  });
  it('declining the search: nothing is exiled and it stays a 6/6', () => {
    const s = cast(start(), 'Test Gorger', { yes: false });
    const id = find(s, 'Test Gorger', 'battlefield', 'p1');
    expect(count(s, 'p1', 'exile', 'Test Cave')).toBe(0);
    expect(pt(s, id)).toBe('6/6');
  });
});

describe('CR 201.2, 400.3, 110.2a: "Whenever a player casts a creature spell, each player returns all cards with the same name as that spell from their graveyard to the battlefield."', () => {
  const MARCH = card('Test March', 'Enchantment', 'Whenever a player casts a creature spell, each player returns all cards with the same name as that spell from their graveyard to the battlefield.');
  const SPELL = card('Test Charm', 'Sorcery', 'You gain 1 life.');
  const start = (): GameState => scenario([], { p1: { hand: ['Test Bears', 'Test Charm'], graveyard: ['Test Bears', 'Test Bears', 'Test Ogre', 'Test Charm'], battlefield: ['Test March'] }, p2: { graveyard: ['Test Bears', 'Test Ogre'] }, defs: [MARCH, BEARS, OGRE, SPELL] });
  it('is automated', () => expect(noManual(MARCH)).toBe(true));
  it('every card with the cast spell\'s name in any graveyard comes back under its owner\'s control; other names stay', () => {
    const s = cast(start(), 'Test Bears');
    expect(count(s, 'p1', 'battlefield', 'Test Bears')).toBe(3); // the spell itself and two from the graveyard
    expect(count(s, 'p2', 'battlefield', 'Test Bears')).toBe(1);
    expect(count(s, 'p1', 'graveyard', 'Test Bears')).toBe(0);
    expect(count(s, 'p2', 'graveyard', 'Test Ogre')).toBe(1);
    expect(count(s, 'p1', 'graveyard', 'Test Ogre')).toBe(1);
    expect(Object.values(s.objects).filter((o) => o.zone === 'battlefield' && s.defs[o.defId]!.name === 'Test Bears').every((o) => o.controller === o.owner)).toBe(true);
  });
  it('a spell that is not a creature spell does not trigger it', () => {
    const s = cast(start(), 'Test Charm');
    expect(count(s, 'p1', 'battlefield', 'Test Charm')).toBe(0);
    expect(count(s, 'p1', 'graveyard', 'Test Charm')).toBe(2); // the cast one and the one already there
    expect(count(s, 'p1', 'graveyard', 'Test Bears')).toBe(2);
  });
});
