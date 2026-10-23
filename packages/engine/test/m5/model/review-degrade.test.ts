/**
 * Review round on model/degrade.ts, model/classify.ts and the manual forms they produce: reminders and mana costs (idempotence), event reads of a manual
 * trigger (CR 603.7c), sentences shared by several steps, manual shields (design 6.7 E1), activation restrictions of a manual ability (CR 602.5),
 * the link taint in classifyCard (CR 607.1) and the unreviewed-LLM cap (design 10.4).
 */
import { describe, expect, it } from 'vitest';
import {
  capabilitiesOf, classifyAbility, classifyCard, degradeAbility, manualNodes, missingCapabilities, validateAbility, type ClassifyInput, type FaceLines,
} from '../../../src/model';
import type { AbilityDef } from '../../../src/types/ability';
import { EXAMPLES } from './examples';

type J = Record<string, unknown>;
const ab = (x: J): AbilityDef => x as unknown as AbilityDef;
const NO_LINES: FaceLines = { lines: [], sentences: [] };
const at = (def: unknown, path: string): unknown =>
  path.split('/').filter(Boolean).reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as J)[k] : undefined), def);
const without = (def: AbilityDef, ...names: string[]): Set<string> => new Set(capabilitiesOf(def).filter((c) => !names.includes(c)));
const spec = (id: string): J => ({ id, kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } });
const draw = (extra: J = {}): J => ({ op: 'draw', who: { ref: 'you' }, count: 1, ...extra });
const example = (name: string): AbilityDef[] => EXAMPLES.find((e) => e.name === name)!.faces.flatMap((f) => f.abilities);

describe('design 10.2: degrading is idempotent and its result needs nothing the set lacks (reminders, mana costs)', () => {
  it('a manual ability whose `reminder` the engine cannot show loses the reminder (feature:manual.reminder missing)', () => {
    const a = ab({ kind: 'manual', text: 'x', reason: 'r', shape: 'spell', reminder: { d: 'endOfTurn' } });
    const r = degradeAbility(a, new Set(), NO_LINES);
    expect(r.requires).toEqual(['feature:manual.reminder']);
    expect((r.def as unknown as J)['reminder']).toBeUndefined();
    expect(missingCapabilities(r.def, new Set())).toEqual([]);
    expect(degradeAbility(r.def, new Set(), NO_LINES).def).toBe(r.def);
  });
  it('a mana ability with a cost part the engine lacks keeps the part as a manual cost part, so a second pass changes nothing (CR 605.3b)', () => {
    const a = ab({ kind: 'activated', text: '{T}, Sacrifice ~: Add {C}{C}.', isMana: true, cost: { tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['C'], ['C']] }] } });
    const caps = without(a, 'cost:sacrifice');
    const r = degradeAbility(a, caps, NO_LINES);
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'activated', mana: true });
    expect(missingCapabilities(r.def, caps)).toEqual([]);
    const again = degradeAbility(r.def, caps, NO_LINES);
    expect(again.def).toBe(r.def);
    expect(again.requires).toEqual([]);
    expect(validateAbility(r.def)).toEqual([]);
  });
  it('a manual step with its own text keeps that text when it is the culprit (its reminder is not available)', () => {
    const text = 'If that creature would die this turn, exile it instead.';
    const a = ab({ kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'manual', text, reason: 'manual shield', reminder: { d: 'endOfTurn' } }] } });
    const r = degradeAbility(a, new Set(), NO_LINES);
    expect(at(r.def, '/effect/steps/0/text')).toBe(text);
    expect(at(r.def, '/effect/steps/0/reminder')).toBeUndefined();
  });
});

