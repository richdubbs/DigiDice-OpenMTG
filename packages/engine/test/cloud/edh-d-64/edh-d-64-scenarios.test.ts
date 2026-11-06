/**
 * Coordinator D, round edh-d-64 (lane each-player, fourth pass): the round's readings played through the engine with synthetic cards (invented names and wordings, design 6.10),
 * compiled by the game's default compiler, in four-player games (Alice p1 is the active player of turn 1). Each test names the rule it checks, with its negative case. CR cites are from
 * the Comprehensive Rules of 2026-09-25 (unverified from memory where the cloud session could not fetch them).
 *
 *   CR 701.21a, 608.2c, 608.2d, 101.4   "Choose a number between 0 and 3. Each player sacrifices that many creatures of their choice." (By Invitation Only)
 *   CR 508.1b, 506.3, 611.2a            "... that player may exile a card from their graveyard. If the player doesn't, creatures they control can't attack you this turn." (Web of Inertia)
 *   CR 707.10, 707.10c, 115.7, 101.4    "Whenever a player casts a sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy." (Hive Mind)
 *   CR 701.26a, 701.15a, 608.2d         "Each opponent chooses a creature they control. Tap and goad the chosen creatures." (Fell Beast's Shriek)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, attackDenial, type CardDef, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';
import { passUntil } from '../../m4/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const onBattlefield = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => nameOf(s, id)).sort();

interface Seen { player: PlayerId; kind: string; options: string[] }
/** Answer decisions until priority: objects by `pick[player]` (the option with that name) or the first offered; a number by `number`; yes/no by `yes`. */
function drive(s0: GameState, o: { pick?: Partial<Record<PlayerId, string>>; number?: number; yes?: boolean }, seen: Seen[]): GameState {
  let s = s0;
  for (let guard = 0; guard < 120 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending as unknown as { kind: string; player: PlayerId; options?: unknown[]; min?: number; max?: number };
    if (p.kind === 'chooseObjects') {
      const opts = (p.options ?? []) as ObjectId[];
      seen.push({ player: p.player, kind: p.kind, options: opts.map((id) => nameOf(s, id)).sort() });
      const want = o.pick?.[p.player];
      const need = p.min ?? 1;
      const named = want === undefined ? [] : opts.filter((id) => nameOf(s, id) === want);
      const ids = [...named, ...opts.filter((id) => !named.includes(id))].slice(0, need); // (named ones first, then the rest up to the number asked)
      s = answer(s, { kind: 'chooseObjects', ids } as never);
    } else if (p.kind === 'chooseNumber') {
      seen.push({ player: p.player, kind: p.kind, options: (p.options ?? []).map(String) });
      s = answer(s, { kind: 'chooseNumber', n: o.number ?? 0 } as never);
    } else if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: o.yes ?? true });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p).slice(0, 300)}`);
  }
  return s;
}
function cast(s0: GameState, name: string, o: Parameters<typeof drive>[1] = {}): { s: GameState; seen: Seen[] } {
  const seen: Seen[] = [];
  let s = drive(act(s0, { type: 'cast', player: 'p1', card: find(s0, name, 'hand', 'p1') }), o, seen);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), o, seen);
  return { s, seen };
}

// ---- By Invitation Only: a chosen number, then every player sacrifices that many creatures of their choice --------------------------------------------------------------------
const INVITE = card('Test Invitation', 'Sorcery', 'Choose a number between 0 and 3. Each player sacrifices that many creatures of their choice.');
const RAT = card('Test Rat', 'Creature — Rat', '', { pt: ['1', '1'] });
const OX = card('Test Ox', 'Creature — Ox', '', { pt: ['3', '3'] });
describe('CR 701.21a, 608.2c-d, 101.4: "Choose a number between 0 and 3. Each player sacrifices that many creatures of their choice." (By Invitation Only)', () => {
  const setup = (): GameState => mpScenario({
    defs: [INVITE, RAT, OX],
    zones: { p1: { hand: ['Test Invitation'], battlefield: ['Test Rat', 'Test Rat', 'Test Rat'] }, p2: { battlefield: ['Test Ox', 'Test Rat', 'Test Rat'] }, p3: { battlefield: ['Test Ox'] } },
  });
  it('is automated', () => expect(full(INVITE)).toBe(true));
  it('the caster picks 2: each player sacrifices two creatures of their own choice (everything they have when they control fewer), a player with none loses nothing', () => {
    const { s, seen } = cast(setup(), 'Test Invitation', { number: 2, pick: { p2: 'Test Rat' } });
    expect(seen.find((x) => x.kind === 'chooseNumber')!.player).toBe('p1'); // you choose the number
    expect(onBattlefield(s, 'p1')).toEqual(['Test Rat']);
    expect(onBattlefield(s, 'p2')).toEqual(['Test Ox']); // p2 chose to keep the Ox
    expect(onBattlefield(s, 'p3')).toEqual([]); // one creature: all of them
    expect(onBattlefield(s, 'p4')).toEqual([]);
  });
  it('negative: the caster picks 0 and nobody sacrifices anything', () => {
    const { s } = cast(setup(), 'Test Invitation', { number: 0 });
    expect(onBattlefield(s, 'p1')).toEqual(['Test Rat', 'Test Rat', 'Test Rat']);
    expect(onBattlefield(s, 'p2')).toEqual(['Test Ox', 'Test Rat', 'Test Rat']);
    expect(onBattlefield(s, 'p3')).toEqual(['Test Ox']);
  });
});

// ---- Fell Beast's Shriek: each opponent chooses a creature they control; tap and goad them -----------------------------------------------------------------------------------
const SHRIEK = card('Test Shriek', 'Sorcery', 'Each opponent chooses a creature they control. Tap and goad the chosen creatures.');
describe("CR 608.2d, 101.4, 701.26a, 701.15a: \"Each opponent chooses a creature they control. Tap and goad the chosen creatures.\" (Fell Beast's Shriek)", () => {
  const setup = (): GameState => mpScenario({
    defs: [SHRIEK, RAT, OX],
    zones: { p1: { hand: ['Test Shriek'], battlefield: ['Test Rat'] }, p2: { battlefield: ['Test Ox', 'Test Rat'] }, p3: { battlefield: ['Test Ox'] } },
  });
  it('is automated', () => expect(full(SHRIEK)).toBe(true));
  it('each opponent chooses one of their own creatures; only the chosen ones are tapped and goaded; your creature and the unchosen ones are left alone; an opponent with no creature chooses nothing', () => {
    const { s, seen } = cast(setup(), 'Test Shriek', { pick: { p2: 'Test Rat' } });
    expect(seen.map((x) => x.player)).toEqual(['p2']); // p3 has one creature (no choice), p4 none, p1 is not an opponent
    const byName = (p: PlayerId): { name: string; tapped: boolean; goaded: boolean }[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => ({ name: nameOf(s, id), tapped: s.objects[id]!.tapped, goaded: JSON.stringify(s.objects[id]).includes('goad') })).sort((a, b) => a.name.localeCompare(b.name));
    expect(byName('p2')).toEqual([{ name: 'Test Ox', tapped: false, goaded: false }, { name: 'Test Rat', tapped: true, goaded: true }]);
    expect(byName('p3')).toEqual([{ name: 'Test Ox', tapped: true, goaded: true }]);
    expect(byName('p1')).toEqual([{ name: 'Test Rat', tapped: false, goaded: false }]);
  });
});

// ---- Hive Mind: every player but the caster copies the spell -----------------------------------------------------------------------------------------------------------------
const MIND = card('Test Mind', 'Enchantment', 'Whenever a player casts a sorcery spell, each other player copies that spell. Each of those players may choose new targets for their copy.');
const BOON = card('Test Boon', 'Sorcery', 'You gain 3 life.');
describe('CR 707.10, 707.10c, 101.4: "Whenever a player casts a sorcery spell, each other player copies that spell." (Hive Mind)', () => {
  const setup = (): GameState => mpScenario({ defs: [MIND, BOON], zones: { p1: { hand: ['Test Boon'] }, p2: { battlefield: ['Test Mind'] } } });
  it('is automated', () => expect(full(MIND)).toBe(true));
  it('the caster gains 3 and every OTHER player (the Mind\'s controller p2 too) gains 3 from their own copy; the caster does not copy their own spell', () => {
    const { s } = cast(setup(), 'Test Boon', { yes: false });
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(lifeOf(s, 'p2')).toBe(23);
    expect(lifeOf(s, 'p3')).toBe(23);
    expect(lifeOf(s, 'p4')).toBe(23);
  });
  it('negative: a spell that is not a sorcery (an instant) is not copied', () => {
    const INSTANT = card('Test Flash Boon', 'Instant', 'You gain 3 life.');
    const s0 = mpScenario({ defs: [MIND, INSTANT], zones: { p1: { hand: ['Test Flash Boon'] }, p2: { battlefield: ['Test Mind'] } } });
    const { s } = cast(s0, 'Test Flash Boon');
    expect(lifeOf(s, 'p1')).toBe(23);
    expect(lifeOf(s, 'p2')).toBe(20);
  });
});

// ---- Web of Inertia: the opponent may exile a card from their graveyard, or their creatures can't attack you this turn ------------------------------------------------------------------
const WEB = card('Test Web', 'Enchantment', "At the beginning of combat on each opponent's turn, that player may exile a card from their graveyard. If the player doesn't, creatures they control can't attack you this turn.");
const BEAR = card('Test Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
describe('CR 508.1b, 506.3, 611.2a: "If the player doesn\'t, creatures they control can\'t attack you this turn." (Web of Inertia)', () => {
  const play = (exile: boolean): GameState => {
    const s0 = mpScenario({ defs: [WEB, BEAR, RAT], zones: { p1: { battlefield: ['Test Bear'], graveyard: ['Test Rat'] }, p2: { battlefield: ['Test Web'] } } });
    let s = passUntil(s0, (x) => x.turn.step === 'beginCombat' && x.zones.stack.length > 0, 'the trigger');
    for (let i = 0; i < 12 && (s.zones.stack.length > 0 || (s.pending && s.pending.kind !== 'priority')); i++) {
      const p = s.pending as unknown as { kind: string; options?: ObjectId[]; min?: number } | undefined;
      if (p && p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: exile });
      else if (p && p.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: (p.options ?? []).slice(0, p.min ?? 1) } as never);
      else if (p && p.kind !== 'priority') throw new Error(`unexpected ${p.kind}`);
      else s = act(s, { type: 'pass', player: s.pending!.player });
    }
    return s;
  };
  const canAttack = (s: GameState, defender: PlayerId): boolean => {
    const bear = s.objects[find(s, 'Test Bear', 'battlefield')]!;
    return attackDenial(s, bear, getChars(s, bear.id), [defender]) === null;
  };
  it('is automated', () => expect(full(WEB)).toBe(true));
  it('declining to exile: the opponent\'s creatures can\'t attack the Web\'s controller this turn but may attack the other players', () => {
    const s = play(false);
    expect(canAttack(s, 'p2')).toBe(false);
    expect(canAttack(s, 'p3')).toBe(true);
  });
  it('negative: exiling a card from their graveyard lets them attack the Web\'s controller', () => {
    const s = play(true);
    expect(canAttack(s, 'p2')).toBe(true);
    expect(s.zones.exile.map((id) => nameOf(s, id))).toEqual(['Test Rat']);
  });
});
