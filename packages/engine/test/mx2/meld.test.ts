/**
 * MX2: the meld cards' own instruction on the game path (CR 603.4, 701.42a-c, 712.4a): the intervening "if you both own and control ~ and a creature named
 * <partner>" (parser/holes/cond.ts#ownAndControl, render/cond.ts) and "exile them, then meld them into <result>" (`action: 'meldPair'`,
 * effects/handlers/meld-pair.ts). The partner and result names come from the card's own related parts (parser/parse.ts#withMeldNames). Real fixture cards.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, type GameState, type ObjectId } from '../../src/index';
import { getCard } from '../fixtures';
import { advanceTo, answer, find, findAll, pass, scenario, tweak } from '../m5/helpers';
import { activate, drive, resolveTop } from '../m5/cr-examples/helpers';
import { passUntil } from '../m4/helpers';

const RATS = 'Graf Rats';
const SCAVENGERS = 'Midnight Scavengers';
const HOST = 'Chittering Host';
const GISELA = 'Gisela, the Broken Blade';
const BRUNA = 'Bruna, the Fading Light';
const BRISELA = 'Brisela, Voice of Nightmares';

const onField = (s: GameState, defId: string): ObjectId[] => s.zones.battlefield.filter((id) => s.objects[id]!.defId === defId);

describe('MX2: the meld cards compile full on the game path', () => {
  it('Graf Rats, Gisela, Hanweir Battlements: the intervening "if" and "exile them, then meld them into ..." are automated', () => {
    for (const n of [RATS, GISELA, 'Hanweir Battlements']) expect(compileCard(getCard(n)).automation.level, n).toBe('full');
    const rats = compileCard(getCard(RATS)).faces[0]!.abilities[0]!;
    expect(rats).toMatchObject({
      kind: 'triggered',
      interveningIf: { cond: 'all', of: [{ cond: 'matches', object: { ref: 'self' }, filter: { owner: 'you', controller: 'you' } }, { cond: 'exists', of: { ref: 'each', filter: { types: ['Creature'], name: SCAVENGERS, owner: 'you', controller: 'you' } } }] },
      effect: { steps: [{ op: 'action', action: 'meldPair', who: { ref: 'you' }, arg: HOST }] },
    });
  });
});

describe('CR 603.4, 701.42a: Graf Rats and Midnight Scavengers meld into Chittering Host at the beginning of combat', () => {
  const board = (): GameState => scenario([RATS, SCAVENGERS, HOST], { p1: { battlefield: [RATS, SCAVENGERS] } });

  it('both owned and controlled: the trigger resolves and the two cards are one permanent, Chittering Host', () => {
    let s = board();
    s = passUntil(s, (x) => x.zones.stack.length > 0, 'the Graf Rats trigger');
    expect(s.turn.step).toBe('beginCombat');
    s = resolveTop(s);
    const host = onField(s, HOST);
    expect(host).toHaveLength(1);
    expect(s.objects[host[0]!]!.components?.map((c) => c.defId).sort()).toEqual([RATS, SCAVENGERS].sort());
    expect(getChars(s, host[0]!).name).toBe(HOST);
    expect(onField(s, RATS)).toEqual([]);
  });

  it('CR 603.4: Midnight Scavengers owned by the opponent: the ability does not trigger', () => {
    let s = tweak(board(), (t) => { t.objects[find(t, SCAVENGERS, 'battlefield')]!.owner = 'p2'; });
    s = passUntil(s, (x) => x.turn.step === 'beginCombat', 'the beginning of combat step');
    expect(s.zones.stack).toEqual([]);
    expect(onField(s, RATS)).toHaveLength(1);
  });

  it('CR 603.4: Midnight Scavengers leaves before the trigger resolves: it is removed from the stack and nothing is exiled', () => {
    let s = board();
    s = passUntil(s, (x) => x.zones.stack.length > 0, 'the Graf Rats trigger');
    s = tweak(s, (t) => { const id = find(t, SCAVENGERS, 'battlefield'); t.zones.battlefield = t.zones.battlefield.filter((x) => x !== id); t.zones.graveyard.p1!.push(id); t.objects[id]!.zone = 'graveyard'; });
    s = resolveTop(s);
    expect(onField(s, RATS)).toHaveLength(1);
    expect(onField(s, HOST)).toEqual([]);
  });
});

describe('CR 701.42a: Graf Rats with two creatures named Midnight Scavengers: the player chooses which one is exiled and melded', () => {
  it('the chosen one melds with Graf Rats; the other stays on the battlefield (one creature named Midnight Scavengers, never every one)', () => {
    let s = scenario([RATS, SCAVENGERS, HOST], { p1: { battlefield: [RATS, SCAVENGERS, SCAVENGERS] } });
    const both = findAll(s, SCAVENGERS, 'battlefield');
    expect(both).toHaveLength(2);
    s = passUntil(s, (x) => x.zones.stack.length > 0, 'the Graf Rats trigger');
    s = pass(pass(s));
    expect(s.pending?.kind).toBe('chooseObjects');
    s = drive(answer(s, { kind: 'chooseObjects', ids: [both[1]!] }));
    expect(onField(s, HOST)).toHaveLength(1);
    expect(s.zones.battlefield).toContain(both[0]);
    expect(s.zones.battlefield).not.toContain(both[1]);
  });

  it('Gisela and Bruna meld into Brisela at the beginning of the end step', () => {
    let s = scenario([GISELA, BRUNA, BRISELA], { p1: { battlefield: [GISELA, BRUNA] } });
    s = advanceTo(s, 1, 'end');
    expect(s.zones.stack).toHaveLength(1);
    s = resolveTop(s);
    expect(onField(s, BRISELA)).toHaveLength(1);
  });
});

describe('Hanweir Battlements (an activated ability with the "if" in its effect)', () => {
  it('with Hanweir Garrison owned and controlled: Hanweir, the Writhing Township; without it: nothing is exiled', () => {
    const lands = ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Mountain'];
    let s = scenario(['Hanweir Battlements', 'Hanweir Garrison', 'Hanweir, the Writhing Township', 'Mountain'], { p1: { battlefield: ['Hanweir Battlements', 'Hanweir Garrison', ...lands] } });
    s = resolveTop(activate(s, find(s, 'Hanweir Battlements', 'battlefield'), [], /meld/));
    expect(onField(s, 'Hanweir, the Writhing Township')).toHaveLength(1);
    let t = scenario(['Hanweir Battlements', 'Hanweir, the Writhing Township', 'Mountain'], { p1: { battlefield: ['Hanweir Battlements', ...lands] } });
    t = resolveTop(activate(t, find(t, 'Hanweir Battlements', 'battlefield'), [], /meld/));
    expect(onField(t, 'Hanweir Battlements')).toHaveLength(1);
    expect(t.zones.exile).toEqual([]);
  });
});

describe('"on your turn" (CR 603.2, 505.1)', () => {
  it('Graf Rats triggers only on its controller\'s turn ("on your turn")', () => {
    let s = scenario([RATS, SCAVENGERS, HOST], { p2: { battlefield: [RATS, SCAVENGERS] } });
    s = advanceTo(s, 1, 'main2');
    expect(onField(s, RATS)).toHaveLength(1);
  });
});
