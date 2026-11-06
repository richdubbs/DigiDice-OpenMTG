/**
 * edh-d-99 (Commander coordinator D, EDHREC ranks 5,001-10,000, group graveyard-exile-cast): the round's readings played through the engine with synthetic cards compiled by the game's
 * default compiler (invented names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (media.wizards.com MagicCompRules 20260925.txt).
 *
 *   CR 701.23a, 701.23d, 401.4, 608.2c   "Search your library and graveyard for N cards and exile the rest. Put the chosen cards on top of your library in any order." (Doomsday)
 *   CR 122.1f, 406.3, 601.3, 609.4b      "each opponent who has N or more poison counters exiles the top card of their library face down. You may look at and play those cards ..." (Ixhel)
 *   CR 603.12, 700.2, 118.12             "you may pay {G} up to three times. When you pay this cost one or more times, choose up to that many --" (Tranquil Frillback)
 *   CR 608.2c, 101.4, 119.4, 202.3       "repeat the following process for each opponent in turn order. Reveal the top card ... may pay life equal to that card's mana value ..." (Protection Racket)
 *   CR 701.21a, 202.3, 608.2d, 611.2a    "Target opponent sacrifices a creature or planeswalker they control with the greatest mana value among ..."; "Until your next end step, you may play those cards." (Riveteers Charm)
 *   CR 724.1, 102.1, 608.2d              "{T}: The player whose turn it is may end the turn." (Obeka, Brute Chronologist)
 *   CR 103.6b, 603.7a, 701.20e, 406.1    "You may reveal this card from your opening hand. If you do, at the beginning of your first upkeep, look at the top four ... Exile the rest." (Devourer of Destiny)
 *   CR 608.2c, 101.4, 607.2a, 609.4b     "Then you may exile a creature or planeswalker card from each graveyard." / "Until end of turn, you may cast spells from among cards exiled with this Saga, ..." (King Narfi's Betrayal)
 *   CR 702.1, 404.1, 611.2c, 702.11d     "creatures you control gain flying until end of turn if a creature card in your graveyard has flying. The same is true for ..." (Bleeding Effect)
 *   CR 205.4e, 608.2h, 402.1, 406.1      "Destroy target creature. If its controller has more than four cards in hand, they exile cards from their hand equal to the difference." (Isildur's Fateful Strike)
 */
import { describe, expect, it } from 'vitest';
import { compileCard, createGame, getChars, legalActions, type CardDef, type GameConfig, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[]; loyalty?: string } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}), ...(opts.loyalty ? { loyalty: opts.loyalty } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: string): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: (string[] | ((options: string[], s: GameState) => string[]))[]; options?: (string[] | ((p: { min: number; max: number; options: { id: string }[] }) => string[]))[]; order?: ((ids: string[], s: GameState) => string[])[]; numbers?: number[] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 200 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') { const f = script.order?.shift(); const ids = p.items.map((i) => i.id); s = answer(s, { kind: 'order', ids: f ? f(ids, s) : ids }); }
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') { const o = script.options?.shift(); s = answer(s, { kind: 'chooseOption', ids: typeof o === 'function' ? o(p) : o ?? p.options.slice(0, p.min).map((x) => x.id) }); }
    else if (p.kind === 'declareAttackers') s = answer(s, { kind: 'declareAttackers', attacks: [] });
    else if (p.kind === 'declareBlockers') s = answer(s, { kind: 'declareBlockers', blocks: [] });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: script.numbers?.shift() ?? p.min });
    else throw new Error(`unexpected decision ${p.kind}: ${JSON.stringify(p)}`);
  }
  return s;
}
/** Everyone passes until the stack is empty again, answering what comes up. */
function settle(s0: GameState, script: Script = {}): GameState {
  let s = drive(s0, script);
  for (let guard = 0; s.zones.stack.length > 0 && s.pending?.kind === 'priority' && guard < 60; guard++) s = drive(act(s, { type: 'pass', player: s.pending.player }), script);
  return s;
}
const names = (s: GameState, ids: readonly string[]): string[] => ids.map((id) => s.objects[id]!.defId);
const gy = (s: GameState, p: PlayerId): string[] => names(s, s.zones.graveyard[p]!);
const lib = (s: GameState, p: PlayerId): string[] => names(s, s.zones.library[p]!);
const exileOf = (s: GameState, p: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === p).map((id) => s.objects[id]!.defId);
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;
const byName = (s: GameState, wanted: readonly string[]) => (options: string[]): string[] => {
  const left = [...wanted];
  return options.filter((id) => { const k = left.indexOf(s.objects[id]!.defId); if (k < 0) return false; left.splice(k, 1); return true; });
};
void obj;

// ---- Doomsday: "Search your library and graveyard for five cards and exile the rest. Put the chosen cards on top of your library in any order. You lose half your life, rounded up." ----

const DOOM = card('Test Bleak Reckoning', 'Sorcery', 'Search your library and graveyard for five cards and exile the rest. Put the chosen cards on top of your library in any order. You lose half your life, rounded up.');
const DRAWN = card('Test Drawn Card', 'Instant', 'You gain 2 life.');
const C = ['Test Ash Card A', 'Test Ash Card B', 'Test Ash Card C', 'Test Ash Card D', 'Test Ash Card E', 'Test Ash Card F'].map((n) => card(n, 'Instant', 'You gain 1 life.'));

