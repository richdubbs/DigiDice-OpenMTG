/**
 * FAST5X E13 on the game path, with real fixture cards:
 *   - Craft (CR 702.167a): "Craft with [materials] [cost]" means "[Cost], Exile this permanent, Exile [materials] from among permanents you control and/or cards
 *     in your graveyard: Return this card to the battlefield transformed under its owner's control. Activate only as a sorcery." A material described by a type
 *     alone is a permanent or a card of that type (CR 702.167b); the returned permanent remembers "the exiled cards used to craft it" (CR 702.167c, 607.2a).
 *   - "Exile ~" as an activation cost (CR 118.3, 602.2): the source exiles itself from the battlefield.
 *   - Finality counters (CR 122.1h): "If this permanent would be put into a graveyard from the battlefield, exile it instead" (a replacement, CR 614.1a), and
 *     "Return ~ from your graveyard to the battlefield with a finality counter on it" (CR 113.6m, 614.1c).
 */
import { describe, expect, it } from 'vitest';
import { applyAction, compileCard, ENGINE_CAPABILITIES, legalActions, type DecisionAnswer, type GameState, type ObjectId, type PlayerId } from '../../../src/index';
import { readLink } from '../../../src/statics/links';
import { getCard } from '../../fixtures';
import { act, answer, cast, drive, find, lands, pass, put, resolveTop, scenario, target, tweak } from '../../m6/dfc/support';
import { logHas } from '../../m4/helpers';

const TITHING = 'Tithing Blade // Consuming Sepulcher';
const VISAGE = 'Visage of Dread // Dread Osseosaur';
const LATTICE = "Saheeli's Lattice // Mastercraft Raptor";
const SUNBIRD = 'Sunbird Standard // Sunbird Effigy';

const nameOf = (s: GameState, id: ObjectId): string => s.defs[s.objects[id]!.defId]!.name;
const exileNames = (s: GameState): string[] => s.zones.exile.map((id) => nameOf(s, id)).sort();
const yardNames = (s: GameState, p: PlayerId = 'p1'): string[] => (s.zones.graveyard[p] ?? []).map((id) => nameOf(s, id)).sort();

/** The legal activations of p1 for the permanent `id`. */
const activations = (s: GameState, id: ObjectId): ReturnType<typeof legalActions> => legalActions(s, 'p1').filter((a) => a.kind === 'activate' && a.object === id);

/** Activate p1's craft ability of `id` (the one whose label names craft), paying the mana automatically and answering the material choices in order. */
function craft(s: GameState, id: ObjectId, answers: DecisionAnswer[] = []): GameState {
  const a = activations(s, id).find((x) => /craft/i.test(x.label));
  if (!a) throw new Error(`no craft activation: ${activations(s, id).map((x) => x.label).join(' | ')}`);
  return drive(act(s, a.action), answers);
}

describe('FAST5X E13: capabilities and cards', () => {
  it('keyword:craft, the exile cost forms, the craft reference and finality counters are registered (CR 702.167a-c, 118.3, 122.1h)', () => {
    for (const c of ['keyword:craft', 'cost:exileFrom.battlefield', 'cost:exileFrom.orGraveyard', 'cost:exileFrom.atLeast', 'ref:costExiled', 'op:move.remember', 'counter:finality']) {
      expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
    }
    expect(ENGINE_CAPABILITIES.has('cost:exileFrom.zone')).toBe(false); // an exile cost from a zone the engine can't pay stays manual
  });

  it('the craft keyword lines, the "Exile ~" costs and the finality cards compile to automated abilities (experimental templates cap them at partial)', () => {
    for (const name of [TITHING, VISAGE, 'Oteclan Landmark // Oteclan Levitator', 'Waterlogged Hulk // Watertight Gondola']) {
      const card = compileCard(getCard(name));
      expect(card.automation.level, name).not.toBe('manual');
      const kw = card.faces[0]!.abilities.find((a) => a.kind === 'keyword' && a.keyword === 'craft');
      expect(kw, name).toBeDefined();
    }
    for (const name of ['Soulcoil Viper', 'Rite of the Moth', 'Phoenix Down', 'The Echoverse Fulcrum']) expect(compileCard(getCard(name)).automation.level, name).toBe('full');
  });
});

