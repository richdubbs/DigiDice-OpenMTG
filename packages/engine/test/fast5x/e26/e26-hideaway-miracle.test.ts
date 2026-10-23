/**
 * FAST5X E26: hideaway (CR 702.75a) and miracle (CR 702.94a-b) on the game path with real fixture cards.
 *  - Hideaway N: "When this permanent enters, look at the top N cards of your library. Exile one of them face down and put the rest on the bottom of your library
 *    in a random order." The exiled card is linked to the permanent (CR 607.2a): "you may play the exiled card without paying its mana cost" plays a land card as
 *    a land (CR 305.9; only on its controller's turn with a land play left, CR 305.2a-b, 305.3) and casts any other card for free (CR 118.9, 608.2g).
 *  - Miracle [cost]: the first card a player draws in a turn may be revealed as it is drawn; the linked triggered ability then lets them cast it by paying the
 *    miracle cost rather than its mana cost (CR 702.94a, 118.9), at any time (CR 608.2g). A miracle ability another object grants counts (CR 613.1f).
 */
import { describe, expect, it } from 'vitest';
import { compileCard, getChars, legalActions, type GameState } from '../../../src/index';
import { getCard } from '../../fixtures';
import { activate } from '../../m5/cr-examples/helpers';
import { act, answer, drive, find, lands, next, onField, resolveTop, scenario } from '../../m6/dfc/support';

const CLIVE = "Clive's Hideaway"; // Land -- Town, Hideaway 4, {T}: Add {C}; {2}, {T}: play the exiled card free if you control four or more legendary creatures
const LOREHOLD = 'Lorehold, the Historian'; // {3}{R}{W} 5/5; "Each instant and sorcery card in your hand has miracle {2}."
const LEGENDS = ['Frodo Baggins', 'Belladonna Took', 'Gandalf, Friend of the Shire', 'Echo, Perceptive Prodigy'];

const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.defs[s.objects[id]!.defId]!.name);
const lib = (s: GameState): string[] => names(s, s.zones.library['p1']!);

describe('FAST5X E26: hideaway and miracle cards compile full', () => {
  it("Clive's Hideaway and Lorehold, the Historian are full", () => {
    for (const name of [CLIVE, LOREHOLD]) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
});

describe('CR 702.75a: hideaway', () => {
  const board = (legends: string[], library: string[]): GameState =>
    scenario([CLIVE, 'Plains', 'Grizzly Bears', 'Forest', 'Island', 'Mountain', ...LEGENDS], { p1: { hand: [CLIVE], library, battlefield: [...lands('Plains', 2), ...legends] } });
  /** p1 plays Clive's Hideaway; its hideaway trigger resolves and p1 exiles `pick` of the top four cards. */
  function hide(s0: GameState, pick: string): GameState {
    let s = drive(act(s0, { type: 'playLand', player: 'p1', card: find(s0, CLIVE, 'hand') }));
    expect(names(s, s.zones.stack)).toEqual([CLIVE]); // the hideaway trigger (CR 603.3)
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'chooseObjects', min: 1, max: 1 });
    const options = (s.pending as { options: string[] }).options;
    expect(names(s, options).sort()).toEqual(['Forest', 'Grizzly Bears', 'Island', 'Mountain']);
    return drive(answer(s, { kind: 'chooseObjects', ids: options.filter((id) => names(s, [id])[0] === pick) }));
  }

  it('looks at the top four, exiles one face down linked to the land, puts the rest on the bottom', () => {
    const s = hide(board(LEGENDS, ['Grizzly Bears', 'Forest', 'Island', 'Mountain']), 'Grizzly Bears');
    const exiled = s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1');
    expect(exiled).toHaveLength(1);
    expect(s.objects[exiled[0]!]!.faceDown).toBe(true); // CR 406.3
    expect(lib(s).slice(0, 3)).toEqual(['Plains', 'Plains', 'Plains']);
    expect(lib(s).slice(-3).sort()).toEqual(['Forest', 'Island', 'Mountain']); // the rest on the bottom, in a random order
    expect(s.objects[onField(s, CLIVE)]!.links?.['exiled']).toBeDefined(); // CR 607.2a
  });

  it('with four legendary creatures: {2}, {T} casts the exiled creature card without paying its mana cost', () => {
    let s = hide(board(LEGENDS, ['Grizzly Bears', 'Forest', 'Island', 'Mountain']), 'Grizzly Bears');
    s = activate(s, onField(s, CLIVE), [], /exiled card/);
    s = resolveTop(s);
    // "you may": the play is offered (CR 608.2d), then the cast (CR 608.2g)
    while (s.pending && s.pending.kind !== 'priority') {
      if (s.pending.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [s.pending.options[0]!.id] });
      else if (s.pending.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: true });
      else s = drive(s);
    }
    expect(names(s, s.zones.stack)).toEqual(['Grizzly Bears']);
    s = resolveTop(s);
    expect(names(s, s.zones.battlefield)).toContain('Grizzly Bears');
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1')).toHaveLength(0);
  });

  it('with three legendary creatures the ability does nothing (CR 608.2c)', () => {
    let s = hide(board(LEGENDS.slice(0, 3), ['Grizzly Bears', 'Forest', 'Island', 'Mountain']), 'Grizzly Bears');
    s = resolveTop(activate(s, onField(s, CLIVE), [], /exiled card/));
    expect(s.pending?.kind).toBe('priority');
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1')).toHaveLength(1);
  });

  it('an exiled land is PLAYED, never cast: not after the land play of the turn (CR 305.2b), then as the land play of a later turn (CR 305.2a, 305.9)', () => {
    let s = hide(board(LEGENDS, ['Forest', 'Grizzly Bears', 'Island', 'Mountain']), 'Forest');
    // Clive's Hideaway itself was this turn's land play
    s = resolveTop(activate(s, onField(s, CLIVE), [], /exiled card/));
    expect(s.zones.exile.filter((id) => s.objects[id]!.owner === 'p1')).toHaveLength(1);
    expect(s.log.some((l) => /can't play a face-down card now: You have already played a land/.test(l.text))).toBe(true); // its name stays hidden (CR 406.3)
    // next turn of p1: untapped again, no land played yet
    for (let i = 0; i < 400 && !(s.turn.activePlayer === 'p1' && s.turn.number > 1 && s.turn.step === 'main1' && s.pending?.kind === 'priority'); i++) {
      s = s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) }) : next(s);
    }
    s = resolveTop(activate(s, onField(s, CLIVE), [], /exiled card/));
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    expect((s.pending as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(['land']); // a land card can't be cast (CR 305.9)
    s = drive(answer(s, { kind: 'chooseOption', ids: ['land'] }));
    expect(names(s, s.zones.battlefield)).toContain('Forest');
    expect(s.players.find((p) => p.id === 'p1')!.landsPlayedThisTurn).toBe(1);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'playLand')).toBe(false);
  });
});