describe('CR 603.7c, 603.4: a manual trigger has no event, so an effect that reads one is not kept', () => {
  const gainToughness = ab({
    kind: 'triggered', text: 'Whenever a creature dies, you gain life equal to its toughness.', limit: { per: 'turn', max: 1 },
    trigger: { on: [{ ev: 'zoneChange', subject: { types: ['Creature'] }, from: 'battlefield', to: 'graveyard' }] },
    effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'toughness', of: { ref: 'event', role: 'subject' } } }] },
  });
  it('the effect that reads {ref:event} is dropped from the manual ability', () => {
    const r = degradeAbility(gainToughness, without(gainToughness, 'ev:zoneChange'), NO_LINES);
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect((r.def as unknown as J)['effect']).toBeUndefined();
    expect(validateAbility(r.def)).toEqual([]);
  });
  it('an effect that reads no event is kept; the limit is kept and a dropped intervening if is named in the reason (CR 603.2h, 603.4)', () => {
    const plain = ab({ ...(gainToughness as unknown as J), interveningIf: { cond: 'turnOf', whose: 'you' }, effect: { targets: [], steps: [draw()] } });
    const r = degradeAbility(plain, without(plain, 'ev:zoneChange'), NO_LINES);
    expect(at(r.def, '/effect/steps/0/op')).toBe('draw');
    expect(at(r.def, '/limit')).toEqual({ per: 'turn', max: 1 });
    expect(String((r.def as unknown as J)['reason'])).toContain('intervening if');
    expect(validateAbility(r.def)).toEqual([]);
  });
  it('the lint rejects an event read inside the effect of a manual ability', () => {
    const m = ab({ kind: 'manual', text: 'x', reason: 'r', shape: 'triggered', effect: { targets: [], steps: [{ op: 'gainLife', who: { ref: 'you' }, amount: { q: 'stat', stat: 'toughness', of: { ref: 'event', role: 'subject' } } }] } });
    expect(validateAbility(m).map((i) => i.code)).toContain('bad-event-role');
  });
});

describe('design 6.6, 10.2: the sentence is the unit of manual text, so steps of one sentence degrade together', () => {
  const lines: FaceLines = { lines: ['Draw a card and scry 2.'], sentences: [['Draw a card and scry 2.']] };
  const a = ab({ kind: 'spell', text: 'Draw a card and scry 2.', src: [0], effect: { targets: [], steps: [draw({ sentence: 0 }), { op: 'scry', who: { ref: 'you' }, count: 2, sentence: 0 }] } });
  it('the automated sibling of a manual step from the same sentence is merged into the one manual step', () => {
    const r = degradeAbility(a, without(a, 'op:scry'), lines);
    expect(at(r.def, '/effect/steps')).toEqual([{ op: 'manual', text: 'Draw a card and scry 2.', reason: 'needs-engine: op:scry', sentence: 0 }]);
    expect(validateAbility(r.def)).toEqual([]);
  });
  it('steps of other sentences stay automated and the result is idempotent', () => {
    const three = ab({ kind: 'spell', text: 'x', src: [0], effect: { targets: [], steps: [draw({ sentence: 1 }), draw({ sentence: 0 }), { op: 'scry', who: { ref: 'you' }, count: 2, sentence: 0 }] } });
    const l: FaceLines = { lines: ['Draw a card and scry 2. Draw a card.'], sentences: [['Draw a card and scry 2.', 'Draw a card.']] };
    const caps = without(three, 'op:scry');
    const r = degradeAbility(three, caps, l);
    expect((at(r.def, '/effect/steps') as J[]).map((s) => s['op'])).toEqual(['draw', 'manual']);
    expect(degradeAbility(r.def, caps, l).def).toBe(r.def);
  });
});

