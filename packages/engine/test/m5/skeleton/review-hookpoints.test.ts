/**
 * WP0 review: the frozen hook signatures carry what the call-sites know, so WP16 can express the rules it must deliver without another interface change.
 *  (a) canCast knows the face (CR 709.3a: only the chosen half of a split card is evaluated) and the way it is cast;
 *  (b) the boolean queries know the game, the object and the player ("as though it had flash / haste", CR 702.8a, 702.10b);
 *  (c) a permission can waive the denial that a keyword rule itself produces ("can attack as though it didn't have defender", CR 702.3b), and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { deny, waivable } from '../../../src/rules/denial';
import { createHookpoints, gameOf, hookpoints, type RuleHookProvider } from '../../../src/rules/hookpoints';
import { advanceTo, activated, declareAttackers, find, legal, pass, scenario, synth, targetPlayer, toDeclareAttackers, withStatics } from '../helpers';

const g = (s: GameState) => gameOf(s);
const mk = (p: Partial<RuleHookProvider>): RuleHookProvider => ({ name: 'statics', ...p });

describe('CR 709.3a: canCast is told which half of a split card is being cast, and how', () => {
  const s = scenario(['Fire // Ice', 'Mountain', 'Island'], { p1: { hand: ['Fire // Ice'], battlefield: ['Mountain', 'Mountain', 'Island', 'Island'] } });

  it('the real castCheck passes the requested face and the cast method: a provider sees Fire (face 0) and Ice (face 1) separately', () => {
    const seen: string[] = [];
    withStatics({ canCast: (_g, _spell, player, face, via) => { seen.push(`${player}|${face}|${via.method ?? '-'}|${via.fused === true}`); return null; } }, () => {
      expect(legal(s, 'p1', 'cast').map((a) => a.label).sort()).toEqual(['Cast Fire', 'Cast Ice']);
    });
    expect(seen).toContain('p1|0|-|false');
    expect(seen).toContain('p1|1|-|false');
  });

  it('a restriction on one half only ("can\'t cast spells with mana value 2 or less" style) removes that half and leaves the other', () => {
    withStatics({ canCast: (_g, _spell, _player, face) => (face === 1 ? deny("Test: can't cast Ice.", 'CR 101.2') : null) }, () => {
      expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Fire']);
    });
  });

  it('the hookpoints forward face and via unchanged', () => {
    let got = '';
    const hp = createHookpoints(() => [mk({ canCast: (_g, spell, player, face, via) => { got = `${spell}|${player}|${face}|${via.method}|${via.fused}`; return null; } })]);
    hp.canCast(g(s), 'o1', 'p1', 1, { method: 'flashback', fused: false });
    expect(got).toBe('o1|p1|1|flashback|false');
  });
});

describe('CR 702.8a, 702.10b, 702.20b: the boolean queries know the game, the object and the player (Vedalken Orrery, Thousand-Year Elixir)', () => {
  it('"you may cast spells as though they had flash": a provider that answers for one player makes a creature castable on the opponent\'s turn for that player only', () => {
    let s = scenario(['Grizzly Bears', 'Forest'], { p1: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] }, p2: { hand: ['Grizzly Bears'], battlefield: ['Forest', 'Forest'] } });
    s = advanceTo(s, 2, 'main1'); // Bob's turn
    s = pass(s);
    expect(s.pending!.player).toBe('p1');
    expect(legal(s, 'p1', 'cast')).toEqual([]); // CR 117.1a: not an instant, no flash
    const calls: string[] = [];
    withStatics({ castsAsInstant: (gm, spell, player, c) => { calls.push(`${spell}|${player}|${c.name}|${gm.s.turn.number}`); return player === 'p1' ? true : undefined; } }, () => {
      expect(legal(s, 'p1', 'cast').map((a) => a.label)).toEqual(['Cast Grizzly Bears']);
    });
    expect(calls.some((x) => x.endsWith('|p1|Grizzly Bears|2'))).toBe(true);
    withStatics({ castsAsInstant: (_g, _spell, player) => (player === 'p2' ? true : undefined) }, () => {
      expect(legal(s, 'p1', 'cast')).toEqual([]);
    });
  });

  it('"activate abilities as though they had haste": the provider is asked about the permanent, its controller and its characteristics', () => {
    const pinger = synth({ name: 'Test Pinger', cost: '{1}{R}', type: 'Creature — Wizard', pt: ['1', '1'], abilities: [activated('{T}: Ping target player.', { tap: true }, [targetPlayer])] });
    const s = scenario([], { p1: { battlefield: [{ name: 'Test Pinger', since: 1 }] }, defs: [pinger] });
    const pingerId = find(s, 'Test Pinger', 'battlefield');
    expect(legal(s, 'p1', 'activate')).toEqual([]); // CR 302.6: summoning sick
    const asked: string[] = [];
    withStatics({ summoningSick: (_g, object, player, c) => { asked.push(`${object}|${player}|${c.name}`); return false; } }, () => {
      expect(legal(s, 'p1', 'activate')).toHaveLength(1);
    });
    expect(asked).toContain(`${pingerId}|p1|Test Pinger`);
  });

  it('attackTaps: a provider is asked about the attacker and its controller, and its answer decides whether the attacker taps (CR 508.1f)', () => {
    const base = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(base, 'Grizzly Bears', 'battlefield');
    const attack = (): GameState => declareAttackers(toDeclareAttackers(base), [[bears]]);
    expect(attack().objects[bears]!.tapped).toBe(true);
    const asked: string[] = [];
    const s = withStatics({ attackTaps: (_g, object, player) => { asked.push(`${object}|${player}`); return false; } }, attack);
    expect(s.objects[bears]!.tapped).toBe(false);
    expect(asked).toEqual([`${bears}|p1`]);
  });

  it('the hookpoints forward (game, object, player, characteristics) and keep their defaults when no provider answers', () => {
    const s = scenario(['Grizzly Bears'], { p1: { battlefield: ['Grizzly Bears'] } });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    const c = getChars(s, bears);
    const none = createHookpoints(() => [mk({})]);
    expect([none.attackTaps(g(s), bears, 'p1', c), none.summoningSick(g(s), bears, 'p1', c), none.castsAsInstant(g(s), bears, 'p1', c)]).toEqual([true, true, false]);
    const rec: string[] = [];
    const hp = createHookpoints(() => [mk({
      attackTaps: (_g, o, p, ch) => { rec.push(`t|${o}|${p}|${ch.name}`); return undefined; },
      summoningSick: (_g, o, p, ch) => { rec.push(`s|${o}|${p}|${ch.name}`); return undefined; },
      castsAsInstant: (_g, o, p, ch) => { rec.push(`i|${o}|${p}|${ch.name}`); return undefined; },
    })]);
    hp.attackTaps(g(s), bears, 'p1', c);
    hp.summoningSick(g(s), bears, 'p1', c);
    hp.castsAsInstant(g(s), bears, 'p1', c);
    expect(rec).toEqual([`t|${bears}|p1|Grizzly Bears`, `s|${bears}|p1|Grizzly Bears`, `i|${bears}|p1|Grizzly Bears`]);
  });
});

describe('CR 702.3b, 509.1b, 609.4: a permission waives the denial of the keyword rule it names, never another denial', () => {
  const s = scenario(['Wall of Stone', 'Grizzly Bears', 'Serra Angel'], { p1: { battlefield: ['Wall of Stone', 'Grizzly Bears'] }, p2: { battlefield: ['Serra Angel'] } });
  const wall = find(s, 'Wall of Stone', 'battlefield');
  const bears = find(s, 'Grizzly Bears', 'battlefield');
  const angel = find(s, 'Serra Angel', 'battlefield');

  it('baseline: defender denies the attack, flying denies the block', () => {
    expect(hookpoints.canAttack(g(s), wall, 'p2')?.rules).toContain('CR 702.3b');
    expect(hookpoints.canBlock(g(s), bears, angel)?.rules).toContain('CR 702.9b');
  });

  it('attackAsThoughNoDefender: the permission for THIS creature removes the defender denial; for another creature it does not', () => {
    withStatics({ permits: (_g, q) => q.action === 'attackAsThoughNoDefender' && q.subject === wall }, () => {
      expect(hookpoints.canAttack(g(s), wall, 'p2')).toBeNull();
    });
    withStatics({ permits: (_g, q) => q.action === 'attackAsThoughNoDefender' && q.subject === bears }, () => {
      expect(hookpoints.canAttack(g(s), wall, 'p2')?.rules).toContain('CR 702.3b');
    });
  });

  it('a real attack declaration offers the walled creature as an attacker when the permission applies (the combat candidates use the same hook)', () => {
    const t = toDeclareAttackers(s);
    expect(t.pending).toMatchObject({ kind: 'declareAttackers' });
    const ids = (d: GameState): string[] => (d.pending as { candidates: { id: string }[] }).candidates.map((c) => c.id);
    expect(ids(t)).not.toContain(wall);
    const u = withStatics({ permits: (_g, q) => q.action === 'attackAsThoughNoDefender' && q.subject === wall }, () => toDeclareAttackers(s));
    expect(ids(u)).toContain(wall);
  });

  it('a denial that is not the keyword\'s own (a "can\'t attack" effect) is NOT waived by the same permission', () => {
    const cant = deny("Test: can't attack.", 'CR 508.1c');
    const hp = createHookpoints(() => [mk({ canAttack: () => cant }), mk({ permits: () => true }), { name: 'keywords', canAttack: () => waivable(deny('defender', 'CR 702.3b'), 'attackAsThoughNoDefender') }]);
    expect(hp.canAttack(g(s), wall, 'p2')).toBe(cant);
  });

  it('blockAsThough names the evasion it ignores: permission to ignore shadow does not let a blocker ignore flying', () => {
    withStatics({ permits: (_g, q) => q.action === 'blockAsThough' && q.asThough === 'shadow' && q.subject === bears }, () => {
      expect(hookpoints.canBlock(g(s), bears, angel)?.rules).toContain('CR 702.9b');
    });
    withStatics({ permits: (_g, q) => q.action === 'blockAsThough' && q.asThough === 'flying' && q.subject === bears && q.other === angel }, () => {
      expect(hookpoints.canBlock(g(s), bears, angel)).toBeNull();
    });
  });

  it('with no provider granting anything the keyword denials are exactly what they were', () => {
    expect(hookpoints.canAttack(g(s), bears, 'p2')).toBeNull();
    expect(hookpoints.canBlock(g(s), bears, angel)?.message).toMatch(/flying/);
  });
});
