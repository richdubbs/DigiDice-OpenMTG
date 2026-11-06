/**
 * edh-d-76 (concept lane graveyard-cast): the round's readings played through the engine with synthetic cards compiled by the game's default compiler (invented
 * names and wordings, design 6.10), in four-player games. Each test is named after the rule it checks, with its negative case. The CR cites are from memory
 * (unverified: no rules/cr in a cloud checkout).
 *
 *   CR 601.3, 404.1, 614.1a        "You may cast instant and sorcery spells from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead." (an emblem)
 *   CR 702.138a, 118.9              "Target legendary creature card in your graveyard gains escape until end of turn. The escape cost is equal to its mana cost plus exile N other cards"
 *   CR 400.7, 603.4, 601.2a         "..., if that creature entered from a graveyard or you cast it from a graveyard" (another creature, any graveyard)
 *   CR 113.6m, 603.4                a trigger of a card in a graveyard ("it entered from your graveyard or you cast it from your graveyard")
 *   CR 406.1, 108.3, 702.34a        "Return target card with flashback you own from exile to your hand."
 */
import { describe, expect, it } from 'vitest';
import { compileCard, legalActions, type CardDef, type GameState, type PlayerId, type TargetChoice } from '../../../src/index';
import { act, answer, find, legal } from '../../m3/scenario';
import { mpScenario } from '../../m12/rules/helpers';

function card(name: string, type: string, text: string, opts: { cost?: string; pt?: [string, string]; colors?: string[] } = {}): CardDef {
  return compileCard({ name, layout: 'normal', mana_cost: opts.cost ?? '{0}', type_line: type, oracle_text: text, colors: opts.colors ?? [], keywords: [], ...(opts.pt ? { power: opts.pt[0], toughness: opts.pt[1] } : {}) } as never);
}
const full = (d: CardDef): boolean => d.automation.level === 'full' && !JSON.stringify(d.faces).includes('"op":"manual"') && d.faces.every((f) => f.abilities.every((a) => a.kind !== 'manual'));
const obj = (id: string): TargetChoice => ({ kind: 'object', id }) as TargetChoice;

interface Script { yes?: boolean[]; targets?: TargetChoice[][]; objects?: (string[] | ((options: string[], s: GameState) => string[]))[]; options?: string[][] }
/** Answer the decisions that come up until someone has priority. */
function drive(s0: GameState, script: Script = {}): GameState {
  let s = s0;
  for (let guard = 0; guard < 100 && s.pending && s.pending.kind !== 'priority'; guard++) {
    const p = s.pending;
    if (p.kind === 'yesNo') s = answer(s, { kind: 'yesNo', yes: script.yes?.shift() ?? false });
    else if (p.kind === 'chooseObjects') { const pick = script.objects?.shift(); s = answer(s, { kind: 'chooseObjects', ids: typeof pick === 'function' ? pick(p.options, s) : pick ?? p.options.slice(0, p.min) }); }
    else if (p.kind === 'order') s = answer(s, { kind: 'order', ids: p.items.map((i) => i.id) });
    else if (p.kind === 'payCost') s = answer(s, { kind: 'payCost', auto: true });
    else if (p.kind === 'chooseTargets') s = answer(s, { kind: 'chooseTargets', targets: script.targets?.shift() ?? [] });
    else if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: script.options?.shift() ?? p.options.slice(0, p.min).map((o) => o.id) });
    else if (p.kind === 'chooseNumber') s = answer(s, { kind: 'chooseNumber', n: p.min });
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
const exileOf = (s: GameState, p: PlayerId): string[] => s.zones.exile.filter((id) => s.objects[id]!.owner === p).map((id) => s.objects[id]!.defId);
const hand = (s: GameState, p: PlayerId): string[] => names(s, s.zones.hand[p]!);
const onBf = (s: GameState, p?: PlayerId): string[] => s.zones.battlefield.filter((id) => p === undefined || s.objects[id]!.controller === p).map((id) => s.objects[id]!.defId);
const castFrom = (s: GameState, p: PlayerId, name: string): boolean => legalActions(s, p).some((a) => a.kind === 'cast' && s.objects[a.object as string]?.defId === name && s.objects[a.object as string]?.zone === 'graveyard');
void legal; void full; void obj;

// ---- Jaya Ballard's emblem: "You may cast instant and sorcery spells from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead." -------------

