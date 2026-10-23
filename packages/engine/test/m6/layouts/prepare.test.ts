/**
 * M6-6 (m6 design E19, 3.7 "Prepare", 5 "M6-6"): preparation cards (CR 722). The prepared designation (CR 722.3a-b), the copy of the prepare spell in exile with
 * only the prepare spell's characteristics (CR 722.3c), kept in exile while the permanent is prepared (the exception to SBA 704.5e), cast with the method
 * `prepare` (actions/cast-opt/prepare.ts), and "prepared" lost as that spell becomes cast (CR 601.2i). Fixture cards: Strife Scholar // Awaken the Ages,
 * Encouraging Aviator // Jump; the Frog token copy of the CR 722.3c example is made by a spell with the JSON Croaking Counterpart's first ability stands for.
 */
import { describe, expect, it } from 'vitest';
import { getChars, legalActions, type AbilityDef, type CardDef, type GameState } from '../../../src/index';
import { act, answer, find, pass, scenario } from '../../m3/scenario';
import { synth } from '../../m3/synthetic';
import { Game } from '../../../src/core/game';
import { becomePrepared } from '../../../src/core/prepare';
import { clone } from '../../../src/util/clone';
import { declareAttackers, toDeclareAttackers } from '../../m4/helpers';
import { cast, drive, resolveTop, target } from '../../m5/cr-examples/helpers';

const mountains = (n: number): string[] => Array<string>(n).fill('Mountain');
const islands = (n: number): string[] => Array<string>(n).fill('Island');
const exileCopies = (s: GameState): string[] => s.zones.exile.filter((id) => s.objects[id]!.kind === 'spellCopy');
const castLabels = (s: GameState, p: 'p1' | 'p2' = 'p1'): string[] => legalActions(s, p).filter((a) => a.kind === 'cast').map((a) => a.label);
const named = (s: GameState, name: string): string[] => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === name);

/** "Create a token that's a copy of target non-Frog creature, except it's a 1/1 green Frog." (CR 707.9b; the first ability of Croaking Counterpart). */
const FROG_COPY: CardDef = synth({
  name: 'Test Croaking Copy', cost: '{1}{G}{U}', type: 'Instant',
  abilities: [{
    kind: 'spell', text: "Create a token that's a copy of target non-Frog creature, except it's a 1/1 green Frog.",
    effect: {
      targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target non-Frog creature', filter: { types: ['Creature'], not: { subtypes: ['Frog'] } } }],
      steps: [{ op: 'copy', what: { ref: 'target', id: 't0' }, result: 'token', who: { ref: 'you' }, except: [{ layer: '7b', power: 1, toughness: 1 }, { layer: 5, colors: { set: ['G'] } }, { layer: 4, subtypes: { set: ['Frog'] } }] }],
    },
  } as AbilityDef],
});
/** "Target creature becomes unprepared." (CR 722.3b) */
const UNPREPARE: CardDef = synth({
  name: 'Test Unprepare', cost: '{U}', type: 'Instant',
  abilities: [{ kind: 'spell', text: 'Target creature becomes unprepared.', effect: { targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }], steps: [{ op: 'designateObject', what: { ref: 'target', id: 't0' }, designation: 'unprepared' }] } } as AbilityDef],
});

/** Strife Scholar cast and resolved: it enters prepared. */
function scholar(extra: { hand?: string[]; battlefield?: string[]; cards?: string[] } = {}, defs: CardDef[] = []): { s: GameState; id: string } {
  let s = scenario(['Strife Scholar // Awaken the Ages', 'Mountain', 'Island', ...(extra.cards ?? [])], { p1: { hand: ['Strife Scholar // Awaken the Ages', ...(extra.hand ?? [])], battlefield: [...mountains(9), ...(extra.battlefield ?? [])] }, defs });
  s = resolveTop(cast(s, 'Strife Scholar // Awaken the Ages'));
  return { s, id: named(s, 'Strife Scholar // Awaken the Ages')[0]! };
}