describe('CR 701.23a, 701.23d, 401.4, 608.2c (Doomsday): search the library and graveyard for exactly five cards, exile every other card of both zones, put the five on top in any order', () => {
  const setup = (o: { library?: string[]; graveyard?: string[]; life?: number; noFill?: boolean } = {}): GameState => mpScenario({
    defs: [DOOM, DRAWN, ...C], zones: { p1: { hand: ['Test Bleak Reckoning'], library: ['Test Drawn Card', ...(o.library ?? [])], graveyard: o.graveyard ?? [] }, p2: { graveyard: ['Test Ash Card A'] } },
    setup: (s) => {
      if (o.life !== undefined) s.players.find((x) => x.id === 'p1')!.life = o.life;
      if (o.noFill === true) { for (const id of s.zones.library.p1!.filter((x) => s.objects[x]!.defId === 'Plains')) delete s.objects[id]; s.zones.library.p1 = s.zones.library.p1!.filter((x) => s.objects[x] !== undefined); }
    },
  });
  const cast = (s: GameState, script: Script): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Bleak Reckoning', 'hand', 'p1') }), script);
  it('is automated', () => expect(full(DOOM)).toBe(true));
  it('the five chosen cards (from both zones) end on top in the chosen order, the rest of the library and graveyard is exiled, the spell itself goes to the graveyard; half the life (rounded up) is lost; another player\'s graveyard is untouched', () => {
    const s0 = setup({ library: ['Test Ash Card A', 'Test Ash Card B', 'Test Ash Card C'], graveyard: ['Test Ash Card D', 'Test Ash Card E', 'Test Ash Card F'], life: 7 });
    const pick = ['Test Ash Card B', 'Test Ash Card C', 'Test Ash Card D', 'Test Ash Card E', 'Test Ash Card F'];
    const order = ['Test Ash Card E', 'Test Ash Card B', 'Test Ash Card F', 'Test Ash Card C', 'Test Ash Card D'];
    const s = cast(s0, { objects: [(opts, st) => byName(st, pick)(opts)], order: [(ids, st) => [...ids].sort((a, b) => order.indexOf(st.objects[a]!.defId) - order.indexOf(st.objects[b]!.defId))] });
    expect(s.zones.stack.length).toBe(0);
    expect(lib(s, 'p1')).toEqual(order);
    expect(gy(s, 'p1')).toEqual(['Test Bleak Reckoning']);
    expect(exileOf(s, 'p1').filter((n) => n === 'Plains').length).toBe(20);
    expect(exileOf(s, 'p1')).toContain('Test Ash Card A');
    expect(lifeOf(s, 'p1')).toBe(3); // 7 - ceil(7/2)
    expect(gy(s, 'p2')).toEqual(['Test Ash Card A']);
    expect(lib(s, 'p2').length).toBe(20);
  });
  it('ruling 2018-03-16: with five or more cards the player must choose exactly five (the choice offers no fewer)', () => {
    const s0 = setup({ graveyard: ['Test Ash Card A'] });
    let seen: { min: number; max: number } | undefined;
    const s = cast(s0, { objects: [(opts, st) => { const p = st.pending as { min: number; max: number }; seen = { min: p.min, max: p.max }; return opts.slice(0, 5); }] });
    expect(seen).toEqual({ min: 5, max: 5 });
    expect(lib(s, 'p1').length).toBe(5);
    expect(lifeOf(s, 'p1')).toBe(10);
  });
  it('ruling 2018-03-16: with fewer than five cards in library and graveyard together, all of them end in the library and nothing is exiled', () => {
    const s0 = setup({ library: ['Test Ash Card A', 'Test Ash Card B'], graveyard: ['Test Ash Card C'], noFill: true });
    expect(lib(s0, 'p1')).toEqual(['Test Ash Card A', 'Test Ash Card B']);
    const s = cast(s0, {});
    expect([...lib(s, 'p1')].sort()).toEqual(['Test Ash Card A', 'Test Ash Card B', 'Test Ash Card C']);
    expect(exileOf(s, 'p1')).toEqual([]);
    expect(gy(s, 'p1')).toEqual(['Test Bleak Reckoning']);
  });
});

// ---- Ixhel, Scion of Atraxa: "At the beginning of your end step, each opponent who has three or more poison counters exiles the top card of their library face down. You may look at and
// play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast those spells." -----------------------------------------------