describe('design 6.7 E1: a manual shield is exempt from contagion, so the automated part of the spell stays automated (Magma Spray)', () => {
  const lines: FaceLines = {
    lines: ['~ deals 2 damage to target creature. If that creature would die this turn, exile it instead.'],
    sentences: [['~ deals 2 damage to target creature.', 'If that creature would die this turn, exile it instead.']],
  };
  const m6 = ab({
    kind: 'spell', text: '~ deals 2 damage to target creature. If that creature would die this turn, exile it instead.', src: [0],
    effect: {
      targets: [spec('t0')],
      steps: [
        { op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 2, sentence: 0 },
        {
          op: 'effect', sentence: 1, duration: { d: 'endOfTurn' },
          effects: [{ s: 'replace', replaces: { ev: 'zoneChange', subject: { is: { ref: 'target', id: 't0' } }, from: 'battlefield', to: 'graveyard' }, body: { b: 'modify', destination: { zone: 'exile' } }, shield: { uses: 1 } }],
        },
      ],
    },
  });
  const m5caps = (...drop: string[]): Set<string> => new Set([...capabilitiesOf(m6), 'feature:manual.reminder'].filter((c) => !['feature:replace.foreign', 'body:modify', 'body:modify.destination', ...drop].includes(c)));
  it('the shield becomes a manual step with a reminder chip; the damage stays automated; the card is partial', () => {
    const r = degradeAbility(m6, m5caps(), lines);
    expect(at(r.def, '/effect/steps/0/op')).toBe('damage');
    expect(at(r.def, '/effect/steps/1')).toEqual({
      op: 'manual', text: 'If that creature would die this turn, exile it instead.', reason: expect.stringContaining('needs-engine'), sentence: 1, reminder: { d: 'endOfTurn' },
    });
    expect(classifyAbility(m6, m5caps()).level).toBe('partial');
    expect(validateAbility(r.def)).toEqual([]);
  });
  it('without the reminder chip either, the damage still stays automated', () => {
    const caps = m5caps('feature:manual.reminder');
    const r = degradeAbility(m6, caps, lines);
    expect(at(r.def, '/effect/steps/0/op')).toBe('damage');
    expect(at(r.def, '/effect/steps/1/op')).toBe('manual');
    expect(at(r.def, '/effect/steps/1/reminder')).toBeUndefined();
    expect(missingCapabilities(r.def, caps)).toEqual([]);
    expect(degradeAbility(r.def, caps, lines).def).toBe(r.def);
  });
});

describe('CR 602.5, 113.6: a manual ability keeps the activation restrictions of the ability it replaces', () => {
  const a = ab({
    kind: 'activated', text: '{T}: Tap target creature. Activate only as a sorcery.', sorcerySpeed: true, limit: { per: 'turn', max: 1 }, zone: ['graveyard'],
    cost: { tap: true }, effect: { targets: [spec('t0')], steps: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] },
    onlyIf: { cond: 'turnOf', whose: 'you' },
  });
  it('sorcerySpeed, limit and zone are copied; the restriction condition becomes an attested (ask) condition', () => {
    const caps = without(a, 'target:object');
    const r = degradeAbility(a, caps, NO_LINES);
    expect(r.def).toMatchObject({ kind: 'manual', shape: 'activated', sorcerySpeed: true, limit: { per: 'turn', max: 1 }, zone: ['graveyard'], cost: { tap: true } });
    expect(at(r.def, '/onlyIf/cond')).toBe('ask');
    expect(validateAbility(r.def)).toEqual([]);
    expect(missingCapabilities(r.def, caps)).toEqual([]);
    expect(degradeAbility(r.def, caps, NO_LINES).def).toBe(r.def);
  });
});

describe('CR 607.1: classifyCard degrades the abilities of a face together, so a link consumer whose producer became manual is not full', () => {
  const fiend = example('Fiend Hunter');
  const caps = new Set(fiend.flatMap(capabilitiesOf).filter((c) => c !== 'filter:other'));
  it('the leaves-the-battlefield ability is partial with a manual span, not full', () => {
    const r = classifyCard({ faces: [{ abilities: fiend, lines: NO_LINES }], source: 'templates' }, caps);
    const levels = r.faces![0]!.abilities;
    expect(levels[0]!.level).toBe('manual');
    expect(levels[1]!.level).toBe('partial');
    expect(levels[1]!.manual.length).toBeGreaterThan(0);
    expect(r.unsupported.length).toBeGreaterThan(0);
  });
});