describe('CR 702.94a: miracle (granted by Lorehold, the Historian)', () => {
  const board = (top: string): GameState =>
    scenario([LOREHOLD, 'Lightning Bolt', 'Grizzly Bears', 'Mountain'], { p1: { battlefield: [LOREHOLD, ...lands('Mountain', 3)] }, p2: { library: [top], battlefield: ['Grizzly Bears'] } }).valueOf() as GameState;

  it('Lorehold grants miracle {2} to the instants and sorceries in its controller\'s hand (CR 613.1f)', () => {
    const s = scenario([LOREHOLD, 'Lightning Bolt', 'Grizzly Bears'], { p1: { hand: ['Lightning Bolt', 'Grizzly Bears'], battlefield: [LOREHOLD] } });
    const kws = (name: string): string[] => getChars(s, find(s, name, 'hand')).keywords.map((k) => k.keyword);
    expect(kws('Lightning Bolt')).toContain('miracle');
    expect(kws('Grizzly Bears')).not.toContain('miracle');
  });

  it('the first card drawn in a turn may be revealed; the trigger casts it for the miracle cost', () => {
    // p1's library: Lightning Bolt on top. Go to p1's next turn: the draw step draw is the first card drawn that turn.
    let s = scenario([LOREHOLD, 'Lightning Bolt', 'Grizzly Bears', 'Mountain'], { p1: { library: ['Lightning Bolt'], battlefield: [LOREHOLD, ...lands('Mountain', 3)] }, p2: { battlefield: ['Grizzly Bears'] } });
    for (let i = 0; i < 400 && !(s.pending?.kind === 'chooseOption' && /miracle/.test((s.pending as { prompt: string }).prompt)); i++) {
      s = s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) }) : next(s);
    }
    expect(s.turn.activePlayer).toBe('p1');
    expect(s.turn.step).toBe('draw');
    s = answer(s, { kind: 'chooseOption', ids: ['0'] });
    const bolt = find(s, 'Lightning Bolt', 'hand');
    expect(s.objects[bolt]!.revealedTo).toContain('p2'); // CR 702.94b
    // the miracle trigger goes on the stack (CR 603.3); as it resolves, p1 may cast the Bolt for {2}
    s = drive(s);
    expect(s.zones.stack.length).toBe(1);
    s = resolveTop(s);
    expect(s.pending).toMatchObject({ kind: 'yesNo' });
    s = answer(s, { kind: 'yesNo', yes: true });
    s = drive(s, [{ kind: 'chooseTargets', targets: [{ kind: 'player', id: 'p2' }] }]);
    expect(names(s, s.zones.stack)).toEqual(['Lightning Bolt']);
    expect(s.zones.battlefield.filter((id) => s.objects[id]!.tapped && names(s, [id])[0] === 'Mountain')).toHaveLength(2); // {2}, not {R}
    const life = s.players.find((p) => p.id === 'p2')!.life;
    s = resolveTop(s);
    expect(s.players.find((p) => p.id === 'p2')!.life).toBe(life - 3);
  });

  it('without the grant (no Lorehold) a drawn instant offers no miracle', () => {
    let s = scenario(['Lightning Bolt', 'Mountain'], { p1: { library: ['Lightning Bolt'], battlefield: lands('Mountain', 3) } });
    for (let i = 0; i < 60 && !(s.turn.activePlayer === 'p1' && s.turn.number > 1 && s.turn.step === 'main1'); i++) {
      expect(s.pending?.kind === 'chooseOption' && /miracle/.test((s.pending as { prompt: string }).prompt)).toBe(false);
      s = s.pending?.kind === 'chooseObjects' ? answer(s, { kind: 'chooseObjects', ids: s.pending.options.slice(0, s.pending.min) }) : next(s);
    }
    expect(find(s, 'Lightning Bolt', 'hand')).toBeDefined();
  });
  void board;
});