const IXHEL = card('Test Venom Scion', 'Legendary Creature — Phyrexian Angel', 'Flying, vigilance, toxic 2\nCorrupted — At the beginning of your end step, each opponent who has three or more poison counters exiles the top card of their library face down. You may look at and play those cards for as long as they remain exiled, and you may spend mana as though it were mana of any color to cast those spells.', { pt: ['5', '5'] });
const BOLT = card('Test Red Jolt', 'Instant', 'You gain 3 life.', { cost: '{R}', colors: ['R'] });
const BOLT2 = card('Test Blue Jolt', 'Instant', 'You gain 4 life.', { cost: '{U}', colors: ['U'] });
const BOLT3 = card('Test Green Jolt', 'Instant', 'You gain 5 life.', { cost: '{G}', colors: ['G'] });
const ZAP = card('Test Zap Bolt', 'Instant', 'Target creature gets -5/-5 until end of turn.');
const toEndStep = (s0: GameState): GameState => {
  let s = s0;
  for (let guard = 0; guard < 200 && !(s.turn.step === 'end' && s.zones.stack.length > 0); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
  return s;
};
const canCastFromExile = (s: GameState, p: PlayerId, name: string): boolean => legalActions(s, p).some((a) => a.kind === 'cast' && s.objects[a.object as string]?.defId === name && s.objects[a.object as string]?.zone === 'exile');

describe('CR 122.1f, 406.3, 601.3, 609.4b (Ixhel): each opponent with at least three poison counters exiles their top card face down; its controller may look at and play them, spending mana as though of any color', () => {
  const setup = (): GameState => mpScenario({
    defs: [IXHEL, BOLT, BOLT2, BOLT3, ZAP],
    zones: { p1: { battlefield: ['Test Venom Scion', 'Plains', 'Plains'], hand: ['Test Zap Bolt'] }, p2: { library: ['Test Red Jolt'] }, p3: { library: ['Test Blue Jolt'] }, p4: { library: ['Test Green Jolt'] } },
    setup: (s) => { s.players.find((x) => x.id === 'p2')!.poison = 3; s.players.find((x) => x.id === 'p3')!.poison = 2; s.players.find((x) => x.id === 'p4')!.poison = 9; },
  });
  it('is automated', () => expect(full(IXHEL)).toBe(true));
  it('only the opponents with three or more poison counters exile their top card, face down; the controller may cast those (paying {R} or {G} with a Plains), not the others\' cards', () => {
    let s = toEndStep(setup());
    s = settle(s);
    const exiled = s.zones.exile.map((id) => s.objects[id]!);
    expect(exiled.map((o) => o.defId).sort()).toEqual(['Test Green Jolt', 'Test Red Jolt']);
    expect(exiled.every((o) => o.faceDown === true)).toBe(true);
    expect(lib(s, 'p3')[0]).toBe('Test Blue Jolt');
    expect(s.turn.step).toBe('end');
    expect(s.pending?.player).toBe('p1');
    expect(canCastFromExile(s, 'p1', 'Test Red Jolt')).toBe(true);
    expect(canCastFromExile(s, 'p1', 'Test Green Jolt')).toBe(true);
    expect(canCastFromExile(s, 'p2', 'Test Red Jolt')).toBe(false);
    const before = lifeOf(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Red Jolt')! }));
    expect(lifeOf(s, 'p1')).toBe(before + 3);
    expect(gy(s, 'p2')).toContain('Test Red Jolt'); // its owner's graveyard (CR 400.3)
    expect(canCastFromExile(s, 'p1', 'Test Green Jolt')).toBe(true); // the other exiled card stays playable (each for as long as it remains exiled), paid with the second Plains
  });
  it('ruling 2023-02-04: the exiled cards stay playable after Ixhel leaves the battlefield', () => {
    let s = settle(toEndStep(setup()));
    const ix = s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Venom Scion')!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Zap Bolt', 'hand', 'p1') }), { targets: [[obj(ix)]] });
    expect(s.zones.battlefield.includes(ix)).toBe(false);
    expect(canCastFromExile(s, 'p1', 'Test Green Jolt')).toBe(true);
  });
  it('negative: with no opponent at three or more poison counters nothing is exiled', () => {
    const s0 = mpScenario({ defs: [IXHEL, BOLT], zones: { p1: { battlefield: ['Test Venom Scion'] }, p2: { library: ['Test Red Jolt'] } }, setup: (st) => { st.players.find((x) => x.id === 'p2')!.poison = 2; } });
    const s = settle(toEndStep(s0));
    expect(s.zones.exile).toEqual([]);
    expect(lib(s, 'p2')[0]).toBe('Test Red Jolt');
  });
});

// ---- Tranquil Frillback: "When this creature enters, you may pay {G} up to three times. When you pay this cost one or more times, choose up to that many -- ..." --------------------------

const FRILL = card('Test Calm Frillhorn', 'Creature — Dinosaur', 'When this creature enters, you may pay {G} up to three times. When you pay this cost one or more times, choose up to that many —\n• Destroy target artifact or enchantment.\n• Exile target player\'s graveyard.\n• You gain 4 life.', { pt: ['3', '3'] });
const RELIC = card('Test Brass Relic', 'Artifact', '');
const GY = card('Test Grave Dust', 'Instant', 'You gain 1 life.');