describe('design 10.4, 1.1.17: unreviewed LLM data never makes a card full, whatever source the caller passes', () => {
  const bolt = example('Lightning Bolt')[0]!;
  const allCaps = new Set(capabilitiesOf(bolt));
  const withProv = (prov: J): AbilityDef => ab({ ...(bolt as unknown as J), prov });
  const level = (def: AbilityDef, extra: Partial<ClassifyInput> = {}): string =>
    classifyCard({ faces: [{ abilities: [def], lines: NO_LINES }], source: 'templates', ...extra }, allCaps).level;
  it('prov.by llm without review: partial', () => {
    expect(level(bolt)).toBe('full');
    expect(level(withProv({ by: 'llm' }))).toBe('partial');
    expect(level(withProv({ by: 'llm' }), { source: 'none' })).toBe('partial');
  });
  it('an ability nested in another (a granted ability) counts too', () => {
    const grant = ab({
      kind: 'spell', text: 'x',
      effect: { targets: [], steps: [{ op: 'effect', duration: { d: 'endOfTurn' }, effects: [{ s: 'continuous', affects: { ref: 'self' }, mods: [{ layer: 6, add: [{ kind: 'keyword', text: 'Haste', keyword: 'haste', prov: { by: 'llm' } }] }] }] }] },
    });
    const caps = new Set(capabilitiesOf(grant));
    expect(classifyCard({ faces: [{ abilities: [grant], lines: NO_LINES }], source: 'templates' }, caps).level).toBe('partial');
  });
  it('reviewed data is full: prov.reviewed, or a review state of reviewed', () => {
    expect(level(withProv({ by: 'llm', reviewed: true }))).toBe('full');
    expect(level(withProv({ by: 'llm' }), { review: 'reviewed' })).toBe('full');
  });
  it('other provenance is not capped', () => {
    expect(level(withProv({ by: 'template', id: 't1' }))).toBe('full');
  });
});

describe('property: degrading any understood ability with any capability subset is idempotent and complete (fuzz over the worked examples)', () => {
  const rng = (seed: number) => () => ((seed ^= seed << 13), (seed ^= seed >>> 17), (seed ^= seed << 5), (seed >>> 0) / 4294967296);
  // shapes the worked examples do not have, found by the review: a mana ability with a sacrifice cost, manual abilities and steps with reminders,
  // restricted activated abilities, a manual trigger that reads its event, steps that share a sentence
  const extra: J[] = [
    { kind: 'activated', text: 'x', isMana: true, cost: { tap: true, other: [{ kind: 'sacrifice', filter: { self: true }, count: 1, self: true }] }, effect: { targets: [], steps: [{ op: 'addMana', who: { ref: 'you' }, units: [['C'], ['C']] }] } },
    { kind: 'manual', text: 'x', reason: 'r', shape: 'spell', reminder: { d: 'endOfTurn' } },
    { kind: 'spell', text: 'x', effect: { targets: [], steps: [{ op: 'manual', text: 'If it would die this turn, exile it instead.', reason: 'r', reminder: { d: 'endOfTurn' } }, draw()] } },
    { kind: 'activated', text: 'x', sorcerySpeed: true, limit: { per: 'game', max: 1 }, zone: ['graveyard'], cost: { tap: true }, onlyIf: { cond: 'turnOf', whose: 'you' }, effect: { targets: [spec('t0')], steps: [{ op: 'tap', what: { ref: 'target', id: 't0' } }] } },
    { kind: 'triggered', text: 'x', trigger: { on: [{ ev: 'draw' }] }, interveningIf: { cond: 'turnOf', whose: 'you' }, limit: { per: 'turn', max: 1 }, effect: { targets: [], steps: [draw({ count: { q: 'eventAmount' } })] } },
    { kind: 'spell', text: 'x', effect: { targets: [], steps: [draw({ sentence: 0 }), { op: 'scry', who: { ref: 'you' }, count: 2, sentence: 0 }, draw({ sentence: 1 })] } },
  ];
  const abilities = [
    ...EXAMPLES.flatMap((e) => e.faces.flatMap((f) => f.abilities.map((a) => ({ name: e.name, a })))),
    ...extra.map((a, i) => ({ name: `shape ${i}`, a: ab(a) })),
  ];
  it('3000 abilities x random drops of their own capabilities: nothing missing afterwards, a second pass is a no-op, the result validates', () => {
    const next = rng(88172645);
    for (let i = 0; i < 3000; i++) {
      const { name, a } = abilities[i % abilities.length]!;
      const own = capabilitiesOf(a);
      const have = new Set(own.filter(() => next() < 0.7));
      const r = degradeAbility(a, have, NO_LINES);
      const where = `${name} #${i} without ${own.filter((c) => !have.has(c)).join(',')}`;
      expect(missingCapabilities(r.def, have), where).toEqual([]);
      expect(validateAbility(r.def), where).toEqual([]);
      const again = degradeAbility(r.def, have, NO_LINES);
      expect(again.requires, where).toEqual([]);
      expect(again.def, where).toBe(r.def);
      expect(manualNodes(r.def).length > 0 || r.requires.length === 0 || own.length === 0, where).toBe(true);
    }
  });
});