const RITE = card('Test Ember Rite', 'Sorcery', 'You get an emblem with "You may cast instant and sorcery spells from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead."');
const SPARK = card('Test Cinder Spark', 'Instant', 'You gain 3 life.');
const WHISPER = card('Test Pale Whisper', 'Sorcery', 'You gain 2 life.');
const BEAR = card('Test Grave Bear', 'Creature — Bear', '', { pt: ['2', '2'] });
const lifeOf = (s: GameState, p: PlayerId): number => s.players.find((x) => x.id === p)!.life;

describe('CR 601.3, 404.1, 614.1a, 113.2: an emblem that lets its controller cast instant and sorcery spells from their graveyard and exiles them instead of graveyarding them', () => {
  const setup = (): GameState => mpScenario({ defs: [RITE, SPARK, WHISPER, BEAR], zones: { p1: { hand: ['Test Ember Rite'], graveyard: ['Test Cinder Spark', 'Test Pale Whisper', 'Test Grave Bear'] }, p2: { graveyard: ['Test Cinder Spark'] } } });
  it('is automated', () => expect(full(RITE)).toBe(true));
  it('before the emblem, nothing in the graveyard can be cast; after it, the instant and the sorcery can, the creature card cannot, and the opponent\'s graveyard cannot', () => {
    let s = setup();
    expect(castFrom(s, 'p1', 'Test Cinder Spark')).toBe(false);
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Rite', 'hand', 'p1') }));
    expect(s.zones.stack.length).toBe(0);
    expect(gy(s, 'p1')).toContain('Test Ember Rite');
    expect(castFrom(s, 'p1', 'Test Cinder Spark')).toBe(true);
    expect(castFrom(s, 'p1', 'Test Pale Whisper')).toBe(true);
    expect(castFrom(s, 'p1', 'Test Grave Bear')).toBe(false);
    const opp = legalActions(s, 'p1').filter((a) => a.kind === 'cast' && s.objects[a.object as string]?.owner === 'p2');
    expect(opp).toEqual([]);
  });
  it('a spell cast from the graveyard this way is exiled when it resolves (not put into the graveyard); the emblem is not used up (no once-each-turn limit)', () => {
    let s = setup();
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Rite', 'hand', 'p1') }));
    const before = lifeOf(s, 'p1');
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cinder Spark', 'graveyard', 'p1') }));
    expect(lifeOf(s, 'p1')).toBe(before + 3);
    expect(gy(s, 'p1')).not.toContain('Test Cinder Spark');
    expect(exileOf(s, 'p1')).toContain('Test Cinder Spark');
    expect(castFrom(s, 'p1', 'Test Pale Whisper')).toBe(true); // the emblem is not used up (no "once each turn")
  });
  it('a spell that is countered is exiled too (CR 614.1a: "would be put into your graveyard")', () => {
    const NEGATE = card('Test Hush', 'Instant', 'Counter target spell.');
    let s = mpScenario({ defs: [RITE, SPARK, NEGATE], zones: { p1: { hand: ['Test Ember Rite'], graveyard: ['Test Cinder Spark'] }, p2: { hand: ['Test Hush'] } } });
    s = settle(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Ember Rite', 'hand', 'p1') }));
    s = act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Cinder Spark', 'graveyard', 'p1') });
    s = drive(s);
    const spark = find(s, 'Test Cinder Spark', 'stack');
    // the opponent responds with a counterspell
    s = act(s, { type: 'pass', player: 'p1' });
    expect(s.pending?.player).toBe('p2');
    s = drive(act(s, { type: 'cast', player: 'p2', card: find(s, 'Test Hush', 'hand', 'p2') }), { targets: [[obj(spark)]] });
    s = settle(s);
    expect(gy(s, 'p1')).not.toContain('Test Cinder Spark');
    expect(exileOf(s, 'p1')).toContain('Test Cinder Spark');
  });
});

// ---- Confession Dial / Desdemona: "Target legendary creature card in your graveyard gains escape until end of turn. The escape cost is equal to its mana cost plus exile two other cards from your graveyard." ----

const DIAL = card('Test Grave Dial', 'Artifact', '{T}: Target legendary creature card in your graveyard gains escape until end of turn. The escape cost is equal to its mana cost plus exile two other cards from your graveyard.');
const KING = card('Test Hollow King', 'Legendary Creature — Zombie Noble', '', { cost: '{1}', pt: ['3', '3'] });
const PAWN = card('Test Hollow Pawn', 'Creature — Zombie', '', { cost: '{1}', pt: ['1', '1'] });

describe('CR 702.138a, 118.9, 608.2c: a granted escape whose cost is the mana cost plus exiling other cards from the graveyard, until end of turn', () => {
  const setup = (gyCards: string[]): GameState => mpScenario({
    defs: [DIAL, KING, PAWN, SPARK],
    zones: { p1: { battlefield: ['Test Grave Dial', 'Plains', 'Plains'], graveyard: gyCards }, p2: { graveyard: ['Test Hollow King', 'Test Hollow Pawn', 'Test Hollow Pawn'] } },
  });
  const escapes = (s: GameState, name: string, p: PlayerId = 'p1'): boolean => legalActions(s, p).some((a) => a.kind === 'cast' && s.objects[a.object as string]?.defId === name && (a.action as { method?: string }).method === 'escape');
  const activate = (s: GameState, target: string): GameState => {
    const dial = find(s, 'Test Grave Dial', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === dial);
    expect(a, 'the Dial can be activated').toBeDefined();
    return settle(act(s, { type: 'activate', player: 'p1', source: dial, ability: (a!.action as { ability: string }).ability } as never), { targets: [[obj(target)]] });
  };
  it('is automated', () => expect(full(DIAL)).toBe(true));
  it('before the Dial it has no escape; after it, the legendary creature card is cast with escape for its mana cost plus two OTHER cards exiled (not itself), and enters', () => {
    let s = setup(['Test Hollow King', 'Test Hollow Pawn', 'Test Hollow Pawn']);
    expect(escapes(s, 'Test Hollow King')).toBe(false);
    s = activate(s, find(s, 'Test Hollow King', 'graveyard', 'p1'));
    expect(escapes(s, 'Test Hollow King')).toBe(true);
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Test Hollow King', 'graveyard', 'p1'), method: 'escape' } as never));
    expect(exileOf(s, 'p1')).toEqual(['Test Hollow Pawn', 'Test Hollow Pawn']);
    s = settle(s);
    expect(onBf(s, 'p1')).toContain('Test Hollow King');
  });
  it('needs two other cards: with one other card it is not offered (the card itself does not count); a non-legendary creature card cannot be the target; an opponent\'s graveyard card is not "your graveyard"', () => {
    let s = setup(['Test Hollow King', 'Test Hollow Pawn']);
    s = activate(s, find(s, 'Test Hollow King', 'graveyard', 'p1'));
    expect(escapes(s, 'Test Hollow King')).toBe(false);
    const t = setup(['Test Hollow King', 'Test Hollow Pawn', 'Test Hollow Pawn']);
    const dial = find(t, 'Test Grave Dial', 'battlefield', 'p1');
    const a = legalActions(t, 'p1').find((x) => x.kind === 'activate' && x.object === dial)!;
    const s2 = act(t, { type: 'activate', player: 'p1', source: dial, ability: (a.action as { ability: string }).ability } as never);
    const p = s2.pending as { kind: string; objects: string[] };
    expect(p.kind).toBe('chooseTargets');
    expect(p.objects).toEqual([find(t, 'Test Hollow King', 'graveyard', 'p1')]); // only the legendary creature card of the controller's own graveyard: not the Pawn, not the opponent's King
  });
  it('until end of turn only: the grant is gone on the next turn', () => {
    let s = setup(['Test Hollow King', 'Test Hollow Pawn', 'Test Hollow Pawn']);
    s = activate(s, find(s, 'Test Hollow King', 'graveyard', 'p1'));
    while (s.turn.number === 1) s = act(s, { type: 'pass', player: s.pending!.player });
    expect(escapes(s, 'Test Hollow King', 'p1')).toBe(false);
  });
});

const counters = (s: GameState, name: string, p: PlayerId = 'p1'): number => { const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === name && s.objects[x]!.controller === p)!; return (s.objects[id]!.counters['+1/+1'] ?? 0) as number; };
const cast = (s: GameState, name: string, zone: 'hand' | 'graveyard', p: PlayerId = 'p1', script: Script = {}): GameState => settle(act(s, { type: 'cast', player: p, card: find(s, name, zone, p) } as never), script);