describe('CR 722.3a, 722.3c: "This creature enters prepared": the designation and the copy of its prepare spell in exile', () => {
  it('Strife Scholar enters prepared; its controller creates a copy of Awaken the Ages in exile: a sorcery, not a card, linked to it', () => {
    const { s, id } = scholar();
    expect(s.objects[id]!.prepared).toBe(true);
    const [copy] = exileCopies(s);
    expect(copy).toBeDefined();
    expect(s.objects[copy!]).toMatchObject({ kind: 'spellCopy', zone: 'exile', preparedFor: id, owner: 'p1' });
    expect(s.objects[id]!.preparedCopy).toBe(copy);
    expect(getChars(s, copy!)).toMatchObject({ name: 'Awaken the Ages', types: ['Sorcery'] });
    expect(s.log.some((l) => l.rules?.includes('CR 722.3c'))).toBe(true);
  });

  it('CR 722.3c, 601.2i: casting the copy from exile (method "prepare", its own mana cost): the permanent loses "prepared"; the spell resolves; the copy is gone (CR 704.5e)', () => {
    let { s, id } = scholar();
    expect(castLabels(s)).toContain('Cast Awaken the Ages (prepare)');
    s = drive(act(s, { type: 'cast', player: 'p1', card: exileCopies(s)[0]!, method: 'prepare' }));
    expect(s.objects[id]!.prepared).toBeUndefined();
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(named(s, 'Spirit Token').length + named(s, 'Spirit').length).toBe(2);
    expect(exileCopies(s)).toEqual([]);
    expect(s.zones.graveyard['p1']!.some((x) => s.defs[s.objects[x]!.defId]!.name === 'Awaken the Ages')).toBe(false); // a copy of a card ceases to exist
    expect(castLabels(s)).not.toContain('Cast Awaken the Ages (prepare)');
  });

  it('CR 722.3c: with normal timing: a sorcery copy is not cast while a spell is on the stack', () => {
    let { s } = scholar({ hand: ['Lightning Bolt'], cards: ['Lightning Bolt'] });
    s = cast(s, 'Lightning Bolt', [target('p2')]);
    expect(castLabels(s)).not.toContain('Cast Awaken the Ages (prepare)');
  });

  it('CR 722.3b, 704.5e: the permanent becomes unprepared: the copy no longer stays in exile', () => {
    let { s, id } = scholar({ hand: ['Test Unprepare'], battlefield: islands(1) }, [UNPREPARE]);
    s = resolveTop(cast(s, 'Test Unprepare', [target(id)]));
    expect(s.objects[id]!.prepared).toBeUndefined();
    expect(exileCopies(s)).toEqual([]);
  });

  it('CR 722.3c, 704.5e: the permanent leaves the battlefield: the copy ceases to exist', () => {
    let { s, id } = scholar({ hand: ['Murder'], battlefield: ['Swamp', 'Swamp'], cards: ['Murder', 'Swamp'] });
    s = resolveTop(cast(s, 'Murder', [target(id)]));
    expect(exileCopies(s)).toEqual([]);
  });

  it('CR 722.4: a preparation card has only its normal characteristics in every zone, and its prepare spell is never cast from the card', () => {
    const s = scenario(['Strife Scholar // Awaken the Ages', 'Mountain'], { p1: { hand: ['Strife Scholar // Awaken the Ages'], graveyard: ['Strife Scholar // Awaken the Ages'], battlefield: mountains(9) } });
    expect(castLabels(s)).toEqual(['Cast Strife Scholar']);
    expect(getChars(s, find(s, 'Strife Scholar // Awaken the Ages', 'graveyard'))).toMatchObject({ name: 'Strife Scholar', types: ['Creature'] });
  });
});

describe('CR 722.3a: "~ becomes prepared" (Encouraging Aviator, "Whenever this creature attacks, it becomes prepared")', () => {
  it('it attacks: it becomes prepared and the copy of Jump (a blue instant) is in exile; cast during combat, it unprepares the Aviator', () => {
    let s = scenario(['Encouraging Aviator // Jump', 'Island'], { p1: { battlefield: [{ name: 'Encouraging Aviator // Jump', since: -1 }, ...islands(2)] } });
    const id = find(s, 'Encouraging Aviator // Jump', 'battlefield');
    s = declareAttackers(toDeclareAttackers(s), [[id, 'p2']]);
    s = resolveTop(drive(s));
    expect(s.objects[id]!.prepared).toBe(true);
    expect(exileCopies(s).map((c) => getChars(s, c).name)).toEqual(['Jump']);
    expect(getChars(s, exileCopies(s)[0]!)).toMatchObject({ types: ['Instant'], colors: ['U'] });
    // CR 722.3a: it can't gain the designation while it has it: becoming prepared again does nothing and makes no second copy
    const g = new Game(clone(s));
    expect(becomePrepared(g, id)).toBe(false);
    expect(exileCopies(g.s)).toHaveLength(1);
    // an instant: cast with normal timing during combat, targeting the Aviator
    s = drive(act(s, { type: 'cast', player: 'p1', card: exileCopies(s)[0]!, method: 'prepare' }), [target(id)]);
    expect(s.objects[id]!.prepared).toBeUndefined();
    s = resolveTop(s);
    expect(exileCopies(s)).toEqual([]);
  });
});

describe('CR 722.3c example: a 1/1 green Frog token copy of Encouraging Aviator, prepared, makes a blue instant named Jump', () => {
  it('the token keeps the prepare spell (CR 722.2b); its exile copy has only the prepare spell\'s characteristics, not the Frog exceptions', () => {
    let s = scenario(['Encouraging Aviator // Jump', 'Island', 'Forest'], { p1: { hand: ['Test Croaking Copy'], battlefield: ['Encouraging Aviator // Jump', ...islands(2), 'Forest'] }, defs: [FROG_COPY] });
    const aviator = find(s, 'Encouraging Aviator // Jump', 'battlefield');
    s = resolveTop(cast(s, 'Test Croaking Copy', [target(aviator)]));
    const frog = s.zones.battlefield.find((x) => s.objects[x]!.kind === 'token')!;
    expect(getChars(s, frog)).toMatchObject({ name: 'Encouraging Aviator', power: '1', toughness: '1', colors: ['G'], subtypes: ['Frog'] });
    s = drive(advanceToNextTurnAttack(s));
    s = declareAttackers(s, [[frog, 'p2']]);
    s = resolveTop(drive(s));
    expect(s.objects[frog]!.prepared).toBe(true);
    const [copy] = exileCopies(s);
    expect(getChars(s, copy!)).toMatchObject({ name: 'Jump', types: ['Instant'], colors: ['U'] });
    expect(getChars(s, copy!).subtypes).toEqual([]);
    expect(getChars(s, copy!).power).toBeUndefined();
  });
});

/** Pass to p1's next declare attackers step (turn 3), so the token is no longer summoning sick. */
function advanceToNextTurnAttack(s: GameState): GameState {
  let t = s;
  for (let i = 0; i < 200 && !(t.turn.number === 3 && t.pending?.kind === 'declareAttackers'); i++) {
    const d = t.pending!;
    if (d.kind === 'declareAttackers') t = answer(t, { kind: 'declareAttackers', attacks: [] });
    else if (d.kind === 'declareBlockers') t = answer(t, { kind: 'declareBlockers', blocks: [] });
    else t = pass(t);
  }
  return t;
}