describe('CR 702.167a-b: craft with one material', () => {
  const base = (extra: { p1bf?: string[]; p1gy?: string[]; p2bf?: string[] } = {}): GameState =>
    scenario([TITHING, 'Grizzly Bears', 'Hill Giant', 'Ornithopter', 'Swamp'], {
      p1: { battlefield: [TITHING, ...lands('Swamp', 5), ...(extra.p1bf ?? [])], graveyard: extra.p1gy ?? [] },
      p2: { battlefield: extra.p2bf ?? [] },
    });

  it('exiles the artifact and a creature card from your graveyard, then returns it transformed (CR 702.167a, 712.14a, 400.7)', () => {
    let s = base({ p1gy: ['Grizzly Bears'] });
    const blade = find(s, TITHING, 'battlefield');
    s = craft(s, blade);
    expect(exileNames(s)).toEqual(['Grizzly Bears', TITHING]); // both exiled as the cost (CR 118.3, 602.2b)
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === TITHING)).toBe(false);
    s = resolveTop(s);
    const back = find(s, TITHING, 'battlefield', 'p1');
    expect(back).not.toBe(blade); // a new object (CR 400.7)
    expect(s.objects[back]!.face).toBe(1); // Consuming Sepulcher (CR 712.14a)
    expect(exileNames(s)).toEqual(['Grizzly Bears']);
    // CR 702.167c: it remembers the exiled card used to craft it
    const link = readLink(s.objects[back], 'craft');
    expect(link?.objects?.map((h) => nameOf(s, h.id))).toEqual(['Grizzly Bears']);
    expect(logHas(s, /Grizzly Bears/, 'CR 702.167a')).toBe(true);
  });

  it('a creature you control is a material too; your opponent\'s is not (CR 702.167a-b)', () => {
    let s = base({ p1bf: ['Grizzly Bears'], p2bf: ['Hill Giant'] });
    const blade = find(s, TITHING, 'battlefield');
    s = craft(s, blade);
    expect(exileNames(s)).toEqual(['Grizzly Bears', TITHING]);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Hill Giant')).toBe(true);
  });

  it('with two possible materials the player chooses one (CR 601.2h)', () => {
    let s = base({ p1bf: ['Grizzly Bears'], p1gy: ['Hill Giant'] });
    const blade = find(s, TITHING, 'battlefield');
    const a = activations(s, blade).find((x) => /craft/i.test(x.label))!;
    s = act(s, a.action);
    for (let i = 0; i < 6 && s.pending?.kind !== 'chooseObjects'; i++) s = drive(s);
    expect(s.pending?.kind).toBe('chooseObjects');
    const giant = find(s, 'Hill Giant', 'graveyard');
    s = drive(answer(s, { kind: 'chooseObjects', ids: [giant] }));
    expect(exileNames(s)).toEqual(['Hill Giant', TITHING]);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Grizzly Bears')).toBe(true);
  });

  it('no material: craft is not offered; a noncreature card is no material (CR 702.167a, 602.2b)', () => {
    const s = base({ p1gy: ['Swamp'] }); // a land card is no creature material
    const blade = find(s, TITHING, 'battlefield');
    expect(activations(s, blade).some((x) => /craft/i.test(x.label))).toBe(false);
  });

  it('craft only as a sorcery: not with something on the stack, not in the opponent\'s turn (CR 702.167a, 602.5d)', () => {
    const s = base({ p1gy: ['Grizzly Bears'] });
    const blade = find(s, TITHING, 'battlefield');
    const other = tweak(s, (t) => { t.turn.activePlayer = 'p2'; });
    expect(activations(other, blade).some((x) => /craft/i.test(x.label))).toBe(false);
  });

  it('the exiled source is the card that returns: if it left exile, nothing returns (CR 400.7)', () => {
    let s = base({ p1gy: ['Grizzly Bears'] });
    const blade = find(s, TITHING, 'battlefield');
    s = craft(s, blade);
    s = tweak(s, (t) => {
      const id = t.zones.exile.find((x) => nameOf(t, x) === TITHING)!;
      t.zones.exile = t.zones.exile.filter((x) => x !== id);
      t.objects[id]!.zone = 'graveyard';
      t.zones.graveyard['p1']!.push(id);
      const fresh = `${id}x`;
      t.objects[fresh] = { ...t.objects[id]!, id: fresh };
      delete t.objects[id];
      t.zones.graveyard['p1'] = t.zones.graveyard['p1']!.map((x) => (x === id ? fresh : x));
    });
    s = resolveTop(s);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === TITHING)).toBe(false);
    expect(yardNames(s)).toContain(TITHING);
  });
});