// ---- Breathless Knight: "..., if that creature entered from a graveyard or you cast it from a graveyard" (another creature you control) -------------------------------------------

const WATCHER = card('Test Pale Watcher', 'Creature — Spirit', 'Whenever ~ or another creature you control enters, if that creature entered from a graveyard or you cast it from a graveyard, put a +1/+1 counter on ~.', { pt: ['1', '1'] });
const RAISE = card('Test Raise Dead', 'Sorcery', 'Return target creature card from your graveyard to the battlefield.');
const STEAL = card('Test Grave Theft', 'Sorcery', 'Put target creature card from a graveyard onto the battlefield under your control.');
const FLASHER = card('Test Flash Ghoul', 'Creature — Zombie', '', { pt: ['2', '1'] });
const CRYPT = card('Test Open Crypt', 'Enchantment', 'Once during each of your turns, you may cast a creature spell from your graveyard. If a spell cast this way would be put into your graveyard, exile it instead.');
const FRESH = card('Test Fresh Ghoul', 'Creature — Zombie', '', { pt: ['2', '1'] });

describe('CR 400.7, 601.2a, 603.4: "..., if that creature entered from a graveyard or you cast it from a graveyard" for ANOTHER creature that enters under your control', () => {
  const defs = [WATCHER, RAISE, STEAL, FLASHER, FRESH, CRYPT];
  const setup = (z: Partial<Record<PlayerId, { hand?: string[]; graveyard?: string[]; battlefield?: string[] }>>): GameState => mpScenario({ defs, zones: { ...z, p1: { ...z.p1, battlefield: ['Test Pale Watcher', ...(z.p1?.battlefield ?? [])] } } });
  it('is automated', () => expect(full(WATCHER)).toBe(true));
  it('a creature returned from your graveyard gets the Watcher a counter; a creature cast from the graveyard (a once-a-turn permit) does too (the cast zone), a creature cast from the hand does not', () => {
    let s = setup({ p1: { hand: ['Test Raise Dead', 'Test Fresh Ghoul'], graveyard: ['Test Fresh Ghoul', 'Test Flash Ghoul'], battlefield: ['Test Open Crypt'] } });
    expect(counters(s, 'Test Pale Watcher')).toBe(0);
    s = cast(s, 'Test Fresh Ghoul', 'hand');
    expect(counters(s, 'Test Pale Watcher')).toBe(0); // cast from the hand: no counter
    s = cast(s, 'Test Flash Ghoul', 'graveyard');
    expect(counters(s, 'Test Pale Watcher')).toBe(1); // cast from the graveyard
    s = cast(s, 'Test Raise Dead', 'hand', 'p1', { targets: [[obj(find(s, 'Test Fresh Ghoul', 'graveyard', 'p1'))]] });
    expect(counters(s, 'Test Pale Watcher')).toBe(2); // entered from the graveyard
  });
  it('any graveyard counts ("a graveyard"): a creature of an opponent\'s graveyard put onto the battlefield under your control gives the counter', () => {
    let s = setup({ p1: { hand: ['Test Grave Theft'] }, p2: { graveyard: ['Test Fresh Ghoul'] } });
    s = cast(s, 'Test Grave Theft', 'hand', 'p1', { targets: [[obj(find(s, 'Test Fresh Ghoul', 'graveyard', 'p2'))]] });
    expect(onBf(s, 'p1')).toContain('Test Fresh Ghoul');
    expect(counters(s, 'Test Pale Watcher')).toBe(1);
  });
  it('the Watcher itself entering from the graveyard counts too ("~ or another"); a creature that enters under another player\'s control does not trigger the Watcher of a player who does not control it', () => {
    let s = setup({ p1: { hand: ['Test Grave Theft'] }, p2: { graveyard: ['Test Flash Ghoul'] } });
    s = cast(s, 'Test Grave Theft', 'hand', 'p1', { targets: [[obj(find(s, 'Test Flash Ghoul', 'graveyard', 'p2'))]] });
    expect(counters(s, 'Test Pale Watcher', 'p1')).toBe(1);
    const t = mpScenario({ defs, zones: { p1: { hand: ['Test Raise Dead'], graveyard: ['Test Pale Watcher'] }, p2: { battlefield: ['Test Pale Watcher'] } } });
    const u = cast(t, 'Test Raise Dead', 'hand', 'p1', { targets: [[obj(find(t, 'Test Pale Watcher', 'graveyard', 'p1'))]] });
    expect(counters(u, 'Test Pale Watcher', 'p1')).toBe(1); // it entered from the graveyard itself
    expect(counters(u, 'Test Pale Watcher', 'p2')).toBe(0); // the other player's Watcher: the creature is not theirs, nor is it entering under their control
  });
});