describe('CR 603.12, 700.2, 118.12 (Tranquil Frillback, ruling 2023-05-12): pay {G} up to three times; the reflexive trigger of a payment made one or more times chooses up to that many modes', () => {
  const setup = (): GameState => mpScenario({
    defs: [FRILL, RELIC, GY], cards: ['Forest'],
    zones: { p1: { hand: ['Test Calm Frillhorn'], battlefield: ['Forest', 'Forest', 'Forest'] }, p2: { battlefield: ['Test Brass Relic'], graveyard: ['Test Grave Dust', 'Test Grave Dust'] } },
  });
  const relic = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Brass Relic')!;
  const enter = (s0: GameState, times: number, script: Script): GameState => {
    let s = act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Calm Frillhorn', 'hand', 'p1') });
    return settle(s, { numbers: [times], yes: [true, true, true], ...script });
  };
  it('is automated', () => expect(full(FRILL)).toBe(true));
  it('paid twice: up to two modes are offered (0 to 2); two chosen (destroy the artifact, exile the player\'s graveyard); two Forests are tapped and no life is gained', () => {
    const s0 = setup();
    let range: [number, number] | undefined;
    const s2 = enter(s0, 2, { options: [(p) => { range = [p.min, p.max]; return ['0', '1']; }], targets: [[obj(relic(s0))], [{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(range).toEqual([0, 2]);
    expect(onBfNames(s2, 'p2')).not.toContain('Test Brass Relic');
    expect(gy(s2, 'p2')).toEqual([]);
    expect([...exileOf(s2, 'p2')].sort()).toEqual(['Test Brass Relic', 'Test Grave Dust', 'Test Grave Dust']); // destroyed first, then that graveyard is exiled (modes in printed order, CR 700.2)
    expect(lifeOf(s2, 'p1')).toBe(20);
    expect(s2.zones.battlefield.filter((id) => s2.objects[id]!.defId === 'Forest' && s2.objects[id]!.tapped).length).toBe(2);
  });
  it('paid three times: all three modes may be chosen; paid zero times: the reflexive trigger never triggers (no modes, nothing happens)', () => {
    const s3 = enter(setup(), 3, { options: [['0', '1', '2']], targets: [[obj(relic(setup()))], [{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(lifeOf(s3, 'p1')).toBe(24);
    expect([...exileOf(s3, 'p2')].sort()).toEqual(['Test Brass Relic', 'Test Grave Dust', 'Test Grave Dust']); // the modes in printed order: the destroyed artifact is in the graveyard the next mode exiles (CR 700.2)
    const s0 = enter(setup(), 0, {});
    expect(lifeOf(s0, 'p1')).toBe(20);
    expect(onBfNames(s0, 'p2')).toContain('Test Brass Relic');
    expect(s0.zones.battlefield.filter((id) => s0.objects[id]!.defId === 'Forest' && s0.objects[id]!.tapped).length).toBe(0);
    expect(s0.zones.stack.length).toBe(0);
  });
});
const onBfNames = (s: GameState, p: PlayerId): string[] => s.zones.battlefield.filter((id) => s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId);

// ---- Protection Racket: "At the beginning of your upkeep, repeat the following process for each opponent in turn order. Reveal the top card of your library. That player may pay life equal to
// that card's mana value. If they do, exile that card. Otherwise, put it into your hand." ---------------------------------------------------------------------------------------------

const RACKET = card('Test Shakedown Ring', 'Enchantment', 'At the beginning of your upkeep, repeat the following process for each opponent in turn order. Reveal the top card of your library. That player may pay life equal to that card\'s mana value. If they do, exile that card. Otherwise, put it into your hand.');
const MV3 = card('Test Three Drop', 'Sorcery', 'You gain 1 life.', { cost: '{2}{B}' });
const MV0 = card('Test Zero Drop', 'Sorcery', 'You gain 1 life.', { cost: '{0}' });
const MV5 = card('Test Five Drop', 'Sorcery', 'You gain 1 life.', { cost: '{4}{B}' });

describe('CR 608.2c, 101.4, 119.4, 202.3 (Protection Racket): for each opponent in turn order, reveal your top card; that opponent may pay life equal to its mana value to exile it, else it goes to your hand', () => {
  const setup = (): GameState => mpScenario({
    defs: [RACKET, MV3, MV0, MV5, DRAWN],
    zones: { p1: { battlefield: ['Test Shakedown Ring'], library: ['Test Drawn Card', 'Test Three Drop', 'Test Zero Drop', 'Test Five Drop'] } },
    setup: (s) => { s.players.find((x) => x.id === 'p4')!.life = 4; },
  });
  const toMyUpkeep = (s0: GameState): GameState => {
    let s = s0;
    for (let guard = 0; guard < 400 && !(s.turn.activePlayer === 'p1' && s.turn.step === 'upkeep' && s.zones.stack.length > 0); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    return s;
  };
  it('is automated', () => expect(full(RACKET)).toBe(true));
  it('p2 pays 3 life and the first card is exiled; p3 declines and the second card goes to the hand; p4 (4 life) cannot pay 5 and the third card goes to the hand; in that order (p2, p3, p4)', () => {
    let s = toMyUpkeep(setup());
    const asked: string[] = [];
    for (let guard = 0; guard < 60 && s.zones.stack.length > 0; guard++) {
      const p = s.pending!;
      if (p.kind === 'priority') { s = act(s, { type: 'pass', player: p.player }); continue; }
      if (p.kind === 'yesNo') { asked.push(p.player); s = answer(s, { kind: 'yesNo', yes: p.player === 'p2' }); continue; }
      s = drive(s);
    }
    expect(asked).toEqual(['p2', 'p3']); // p4 cannot pay 5 life with 4 (CR 119.4), so is not asked
    expect(lifeOf(s, 'p2')).toBe(17);
    expect(lifeOf(s, 'p3')).toBe(20);
    expect(lifeOf(s, 'p4')).toBe(4);
    expect(exileOf(s, 'p1')).toEqual(['Test Three Drop']);
    expect(names(s, s.zones.hand.p1!)).toEqual(expect.arrayContaining(['Test Zero Drop', 'Test Five Drop']));
    expect(names(s, s.zones.hand.p1!)).not.toContain('Test Three Drop');
  });
});

// ---- Riveteers Charm: "Choose one -- • Target opponent sacrifices a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.
// • Exile the top three cards of your library. Until your next end step, you may play those cards. • Exile target player's graveyard." --------------------------------------------------

const CHARM = card('Test Rivet Charm', 'Instant', 'Choose one —\n• Target opponent sacrifices a creature or planeswalker they control with the greatest mana value among creatures and planeswalkers they control.\n• Exile the top three cards of your library. Until your next end step, you may play those cards.\n• Exile target player\'s graveyard.');
const OGRE4 = card('Test Four Ogre', 'Creature — Ogre', '', { cost: '{3}{R}', pt: ['4', '4'] });
const OGRE4B = card('Test Other Four Ogre', 'Creature — Ogre', '', { cost: '{3}{G}', pt: ['4', '4'] });
const ELF1 = card('Test One Elf', 'Creature — Elf', '', { cost: '{G}', pt: ['1', '1'] });
const WALKER5 = card('Test Five Walker', 'Legendary Planeswalker — Testa', '+1: You gain 1 life.', { cost: '{4}{U}', loyalty: '3' });
const BIG7 = card('Test Seven Giant', 'Creature — Giant', '', { cost: '{6}{R}', pt: ['7', '7'] });

describe('CR 701.21a, 202.3, 608.2d, 611.2a (Riveteers Charm, ruling 2022-04-29)', () => {
  const castCharm = (s: GameState, mode: string, script: Script): GameState => settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Rivet Charm', 'hand', 'p1') }), { options: [[mode]], ...script });
  it('is automated', () => expect(full(CHARM)).toBe(true));
  it('mode one: the target opponent sacrifices the planeswalker of greatest mana value among their creatures and planeswalkers (5 over 4 and 1); another opponent\'s greater creature is not looked at', () => {
    const s0 = mpScenario({ defs: [CHARM, OGRE4, ELF1, WALKER5, BIG7], zones: { p1: { hand: ['Test Rivet Charm'] }, p2: { battlefield: ['Test Four Ogre', 'Test One Elf', { name: 'Test Five Walker', counters: { loyalty: 3 } }] }, p3: { battlefield: ['Test Seven Giant'] } } });
    const s = castCharm(s0, '0', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]] });
    expect(onBfNames(s, 'p2').sort()).toEqual(['Test Four Ogre', 'Test One Elf']);
    expect(gy(s, 'p2')).toEqual(['Test Five Walker']);
    expect(onBfNames(s, 'p3')).toEqual(['Test Seven Giant']);
  });
  it('mode one, a tie: the sacrificing opponent chooses which of the two greatest (both mana value 4) to sacrifice, and only those two are offered', () => {
    const s0 = mpScenario({ defs: [CHARM, OGRE4, OGRE4B, ELF1], zones: { p1: { hand: ['Test Rivet Charm'] }, p2: { battlefield: ['Test Four Ogre', 'Test Other Four Ogre', 'Test One Elf'] } } });
    let offered: string[] = [];
    let chooser = '';
    const s = castCharm(s0, '0', { targets: [[{ kind: 'player', id: 'p2' } as TargetChoice]], objects: [(opts, st) => { offered = opts.map((id) => st.objects[id]!.defId).sort(); chooser = (st.pending as { player: string }).player; return opts.filter((id) => st.objects[id]!.defId === 'Test Other Four Ogre'); }] });
    expect(chooser).toBe('p2');
    expect(offered).toEqual(['Test Four Ogre', 'Test Other Four Ogre']);
    expect(gy(s, 'p2')).toEqual(['Test Other Four Ogre']);
  });
  it('mode two: the top three cards are exiled and may be played now; after your next end step they can no longer be played', () => {
    const s0 = mpScenario({ defs: [CHARM, DRAWN, MV3, MV0, MV5], zones: { p1: { hand: ['Test Rivet Charm'], library: ['Test Drawn Card', 'Test Zero Drop', 'Test Three Drop', 'Test Five Drop'] } } });
    let s = castCharm(s0, '1', {});
    expect(exileOf(s, 'p1').sort()).toEqual(['Test Five Drop', 'Test Three Drop', 'Test Zero Drop']);
    expect(canCastFromExile(s, 'p1', 'Test Zero Drop')).toBe(true);
    for (let guard = 0; guard < 200 && !(s.turn.activePlayer === 'p2'); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    for (let guard = 0; guard < 200 && s.turn.step !== 'main1'; guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
    expect(exileOf(s, 'p1')).toContain('Test Zero Drop');
    expect(canCastFromExile(s, 'p1', 'Test Zero Drop')).toBe(false);
  });
});

// ---- Obeka, Brute Chronologist: "{T}: The player whose turn it is may end the turn." ----------------------------------------------------------------------------------------------------

const OBEKA = card('Test Brute Timekeeper', 'Legendary Creature — Ogre Wizard', '{T}: The player whose turn it is may end the turn. (Exile all spells and abilities from the stack. The player whose turn it is discards down to their maximum hand size. Damage wears off, and "this turn" and "until end of turn" effects end.)', { pt: ['3', '4'] });
const PUMP = card('Test Brief Growth', 'Instant', 'Target creature gets +3/+3 until end of turn.');

describe('CR 724.1, 102.1, 608.2d (Obeka): the active player, not the controller, chooses whether the turn ends; ending it exiles the stack and skips to cleanup', () => {
  const obeka = (s: GameState): string => s.zones.battlefield.find((id) => s.objects[id]!.defId === 'Test Brute Timekeeper')!;
  const activate = (s: GameState, p: PlayerId): GameState => {
    const a = legalActions(s, p).find((x) => x.kind === 'activate' && x.object === obeka(s)) as { action?: { ability: string } } | undefined;
    if (a === undefined) throw new Error('Obeka cannot be activated');
    return act(s, { type: 'activate', player: p, source: obeka(s), ability: a.action!.ability } as never);
  };
  const setup = (): GameState => mpScenario({ defs: [OBEKA, PUMP], zones: { p1: { battlefield: ['Test Brute Timekeeper'], hand: ['Test Brief Growth'] } } });
  it('is automated', () => expect(full(OBEKA)).toBe(true));
  /** Everyone passes until the stack is empty; each yes/no is answered by `yes(player)` and recorded. */
  const resolveAll = (s0: GameState, yes: (p: PlayerId) => boolean, asked: PlayerId[], script: Script = {}): GameState => {
    let s = s0;
    for (let guard = 0; guard < 80 && (s.zones.stack.length > 0 || (s.pending != null && s.pending.kind !== 'priority')); guard++) {
      const p = s.pending!;
      if (p.kind === 'priority') s = act(s, { type: 'pass', player: p.player });
      else if (p.kind === 'yesNo') { asked.push(p.player); s = answer(s, { kind: 'yesNo', yes: yes(p.player) }); }
      else s = drive(s, script);
    }
    return s;
  };
  it('on its controller\'s own turn the controller is asked; yes: the spell below it on the stack is exiled and the turn ends (the next player\'s turn begins)', () => {
    let s = mpScenario({ defs: [OBEKA, PUMP], zones: { p1: { battlefield: ['Test Brute Timekeeper'], hand: ['Test Brief Growth'] } } });
    const ob = obeka(s);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Brief Growth', 'hand', 'p1') }), { targets: [[obj(ob)]] });
    expect(s.zones.stack.length).toBe(1);
    s = drive(activate(s, 'p1'));
    expect(s.zones.stack.length).toBe(2);
    const asked: PlayerId[] = [];
    s = resolveAll(s, () => true, asked);
    expect(asked).toEqual(['p1']);
    expect(exileOf(s, 'p1')).toContain('Test Brief Growth');
    expect(s.turn.activePlayer).toBe('p2');
  });
  it('on an opponent\'s turn that opponent (the player whose turn it is) is asked, not the controller: no keeps the turn going, yes ends it', () => {
    const toP2Upkeep = (s0: GameState): GameState => {
      let s = s0;
      for (let guard = 0; guard < 200 && !(s.turn.activePlayer === 'p2' && s.turn.step === 'upkeep' && s.pending?.kind === 'priority' && s.pending.player === 'p1'); guard++) s = drive(act(s, { type: 'pass', player: s.pending!.player }));
      return s;
    };
    const s0 = toP2Upkeep(setup());
    expect(s0.turn.step).toBe('upkeep');
    const askedNo: PlayerId[] = [];
    const no = resolveAll(drive(activate(s0, 'p1')), () => false, askedNo);
    expect(askedNo).toEqual(['p2']);
    expect(no.turn.activePlayer).toBe('p2');
    expect(no.turn.step).toBe('upkeep');
    const askedYes: PlayerId[] = [];
    const yes = resolveAll(drive(activate(s0, 'p1')), () => true, askedYes);
    expect(askedYes).toEqual(['p2']);
    expect(yes.turn.activePlayer).toBe('p3');
  });
});

// ---- Devourer of Destiny: "You may reveal this card from your opening hand. If you do, at the beginning of your first upkeep, look at the top four cards of your library. You may put one of
// those cards back on top of your library. Exile the rest. / When you cast this spell, exile target permanent that's one or more colors." -----------------------------------------------

const DEVOURER = card('Test Fate Eater', 'Creature — Eldrazi', 'You may reveal this card from your opening hand. If you do, at the beginning of your first upkeep, look at the top four cards of your library. You may put one of those cards back on top of your library. Exile the rest.\nWhen you cast this spell, exile target permanent that\'s one or more colors.', { cost: '{5}{C}{C}', pt: ['6', '6'] });
const PLAINS = compileCard({ name: 'Plains', layout: 'normal', mana_cost: '', type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)', colors: [], keywords: [] } as never);

describe('CR 103.6b, 603.7a, 701.20e, 406.1 (Devourer of Destiny, rulings 2024-06-07): revealed from the opening hand, at its owner\'s first upkeep look at the top four, keep up to one on top, exile the rest', () => {
  const opening = (aliceDeck: string, bobDeck = 'Plains'): GameState => createGame({
    seed: 'edhd99-devourer',
    players: [
      { name: 'Alice', deck: Array(40).fill(aliceDeck) as string[], stops: { fullControl: true } },
      { name: 'Bob', deck: Array(40).fill(bobDeck) as string[], stops: { fullControl: true } },
    ],
    defs: [DEVOURER, PLAINS],
    options: { startingPlayer: 'p1', skipMulligans: true },
  } as GameConfig);
  const until = (s0: GameState, stop: (s: GameState) => boolean, script: Script = {}): GameState => {
    let s = s0;
    for (let guard = 0; !stop(s) && guard < 200; guard++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s, script);
    return s;
  };
  it('is automated', () => expect(full(DEVOURER)).toBe(true));
  it('revealed: at the first upkeep the controller keeps one of the top four on top and the other three are exiled; the next upkeep does nothing', () => {
    let s = opening('Test Fate Eater');
    const revealed = s.zones.hand.p1![0]!;
    s = answer(s, { kind: 'chooseObjects', ids: [revealed] });
    s = until(s, (x) => x.turn.number === 1 && x.turn.step === 'upkeep' && x.zones.stack.length > 0);
    const top4 = s.zones.library.p1!.slice(0, 4);
    const cardOf = (st: GameState, id: string): string => (st.objects[id] as unknown as { cardId: string }).cardId;
    const cards4 = top4.map((id) => cardOf(s, id));
    let offered: string[] = [];
    s = until(s, (x) => x.zones.stack.length === 0 && x.pending?.kind === 'priority', { objects: [(opts) => { offered = opts; return [top4[2]!]; }] });
    expect([...offered].sort()).toEqual([...top4].sort());
    expect(cardOf(s, s.zones.library.p1![0]!)).toBe(cards4[2]); // the same card, a new object after the move (CR 400.7)
    expect(s.zones.exile.map((id) => cardOf(s, id)).sort()).toEqual([cards4[0]!, cards4[1]!, cards4[3]!].sort());
    const exiled = s.zones.exile.length;
    s = until(s, (x) => x.turn.number === 3 && x.turn.step === 'main1');
    expect(s.zones.exile.length).toBe(exiled);
  });
  it('negative: not revealed, nothing happens at the first upkeep; keeping none exiles all four', () => {
    let s = opening('Test Fate Eater');
    s = answer(s, { kind: 'chooseObjects', ids: [] });
    s = until(s, (x) => x.turn.number === 1 && x.turn.step === 'main1');
    expect(s.zones.exile).toEqual([]);
    let t = opening('Test Fate Eater');
    t = answer(t, { kind: 'chooseObjects', ids: [t.zones.hand.p1![0]!] });
    t = until(t, (x) => x.turn.number === 1 && x.turn.step === 'main1', { objects: [[]] });
    expect(t.zones.exile.length).toBe(4);
  });
  it('ruling 2024-06-07: two revealed Devourers each trigger: two looks, up to two kept in turn, six cards exiled in all', () => {
    let s = opening('Test Fate Eater');
    s = answer(s, { kind: 'chooseObjects', ids: s.zones.hand.p1!.slice(0, 2) });
    s = until(s, (x) => x.turn.number === 1 && x.turn.step === 'main1', { objects: [(o) => o.slice(0, 1), (o) => o.slice(0, 1)] });
    expect(s.zones.exile.length).toBe(6);
  });
});

// ---- King Narfi's Betrayal: "I -- Each player mills four cards. Then you may exile a creature or planeswalker card from each graveyard. II, III -- Until end of turn, you may cast spells from
// among cards exiled with this Saga, and you may spend mana as though it were mana of any color to cast those spells." -------------------------------------------------------------------

const NARFI = card('Test Traitor King Saga', 'Enchantment — Saga', '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — Each player mills four cards. Then you may exile a creature or planeswalker card from each graveyard.\nII, III — Until end of turn, you may cast spells from among cards exiled with this Saga, and you may spend mana as though it were mana of any color to cast those spells.');
const GELF = card('Test Grave Elf', 'Creature — Elf', '', { cost: '{G}', pt: ['1', '1'], colors: ['G'] });
const IMP = card('Test Other Exile Imp', 'Creature — Imp', '', { cost: '{B}', pt: ['1', '1'] });
const GOGRE = card('Test Grave Ogre', 'Creature — Ogre', '', { cost: '{R}', pt: ['3', '3'], colors: ['R'] });

describe('CR 608.2c, 101.4, 607.2a, 609.4b, 400.7 (King Narfi\'s Betrayal, rulings 2021-02-05)', () => {
  const setup = (): GameState => mpScenario({
    defs: [NARFI, GELF, GOGRE, DRAWN, IMP],
    zones: {
      p1: { hand: ['Test Traitor King Saga'], battlefield: ['Plains', 'Plains'], library: ['Test Drawn Card', 'Test Drawn Card', 'Test Drawn Card', 'Test Drawn Card', 'Test Drawn Card'] },
      p2: { library: ['Test Grave Elf', 'Test Drawn Card', 'Test Drawn Card', 'Test Drawn Card'], graveyard: ['Test Grave Ogre'] },
      p3: { library: ['Test Grave Ogre'] },
      p4: { exile: ['Test Other Exile Imp'] },
    },
  });
  it('is automated', () => expect(full(NARFI)).toBe(true));
  it('chapter I: everyone mills four; for each graveyard you may exile one creature card (a card already there or a milled one); you may also take none from a graveyard', () => {
    const offeredFor: string[] = [];
    const pick = (o: string[], st: GameState): string[] => {
      const owner = st.objects[o[0]!]!.owner;
      offeredFor.push(`${owner}:${o.length}`);
      return owner === 'p2' ? o.filter((id) => st.objects[id]!.defId === 'Test Grave Elf') : o.slice(0, 1);
    };
    const s = settle(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Traitor King Saga', 'hand', 'p1') }), { objects: [pick, pick, pick, pick] });
    expect(exileOf(s, 'p2')).toEqual(['Test Grave Elf']);
    expect(gy(s, 'p2')).toContain('Test Grave Ogre');
    expect(exileOf(s, 'p3')).toEqual(['Test Grave Ogre']);
    expect(offeredFor).toEqual(['p2:2', 'p3:1']); // p2's graveyard: the milled Elf and the Ogre already there; p3's: the milled Ogre (p1's and p4's had none to choose)
  });
  it('chapter II: until end of turn the controller may cast the creature cards exiled with this Saga, paying {G} and {R} with Plains; not before chapter II, not a card exiled otherwise', () => {
    let s = settle(act(setup(), { type: 'cast', player: 'p1', card: find(setup(), 'Test Traitor King Saga', 'hand', 'p1') }), { objects: [(o) => o.slice(0, 1), (o) => o.slice(0, 1), (o) => o.slice(0, 1), (o) => o.slice(0, 1)] });
    expect(exileOf(s, 'p2').length + exileOf(s, 'p3').length).toBe(2);
    expect(canCastFromExile(s, 'p1', 'Test Grave Ogre')).toBe(false); // chapter I gives no permission
    for (let guard = 0; guard < 400 && !(s.turn.activePlayer === 'p1' && s.turn.step === 'main1' && s.turn.number > 1 && s.zones.stack.length === 0 && s.pending?.kind === 'priority'); guard++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    expect(canCastFromExile(s, 'p1', 'Test Grave Ogre')).toBe(true);
    expect(canCastFromExile(s, 'p2', 'Test Grave Ogre')).toBe(false);
    expect(canCastFromExile(s, 'p1', 'Test Other Exile Imp')).toBe(false); // a card in exile that this Saga did not exile
    const ogre = s.zones.exile.find((id) => s.objects[id]!.defId === 'Test Grave Ogre')!;
    s = settle(act(s, { type: 'cast', player: 'p1', card: ogre }));
    expect(onBfNames(s, 'p1')).toContain('Test Grave Ogre');
    for (let guard = 0; guard < 200 && s.turn.activePlayer === 'p1'; guard++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    expect(canCastFromExile(s, 'p1', 'Test Grave Elf')).toBe(false); // the permission ended with the turn
  });
});

// ---- Bleeding Effect: "At the beginning of combat on your turn, creatures you control gain flying until end of turn if a creature card in your graveyard has flying. The same is true for first
// strike, double strike, deathtouch, hexproof, indestructible, lifelink, menace, reach, trample, and vigilance." -----------------------------------------------------------------------------

const BLEED = card('Test Bleeding Rite', 'Enchantment', 'At the beginning of combat on your turn, creatures you control gain flying until end of turn if a creature card in your graveyard has flying. The same is true for first strike, double strike, deathtouch, hexproof, indestructible, lifelink, menace, reach, trample, and vigilance.');
const SKY = card('Test Sky Corpse', 'Creature — Bird', 'Flying', { pt: ['1', '1'] });
const WARD = card('Test Ward Corpse', 'Creature — Cleric', 'Hexproof from white', { pt: ['1', '1'] });
const LIFE_ART = card('Test Leech Idol', 'Artifact', 'Lifelink');
const TRAMPLER = card('Test Trample Corpse', 'Creature — Beast', 'Trample', { pt: ['4', '4'] });
const BEAR = card('Test Plain Bear', 'Creature — Bear', '', { pt: ['2', '2'] });

describe('CR 702.1, 404.1, 611.2c, 702.11d (Bleeding Effect, rulings 2024-07-05)', () => {
  const kws = (s: GameState, id: string): string[] => getChars(s, id)!.keywords.map((k) => (k.quality === undefined ? k.keyword : `${k.keyword}:${k.quality}`)).sort();
  const atCombat = (s0: GameState): GameState => {
    let s = s0;
    for (let guard = 0; guard < 60 && !(s.turn.step === 'beginCombat' && s.zones.stack.length === 0 && s.pending?.kind === 'priority'); guard++) s = s.pending?.kind === 'priority' ? act(s, { type: 'pass', player: s.pending.player }) : drive(s);
    return s;
  };
  it('is automated', () => expect(full(BLEED)).toBe(true));
  it('your creatures gain flying and the hexproof variant of the creature cards in your graveyard (hexproof from white, not plain hexproof); not lifelink (an artifact card has it), not trample (an opponent\'s card has it)', () => {
    const s0 = mpScenario({ defs: [BLEED, SKY, WARD, LIFE_ART, TRAMPLER, BEAR], zones: { p1: { battlefield: ['Test Bleeding Rite', 'Test Plain Bear'], graveyard: ['Test Sky Corpse', 'Test Ward Corpse', 'Test Leech Idol'] }, p2: { graveyard: ['Test Trample Corpse'] } } });
    const s = atCombat(s0);
    expect(s.turn.step).toBe('beginCombat');
    const bear = find(s, 'Test Plain Bear', 'battlefield', 'p1');
    const k = kws(s, bear);
    expect(k).toContain('flying');
    expect(k.filter((x) => x.startsWith('hexproof'))).toHaveLength(1);
    expect(k).not.toContain('hexproof');
    expect(k).not.toContain('lifelink');
    expect(k).not.toContain('trample');
  });
  it('negative: with no creature card in your graveyard nothing is gained', () => {
    const s0 = mpScenario({ defs: [BLEED, LIFE_ART, BEAR], zones: { p1: { battlefield: ['Test Bleeding Rite', 'Test Plain Bear'], graveyard: ['Test Leech Idol'] } } });
    const s = atCombat(s0);
    expect(kws(s, find(s, 'Test Plain Bear', 'battlefield', 'p1'))).toEqual([]);
  });
});

// ---- Isildur's Fateful Strike: "(You may cast a legendary instant only if you control a legendary creature or planeswalker.) Destroy target creature. If its controller has more than four
// cards in hand, they exile cards from their hand equal to the difference." -------------------------------------------------------------------------------------------------------------

const STRIKE = card('Test Fateful Blow', 'Legendary Instant', '(You may cast a legendary instant only if you control a legendary creature or planeswalker.)\nDestroy target creature. If its controller has more than four cards in hand, they exile cards from their hand equal to the difference.');
const HERO = card('Test Legend Hero', 'Legendary Creature — Human', '', { pt: ['2', '2'] });
const VICTIM = card('Test Victim Ogre', 'Creature — Ogre', '', { pt: ['3', '3'] });
const FILLER = card('Test Hand Filler', 'Sorcery', 'You gain 1 life.');

describe('CR 205.4e, 608.2h, 402.1, 406.1 (Isildur\'s Fateful Strike, rulings 2023-06-16)', () => {
  const setup = (handCount: number, withHero = true): GameState => mpScenario({
    defs: [STRIKE, HERO, VICTIM, FILLER],
    zones: { p1: { hand: ['Test Fateful Blow'], battlefield: withHero ? ['Test Legend Hero'] : [] }, p2: { battlefield: ['Test Victim Ogre'], hand: Array(handCount).fill('Test Hand Filler') as string[] } },
  });
  const cast = (s0: GameState, script: Script = {}): GameState => {
    const victim = s0.zones.battlefield.find((id) => s0.objects[id]!.defId === 'Test Victim Ogre')!;
    return settle(act(s0, { type: 'cast', player: 'p1', card: find(s0, 'Test Fateful Blow', 'hand', 'p1') }), { targets: [[obj(victim)]], ...script });
  };
  it('is automated', () => expect(full(STRIKE)).toBe(true));
  it('destroys the creature; its controller, with seven cards in hand, chooses and exiles three of them (down to four)', () => {
    let chooser = '';
    let range: number[] = [];
    const s = cast(setup(7), { objects: [(o, st) => { const p = st.pending as { player: string; min: number; max: number }; chooser = p.player; range = [p.min, p.max]; return o.slice(0, p.min); }] });
    expect(gy(s, 'p2')).toEqual(['Test Victim Ogre']);
    expect(chooser).toBe('p2');
    expect(range).toEqual([3, 3]);
    expect(s.zones.hand.p2!.length).toBe(4);
    expect(exileOf(s, 'p2').length).toBe(3);
  });
  it('negative: with exactly four cards in hand nothing is exiled', () => {
    const s = cast(setup(4));
    expect(gy(s, 'p2')).toEqual(['Test Victim Ogre']);
    expect(s.zones.hand.p2!.length).toBe(4);
    expect(exileOf(s, 'p2')).toEqual([]);
  });
  it('ruling 2023-06-16: it can be cast only while its caster controls a legendary creature or planeswalker', () => {
    const s = setup(7, false);
    expect(legalActions(s, 'p1').some((a) => a.kind === 'cast' && s.objects[a.object as string]?.defId === 'Test Fateful Blow')).toBe(false);
    const t = setup(7);
    expect(legalActions(t, 'p1').some((a) => a.kind === 'cast' && t.objects[a.object as string]?.defId === 'Test Fateful Blow')).toBe(true);
  });
  it('CR 608.2h: "its controller" is the destroyed creature\'s controller as it last existed (a creature you control that an opponent owns: you exile from your hand, not the owner)', () => {
    const s0 = mpScenario({
      defs: [STRIKE, HERO, VICTIM, FILLER],
      zones: { p1: { hand: ['Test Fateful Blow', ...Array(6).fill('Test Hand Filler') as string[]], battlefield: ['Test Legend Hero'] }, p2: { battlefield: ['Test Victim Ogre'], hand: Array(7).fill('Test Hand Filler') as string[] } },
      setup: (st) => { const v = st.zones.battlefield.find((id) => st.objects[id]!.defId === 'Test Victim Ogre')!; st.objects[v]!.controller = 'p1'; },
    });
    const s = cast(s0, { objects: [(o, st) => o.slice(0, (st.pending as { min: number }).min)] });
    expect(gy(s, 'p2')).toEqual(['Test Victim Ogre']); // its owner's graveyard
    expect(s.zones.hand.p2!.length).toBe(7);
    expect(s.zones.hand.p1!.length).toBe(4);
  });
});