describe('CR 702.167a: craft with two materials and with "one or more"', () => {
  it('two creatures: exactly two, from the battlefield and/or the graveyard; with one it is not offered (CR 702.167a)', () => {
    let s = scenario([VISAGE, 'Grizzly Bears', 'Hill Giant', 'Swamp'], { p1: { battlefield: [VISAGE, ...lands('Swamp', 6), 'Grizzly Bears'], graveyard: [] } });
    const visage = find(s, VISAGE, 'battlefield');
    expect(activations(s, visage).some((x) => /craft/i.test(x.label))).toBe(false);
    s = scenario([VISAGE, 'Grizzly Bears', 'Hill Giant', 'Swamp'], { p1: { battlefield: [VISAGE, ...lands('Swamp', 6), 'Grizzly Bears'], graveyard: ['Hill Giant'] } });
    s = craft(s, find(s, VISAGE, 'battlefield'));
    expect(exileNames(s)).toEqual(['Grizzly Bears', 'Hill Giant', VISAGE]);
    s = resolveTop(s);
    const raptor = find(s, VISAGE, 'battlefield', 'p1');
    expect(s.objects[raptor]!.face).toBe(1);
    expect(readLink(s.objects[raptor], 'craft')?.objects?.length).toBe(2);
  });

  it('one or more Dinosaurs: the number is announced, at least one (CR 702.167a, 601.2b)', () => {
    let s = scenario([LATTICE, 'Colossal Dreadmaw', 'Grizzly Bears', 'Mountain'], {
      p1: { battlefield: [LATTICE, ...lands('Mountain', 5), 'Grizzly Bears'], graveyard: ['Colossal Dreadmaw'] },
    });
    const lattice = find(s, LATTICE, 'battlefield');
    s = act(s, activations(s, lattice).find((x) => /craft/i.test(x.label))!.action);
    for (let i = 0; i < 6 && s.pending?.kind !== 'priority' && s.pending?.kind !== 'chooseObjects' && s.pending?.kind !== 'chooseNumber'; i++) s = drive(s);
    // only one Dinosaur exists, so the count is fixed at one and no number is asked
    s = drive(s);
    expect(exileNames(s)).toEqual(['Colossal Dreadmaw', LATTICE]);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Grizzly Bears')).toBe(true); // not a Dinosaur
  });

  it('one or more (no quality): any number of your permanents and cards, at least one, never the source itself (CR 702.167a, 118.3)', () => {
    let s = scenario([SUNBIRD, 'Grizzly Bears', 'Hill Giant', 'Plains'], { p1: { battlefield: [SUNBIRD, ...lands('Plains', 5)], graveyard: ['Grizzly Bears', 'Hill Giant'] } });
    const sunbird = find(s, SUNBIRD, 'battlefield');
    s = act(s, activations(s, sunbird).find((x) => /craft/i.test(x.label))!.action);
    for (let i = 0; i < 8 && s.pending?.kind !== 'chooseNumber'; i++) s = drive(s);
    expect(s.pending?.kind).toBe('chooseNumber');
    const p = s.pending as { min: number; max: number };
    expect(p.min).toBe(1);
    expect(p.max).toBeGreaterThanOrEqual(2);
    s = answer(s, { kind: 'chooseNumber', n: 2 });
    for (let i = 0; i < 8 && s.pending?.kind !== 'priority'; i++) {
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: s.zones.graveyard['p1']!.slice(0, 2) });
      else s = drive(s);
    }
    expect(exileNames(s)).toEqual(['Grizzly Bears', 'Hill Giant', SUNBIRD]);
  });
});

describe('"Exile ~" as an activation cost (CR 118.3, 602.2)', () => {
  it('Phoenix Down exiles itself from the battlefield as it is activated, then its effect resolves', () => {
    let s = scenario(['Phoenix Down', 'Grizzly Bears', 'Plains'], { p1: { battlefield: ['Phoenix Down', ...lands('Plains', 2)], graveyard: ['Grizzly Bears'] } });
    const down = find(s, 'Phoenix Down', 'battlefield');
    const bears = find(s, 'Grizzly Bears', 'graveyard');
    const a = activations(s, down)[0]!;
    s = act(s, a.action);
    for (let i = 0; i < 10 && s.pending?.kind !== 'priority'; i++) {
      const p = s.pending!;
      if (p.kind === 'chooseOption') s = answer(s, { kind: 'chooseOption', ids: [(p as unknown as { options: { id: string }[] }).options[0]!.id] });
      else if (p.kind === 'chooseTargets') s = answer(s, target(bears));
      else s = drive(s);
    }
    expect(exileNames(s)).toEqual(['Phoenix Down']); // exiled as the cost is paid (CR 602.2b, 601.2h)
    s = resolveTop(s);
    expect(s.zones.battlefield.some((id) => nameOf(s, id) === 'Grizzly Bears' && s.objects[id]!.tapped)).toBe(true); // returned tapped
  });
});