// ---- Prized Amalgam: a trigger of a card in the graveyard that checks "it entered from your graveyard or you cast it from your graveyard" ------------------------------------------------

const THING = card('Test Stitched Thing', 'Creature — Zombie', 'Whenever a creature enters, if it entered from your graveyard or you cast it from your graveyard, return ~ from your graveyard to the battlefield tapped at the beginning of the next end step.', { pt: ['3', '3'] });
const toEndStep = (s0: GameState): GameState => {
  let s = s0;
  for (let guard = 0; guard < 80 && s.turn.step !== 'end' && s.turn.number === 1; guard++) s = s.pending?.kind === 'priority' ? drive(act(s, { type: 'pass', player: s.pending.player })) : drive(s);
  return s;
};

describe('CR 113.6m, 603.4, 400.7: a creature card in the graveyard returns at the next end step when a creature enters from your graveyard or is cast from it', () => {
  const defs = [THING, RAISE, STEAL, FRESH, CRYPT, FLASHER];
  const setup = (z: Partial<Record<PlayerId, { hand?: string[]; graveyard?: string[]; battlefield?: string[] }>>): GameState => mpScenario({ defs, zones: { ...z, p1: { ...z.p1, graveyard: ['Test Stitched Thing', ...(z.p1?.graveyard ?? [])] } } });
  it('is automated', () => expect(full(THING)).toBe(true));
  it('a creature returned from your graveyard: the Thing comes back tapped at the beginning of the next end step (not before)', () => {
    let s = setup({ p1: { hand: ['Test Raise Dead'], graveyard: ['Test Fresh Ghoul'] } });
    s = cast(s, 'Test Raise Dead', 'hand', 'p1', { targets: [[obj(find(s, 'Test Fresh Ghoul', 'graveyard', 'p1'))]] });
    expect(onBf(s, 'p1')).toContain('Test Fresh Ghoul');
    expect(gy(s, 'p1')).toContain('Test Stitched Thing');
    s = toEndStep(s);
    expect(s.turn.step).toBe('end');
    s = settle(s);
    const id = s.zones.battlefield.find((x) => s.objects[x]!.defId === 'Test Stitched Thing');
    expect(id, 'the Thing is on the battlefield').toBeDefined();
    expect(s.objects[id!]!.tapped).toBe(true);
    expect(s.objects[id!]!.controller).toBe('p1');
  });
  it('a creature cast from your graveyard does the same; one cast from the hand, or put onto the battlefield from an opponent\'s graveyard, does not', () => {
    let s = setup({ p1: { hand: ['Test Fresh Ghoul'], graveyard: ['Test Flash Ghoul'], battlefield: ['Test Open Crypt'] } });
    s = cast(s, 'Test Flash Ghoul', 'graveyard');
    s = settle(toEndStep(s));
    expect(onBf(s, 'p1')).toContain('Test Stitched Thing');
    let t = setup({ p1: { hand: ['Test Fresh Ghoul'] } });
    t = settle(toEndStep(cast(t, 'Test Fresh Ghoul', 'hand')));
    expect(onBf(t, 'p1')).not.toContain('Test Stitched Thing');
    let u = setup({ p1: { hand: ['Test Grave Theft'] }, p2: { graveyard: ['Test Fresh Ghoul'] } });
    u = cast(u, 'Test Grave Theft', 'hand', 'p1', { targets: [[obj(find(u, 'Test Fresh Ghoul', 'graveyard', 'p2'))]] });
    u = settle(toEndStep(u));
    expect(onBf(u, 'p1')).toContain('Test Fresh Ghoul');
    expect(onBf(u, 'p1')).not.toContain('Test Stitched Thing'); // "your graveyard": the creature came from an opponent's
  });
});