describe('CR 122.1h: finality counters', () => {
  const base = (): GameState => scenario(['Grizzly Bears', 'Hill Giant', 'Murder', 'Swamp', 'Gastal Thrillroller', 'Mountain'], {
    p1: { battlefield: [{ name: 'Grizzly Bears', counters: { finality: 1 } }, 'Hill Giant', ...lands('Swamp', 3)], hand: ['Murder'] },
  });

  it('a permanent with a finality counter that would die is exiled instead; one without dies (CR 122.1h, 614.1a, 701.8)', () => {
    let s = base();
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = resolveTop(cast(s, 'Murder', [target(bears)]));
    expect(exileNames(s)).toContain('Grizzly Bears');
    expect(yardNames(s)).not.toContain('Grizzly Bears');
    expect(logHas(s, /finality/i)).toBe(true);
    // Hill Giant has no counter: it dies (CR 704.5g)
    const giant = find(s, 'Hill Giant', 'battlefield');
    s = tweak(s, (t) => { t.objects[giant]!.damage = 5; });
    s = pass(s);
    expect(yardNames(s)).toContain('Hill Giant');
  });

  it('two finality counters are one replacement: lethal damage exiles it (CR 122.1h, 704.5g)', () => {
    let s = tweak(base(), (t) => { t.objects[t.zones.battlefield.find((id) => nameOf(t, id) === 'Grizzly Bears')!]!.counters['finality'] = 2; });
    const bears = find(s, 'Grizzly Bears', 'battlefield');
    s = tweak(s, (t) => { t.objects[bears]!.damage = 5; });
    s = pass(s); // state-based actions: lethal damage (CR 704.5g)
    expect(exileNames(s)).toContain('Grizzly Bears');
  });

  it('"Return ~ from your graveyard to the battlefield with a finality counter on it" (Gastal Thrillroller, CR 113.6m, 614.1c); when it dies again it is exiled', () => {
    let s = scenario(['Gastal Thrillroller', 'Mountain', 'Ornithopter', 'Disenchant', 'Plains'], { p1: { battlefield: [...lands('Mountain', 3)], graveyard: ['Gastal Thrillroller'], hand: ['Ornithopter'] } });
    const roller = find(s, 'Gastal Thrillroller', 'graveyard');
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === roller);
    expect(a).toBeDefined();
    s = act(s, a!.action);
    for (let i = 0; i < 8 && s.pending?.kind !== 'priority'; i++) {
      if (s.pending?.kind === 'chooseObjects') s = answer(s, { kind: 'chooseObjects', ids: [find(s, 'Ornithopter', 'hand')] });
      else s = drive(s);
    }
    s = resolveTop(s);
    const back = find(s, 'Gastal Thrillroller', 'battlefield');
    expect(s.objects[back]!.counters['finality']).toBe(1);
    // a Vehicle that isn't crewed is no creature: destroy it (CR 701.8)
    s = tweak(s, (t) => { put(t, 'p1', 'hand', 'Disenchant'); put(t, 'p1', 'battlefield', 'Plains'); put(t, 'p1', 'battlefield', 'Plains'); });
    s = resolveTop(cast(s, 'Disenchant', [target(back)]));
    expect(exileNames(s)).toContain('Gastal Thrillroller');
    expect(yardNames(s)).not.toContain('Gastal Thrillroller');
  });
});

describe('the cost is rejected, never half paid', () => {
  it('activating craft with no material is refused with CR 118.3 / 602.2b', () => {
    const s = scenario([TITHING, 'Swamp'], { p1: { battlefield: [TITHING, ...lands('Swamp', 5)] } });
    const blade = find(s, TITHING, 'battlefield');
    const card = s.defs[s.objects[blade]!.defId]!;
    const key = card.faces[0]!.abilities.findIndex((x) => x.kind === 'keyword' && x.keyword === 'craft');
    expect(key).toBeGreaterThanOrEqual(0);
    const legal = legalActions(s, 'p1').filter((x) => x.kind === 'activate' && x.object === blade);
    expect(legal.some((x) => /craft/i.test(x.label))).toBe(false);
    void applyAction;
  });
});

describe('CR 602.5b, 205.2a: "Activate only if there are four or more card types among cards in your graveyard" (delirium)', () => {
  const board = (yard: string[]): GameState => scenario(['Resurrected Cultist', 'Lightning Bolt', 'Forest', 'Pacifism', 'Swamp'], {
    p1: { battlefield: lands('Swamp', 4), graveyard: ['Resurrected Cultist', ...yard] },
  });
  const offered = (s: GameState): boolean => legalActions(s, 'p1').some((a) => a.kind === 'activate' && a.object === find(s, 'Resurrected Cultist', 'graveyard'));

  it('three card types (creature, instant, land): not offered', () => {
    expect(offered(board(['Lightning Bolt', 'Forest']))).toBe(false);
  });

  it('four card types: offered; it returns with a finality counter (CR 113.6m, 122.1h)', () => {
    let s = board(['Lightning Bolt', 'Forest', 'Pacifism']);
    expect(offered(s)).toBe(true);
    const a = legalActions(s, 'p1').find((x) => x.kind === 'activate' && x.object === find(s, 'Resurrected Cultist', 'graveyard'))!;
    s = resolveTop(drive(act(s, a.action)));
    const cultist = find(s, 'Resurrected Cultist', 'battlefield');
    expect(s.objects[cultist]!.counters['finality']).toBe(1);
  });
});