describe('CR 400.7, 603.7: the delayed return finds nothing when the Thing left the graveyard before the end step', () => {
  it('exiled in response to nothing, before the end step: it stays in exile (a new object), and is not returned', () => {
    const PURGE = card('Test Purge', 'Instant', 'Exile target card from a graveyard.');
    let s = mpScenario({ defs: [THING, RAISE, FRESH, PURGE], zones: { p1: { hand: ['Test Raise Dead', 'Test Purge'], graveyard: ['Test Stitched Thing', 'Test Fresh Ghoul'] } } });
    s = cast(s, 'Test Raise Dead', 'hand', 'p1', { targets: [[obj(find(s, 'Test Fresh Ghoul', 'graveyard', 'p1'))]] });
    s = cast(s, 'Test Purge', 'hand', 'p1', { targets: [[obj(find(s, 'Test Stitched Thing', 'graveyard', 'p1'))]] });
    expect(exileOf(s, 'p1')).toContain('Test Stitched Thing');
    s = settle(toEndStep(s));
    expect(onBf(s, 'p1')).not.toContain('Test Stitched Thing');
    expect(exileOf(s, 'p1')).toContain('Test Stitched Thing');
  });
});

// ---- Rootcoil Creeper: "Return target card with flashback you own from exile to your hand." ------------------------------------------------------------------------------------------

const IMP = card('Test Root Imp', 'Creature — Plant', '{T}, Exile ~: Return target card with flashback you own from exile to your hand.', { pt: ['1', '1'] });
const ECHO = card('Test Echo Charm', 'Sorcery', 'You gain 1 life.\nFlashback {2}');
describe('CR 406.1, 108.3, 702.34a: "target card with flashback you own from exile"', () => {
  it('is automated', () => expect(full(IMP)).toBe(true));
  it('only a card with flashback that you own and that is in exile can be chosen; it goes to your hand', () => {
    let s = mpScenario({ defs: [IMP, ECHO, SPARK], zones: { p1: { battlefield: ['Test Root Imp'], exile: ['Test Echo Charm', 'Test Cinder Spark'], graveyard: ['Test Echo Charm'] }, p2: { exile: ['Test Echo Charm'] } } });
    const imp = find(s, 'Test Root Imp', 'battlefield', 'p1');
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === imp)!;
    s = act(s, { type: 'activate', player: 'p1', source: imp, ability: (a.action as { ability: string }).ability } as never);
    const p = s.pending as { kind: string; objects: string[] };
    expect(p.kind).toBe('chooseTargets');
    expect(p.objects).toEqual([find(s, 'Test Echo Charm', 'exile', 'p1')]); // not the Spark (no flashback), not the one in the graveyard, not the opponent's
    s = settle(s, { targets: [[obj(p.objects[0]!)]] });
    expect(hand(s, 'p1')).toContain('Test Echo Charm');
    expect(exileOf(s, 'p1')).not.toContain('Test Echo Charm');
    expect(exileOf(s, 'p2')).toContain('Test Echo Charm');
  });
});

// ---- Desdemona: "target creature card in your graveyard that's an artifact or that has mana value 3 or less" ---------------------------------------------------------------------

const DREAD = card('Test Dread Dial', 'Artifact', '{T}: Target creature card in your graveyard that\'s an artifact or that has mana value 3 or less gains escape until end of turn. The escape cost is equal to its mana cost plus exile two other cards from your graveyard.');
const GOLEM = card('Test Heavy Golem', 'Artifact Creature — Golem', '', { cost: '{5}', pt: ['5', '5'] });
const OGRE = card('Test Heavy Ogre', 'Creature — Ogre', '', { cost: '{5}', pt: ['5', '5'] });
const IMP3 = card('Test Cheap Imp', 'Creature — Imp', '', { cost: '{3}', pt: ['1', '1'] });
const SPRITE = card('Test Mid Sprite', 'Creature — Faerie', '', { cost: '{4}', pt: ['1', '1'] });
const TRINKET = card('Test Cheap Trinket', 'Artifact', '', { cost: '{1}' });

describe('CR 205.2a, 202.3, 115.1: a target that is an artifact creature card or a creature card with mana value 3 or less', () => {
  it('is automated', () => expect(full(DREAD)).toBe(true));
  it('the targets are exactly the artifact creature card (any mana value) and the creature card with mana value 3; not a mana value 4 or 5 non-artifact creature, not a non-creature artifact, not an opponent\'s card', () => {
    const s0 = mpScenario({ defs: [DREAD, GOLEM, OGRE, IMP3, SPRITE, TRINKET], zones: {
      p1: { battlefield: ['Test Dread Dial'], graveyard: ['Test Heavy Golem', 'Test Heavy Ogre', 'Test Cheap Imp', 'Test Mid Sprite', 'Test Cheap Trinket'] },
      p2: { graveyard: ['Test Cheap Imp'] } } });
    const dial = find(s0, 'Test Dread Dial', 'battlefield', 'p1');
    const a = legalActions(s0, 'p1').find((x) => x.kind === 'activate' && x.object === dial)!;
    const s = act(s0, { type: 'activate', player: 'p1', source: dial, ability: (a.action as { ability: string }).ability } as never);
    const p = s.pending as { kind: string; objects: string[] };
    expect(p.kind).toBe('chooseTargets');
    expect([...p.objects].sort()).toEqual([find(s0, 'Test Heavy Golem', 'graveyard', 'p1'), find(s0, 'Test Cheap Imp', 'graveyard', 'p1')].sort());
  });
});
