/**
 * WP17 review round: regression tests for the findings of the WP17 review. Each test is named after the rule it pins. Synthetic wordings (design 6.10);
 * the real cards named by the review are checked from the local Oracle index when it exists (skipped otherwise).
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, ActivatedAbilityDef, ManualAbilityDef } from '../../../src/types/ability';
import { BOOTSTRAP_TEMPLATES, parseCard } from '../../../src/parser/parse';
import { demote } from '../../../src/parser/lower/verify';
import { validateAbility } from '../../../src/model/validate';
import { lowerTargets } from '../../../src/parser/lower/targets';
import { lowerAnaphora } from '../../../src/parser/lower/anaphora';
import { lowerConditions } from '../../../src/parser/lower/conditions';
import { lowerQuantities } from '../../../src/parser/lower/quantities';
import { parseQuoted } from '../../../src/parser/lower/quoted';
import { adaptTokens } from '../../../src/parser/holes';
import { tokenize } from '../../../src/parser/tokenize';
import { DEFAULT_BUDGET } from '../../../src/parser/chart';
import { EXAMPLES } from '../model/examples';
import { A, EXTRA, NUM, bare, card, creature, draft, face, localIndex, options, T, tpl, unit } from './support';

type Eff = { targets: Record<string, unknown>[]; steps: Record<string, unknown>[]; modes?: { options: { program: { targets: Record<string, unknown>[]; steps: Record<string, unknown>[] } }[] } };
const effectOf = (a: AbilityDef | undefined): Eff => (a as unknown as { effect: Eff }).effect;
const json = (v: unknown): string => JSON.stringify(v);
/** Every step of an ability (nested ones included). */
function steps(a: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o['op'] === 'string') out.push(o);
    Object.values(o).forEach(walk);
  };
  walk(a);
  return out;
}
const automatedOps = (a: unknown): string[] => steps(a).map((s) => String(s['op'])).filter((op) => op !== 'manual');

const gain = tpl('effect', '{o:Objs} gain[s] {a:Abilities} {d:Dur}', { op: 'effect', duration: '$d', effects: [{ s: 'continuous', affects: '$o', mods: [{ layer: 6, add: '$a' }] }] }, { id: 'test.gain' });

describe('WP17 review: no marker survives lowering, target specs included (design 6.5 pass 10, guard G11)', () => {
  it('CR 607.2: a "$link" placeholder inside a target phrase makes the sentence manual and the target is not announced', () => {
    const f = face(card('Hue Paladin', 'Creature — Human Knight', '{W}{W}, {T}: Destroy target permanent of the chosen color.'), options());
    expect(json(f.abilities)).not.toContain('$link');
    expect(automatedOps(f.abilities)).not.toContain('destroy');
  });
  it('CLOUD C5 (CR 607.2d, 601.2c): with the face\'s "As ~ enters, choose a color." the target reads that choice (made before the ability is activated); no marker survives', () => {
    const f = face(card('Hue Paladin', 'Creature — Human Knight', 'As this creature enters, choose a color.\n{W}{W}, {T}: Destroy target permanent of the chosen color.'), options());
    expect(json(f.abilities)).not.toContain('$link');
    expect(json(f.abilities)).toContain('"chosen":{"link":"color","quality":"color"}');
    expect(automatedOps(f.abilities)).toContain('destroy');
  });
  it('design 6.4: "that player" inside a target phrase resolves against the trigger event role, never left as a marker', () => {
    const f = face(card('Raid Wisp', 'Creature — Spirit', 'Whenever this creature deals combat damage to a player, destroy target artifact that player controls.'));
    expect(json(f.abilities)).not.toContain('$anaphor');
    const a = f.abilities[0]!;
    if (a.kind === 'triggered') expect(effectOf(a).targets[0]).toMatchObject({ filter: { controller: { ref: 'event' } } });
    else expect(f.diagnostics.some((d) => /schema at .*\$anaphor/.test(d.message))).toBe(false);
  });
});

describe('WP17 review: the effect kept on a manual triggered ability is checked (design 6.6, guards G6 and G7)', () => {
  it('design 6.4, 6.6: with no trigger understood, a pronoun in the kept effect has unknown candidates: no effect is kept', () => {
    const f = face(card('Bomb Myr', 'Artifact Creature — Myr', 'When this creature dies, it deals 2 damage to any target.'), options());
    const a = f.abilities[0] as ManualAbilityDef;
    expect(a).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect(a.effect).toBeUndefined();
    expect(json(f.abilities)).not.toContain('"source":{"ref":"target"');
  });
  it('design 6.6: a kept effect is gated against its own text, and FaceParse.gate records that result', () => {
    const f = face(card('Odd Wisp', 'Creature — Spirit', 'Whenever the moon rises, draw a card.'));
    expect(f.abilities[0]).toMatchObject({ kind: 'manual', shape: 'triggered', effect: { steps: [{ op: 'draw' }] } });
    expect(f.gate[0]!.ok).toBe(true);
  });
  it('CR 603.4, 603.7c: an intervening "if" the model cannot state keeps only an effect that is correct and reads no event', () => {
    const f = face(card('Fly Wisp', 'Creature — Spirit', 'When this creature enters, if it has a +1/+1 counter on it, it deals 2 damage to target creature.'));
    expect(json(f.abilities)).not.toContain('"source":{"ref":"target"');
    expect(json(f.abilities)).not.toContain('$anaphor');
    const kept = (f.abilities[0] as ManualAbilityDef).effect;
    if (kept !== undefined) expect(json(kept)).not.toContain('"ref":"event"');
  });
});

describe('WP17 review: pronouns look back only (design 6.4)', () => {
  it('design 6.4: a pronoun never binds to a target that follows it in its sentence', () => {
    // (WP21: "~" named by an earlier step is a candidate itself, design 6.4, so the earlier sentence names no object here)
    const f = face(card('Spark Totem', 'Artifact', '{2}: Draw a card. It deals 1 damage to any target.'));
    expect(json(f.abilities)).not.toContain('"source":{"ref":"target"');
    // refused by the anaphora pass itself, not only by the render gate
    expect(f.diagnostics.some((d) => d.code === 'unbound-reference' && /"it" has no compatible/i.test(d.message))).toBe(true);
  });
  it('design 13.3 (Flametongue Kavu): "it" after the object\'s own enters trigger is the object, the later target is not a candidate', () => {
    const f = face(card('Flame Kavu', 'Creature — Kavu', 'When this creature enters, it deals 3 damage to target creature.'), options());
    expect(bare(f.abilities)).toEqual([{
      kind: 'triggered',
      text: 'When ~ enters, it deals 3 damage to target creature.',
      trigger: { on: [{ ev: 'zoneChange', subject: { self: true }, to: 'battlefield' }] },
      effect: {
        targets: [{ id: 't0', kind: 'object', min: 1, max: 1, text: 'target creature', filter: { types: ['Creature'] } }],
        steps: [{ op: 'damage', source: { ref: 'self' }, to: { ref: 'target', id: 't0' }, amount: 3 }],
      },
    }]);
    expect(f.gate[0]!.ok).toBe(true);
  });
});

describe('WP17 review: mana abilities (CR 605.1a, 605.3b)', () => {
  it('CR 605.1a: an activated mana ability whose effect is not understood stays a mana ability with its cost', () => {
    const f = face(card('Twin Gate', 'Land — Gate', '{T}: Add {W} or {U}.'), options());
    expect(f.abilities[0]).toMatchObject({ kind: 'manual', shape: 'activated', mana: true, cost: { tap: true } });
  });
  it('CR 605.1a, 602.5b: a mana ability with an activation restriction is still a mana ability, and the restriction is onlyIf', () => {
    const f = face(card('Root Verge', 'Land', '{T}: Add {G}. Activate only if you control a Forest or an Island.'), options());
    const a = f.abilities[0]!;
    if (a.kind === 'activated') expect(a).toMatchObject({ isMana: true, onlyIf: { cond: expect.any(String) }, effect: { steps: [{ op: 'addMana' }] } });
    else expect(a).toMatchObject({ kind: 'manual', mana: true, onlyIf: { cond: 'ask' } });
  });
  it('CR 605.3b: a demoted mana ability keeps mana:true and its restrictions', () => {
    const def: ActivatedAbilityDef = { kind: 'activated', text: '{T}: Add {G}.', cost: { tap: true }, effect: { targets: [], steps: [] }, isMana: true, onlyIf: { cond: 'turnOf', whose: 'you' } };
    expect(demote(def, 'x')).toMatchObject({ kind: 'manual', mana: true, cost: { tap: true }, onlyIf: { cond: 'ask' } });
  });
});

describe('WP17 review: activation and trigger restrictions are never effect sentences (CR 602.5b, 603.2h, design 6.6)', () => {
  it('CR 602.5b: "Activate only during your turn." is onlyIf; the effect stays automated', () => {
    const f = face(card('Turn Totem', 'Artifact', '{1}, {T}: Draw a card. Activate only during your turn.'), options());
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', onlyIf: { cond: 'turnOf', whose: 'you' }, effect: { steps: [{ op: 'draw' }] } });
    expect(f.gate[0]!.ok).toBe(true);
  });
  it('CR 602.5b: an "Activate only if ..." restriction the model cannot state is onlyIf ask, never part of the effect', () => {
    const f = face(card('Odd Totem', 'Artifact', '{1}, {T}: Draw a card. Activate only if the moon is full.'), options());
    const a = f.abilities[0] as ActivatedAbilityDef | ManualAbilityDef;
    expect(a.onlyIf).toMatchObject({ cond: 'ask' });
    expect(json(effectOf(a) ?? {})).not.toContain('Activate only');
  });
  it('CR 602.5d: "Activate only if ... and only as a sorcery." keeps sorcery speed', () => {
    const f = face(card('Odd Totem', 'Artifact', '{1}, {T}: Draw a card. Activate only if the moon is full and only as a sorcery.'), options());
    expect(f.abilities[0]).toMatchObject({ sorcerySpeed: true, onlyIf: { cond: 'ask' } });
  });
  it('CR 602.5b, 606.3: "Activate only if ..." on a loyalty ability is a restriction, never an effect sentence', () => {
    const f = face(card('Test Walker', 'Legendary Planeswalker — Test', '0: Draw a card. Activate only if the moon is full.'), options());
    expect(f.abilities[0]).toMatchObject({ kind: 'activated', isLoyalty: true, onlyIf: { cond: 'ask', text: 'the moon is full' }, effect: { steps: [{ op: 'draw' }] } });
  });
  it('CR 602.5b: any other "Activate ..." sentence is attested as a whole (never an effect sentence)', () => {
    const f = face(card('Odd Totem', 'Artifact', '{1}: Draw a card. Activate no more times each turn than the number of moons.'), options());
    expect(f.abilities[0]).toMatchObject({ onlyIf: { cond: 'ask' } });
    expect(json(f.abilities[0])).not.toContain('"op":"manual","text":"Draw a card. Activate');
  });
  it('CR 603.2h: a trigger restriction the model cannot state makes a manual triggered ability, never an effect sentence', () => {
    const f = face(card('Limit Wisp', 'Creature — Spirit', 'Whenever a creature you control dies, draw a card. This ability triggers only during your turn.'), options());
    expect(f.abilities[0]).toMatchObject({ kind: 'manual', shape: 'triggered' });
    expect(json(f.abilities[0])).not.toContain('"text":"Draw a card. This ability');
  });
});

describe('WP17 review: a cost part that does not parse is a manual cost part (design 6.6, CR 602.2b, 733.1)', () => {
  it('CR 602.2b, design 6.6: the parts understood are kept, the other is {kind:"manual"}, the ability stays activated', () => {
    const f = face(card('Odd Totem', 'Artifact', '{2}, Juggle three apples: Draw a card.'));
    expect(f.abilities[0]).toMatchObject({
      kind: 'activated',
      cost: { mana: [{ kind: 'generic', amount: 2 }], other: [{ kind: 'manual', text: 'Juggle three apples' }] },
      effect: { steps: [{ op: 'draw' }] },
    });
  });
  it('CR 602.2b: {T} and a mana cost survive next to an unparsed part', () => {
    const f = face(card('Odd Totem', 'Artifact', '{R}, {T}, Juggle three apples: Draw a card.'), options());
    expect(f.abilities[0]).toMatchObject({ cost: { tap: true, mana: [{ kind: 'colored', color: 'R' }] } });
  });
});

describe('WP17 review: "if you do" refers to the instruction right before it (CR 118.12, 608.2c)', () => {
  it('CR 118.12: after a mandatory step, "if you do" names that step, not an earlier "may"', () => {
    const f = face(card('Did Wisp', 'Creature — Spirit', 'When this creature enters, you may draw a card. Destroy target artifact. If you do, you gain 2 life.'));
    const st = effectOf(f.abilities[0]).steps;
    const destroy = st.find((s) => s['op'] === 'destroy');
    const iff = st.find((s) => s['op'] === 'if');
    if (destroy && iff) expect((iff['cond'] as Record<string, unknown>)['step']).toBe(destroy['as']);
    else expect(automatedOps(f.abilities)).not.toContain('gainLife');
  });
  it('CR 118.12: "if you do" after a sentence that is not understood is unresolved, never bound further back', () => {
    const f = face(card('Did Wisp', 'Creature — Spirit', 'When this creature enters, you may draw a card. Juggle three apples. If you do, you gain 3 life.'));
    expect(automatedOps(f.abilities)).not.toContain('gainLife');
  });
  it('CR 118.12: "Destroy X. If you do, Y." binds to the destroy step (the mandatory form)', () => {
    const f = face(card('Did Bolt', 'Sorcery', 'Destroy target artifact. If you do, you gain 2 life.'));
    const st = effectOf(f.abilities[0]).steps;
    expect(st[0]).toMatchObject({ op: 'destroy', as: expect.any(String) });
    expect(st[1]).toMatchObject({ op: 'if', cond: { cond: 'did', step: st[0]!['as'] } });
  });
});

describe('WP17 review: unannounced targets (CR 601.2c, 608.2b)', () => {
  it('CR 601.2c, 608.2b: a manual sentence with a target phrase that was not announced makes the program manual and announces no targets', () => {
    const f = face(card('Null Draw', 'Instant', 'Juggle target spell. Draw a card.'), options());
    expect(automatedOps(f.abilities)).toEqual([]);
    expect(json(f.abilities)).not.toContain('"targets":[{');
  });
  it('CR 608.2b: a partial target list is never announced (the spell would fail to resolve when only the parsed targets are illegal)', () => {
    const f = face(card('Bad Deal', 'Sorcery', 'Target creature gets -2/-2 until end of turn. Target player juggles three apples.'), options());
    expect(automatedOps(f.abilities)).toEqual([]);
    expect(json(f.abilities)).not.toContain('"targets":[{');
  });
  it('design 6.7 E1: a shield with a target of its own is not exempt', () => {
    const f = face(card('Bandage Test', 'Instant', 'Prevent the next 2 damage that would be dealt to any target this turn. Draw a card.'), options());
    expect(automatedOps(f.abilities)).toEqual([]);
  });
});

describe('WP17 review: a manual sentence is an opaque antecedent (design 6.4)', () => {
  it('design 6.4: a pronoun after a sentence that is not understood is unresolved', () => {
    const f = face(card('Look Spell', 'Sorcery', "Exile target creature. Juggle the top card of your library. Return it to the battlefield under its owner's control."));
    expect(json(f.abilities)).not.toMatch(/"op":"move","what":\{"ref":"target","id":"t0"\},"to":\{"zone":"battlefield"/);
    expect(f.diagnostics.some((d) => d.code === 'unbound-reference' && /"it"/.test(d.message))).toBe(true);
  });
  it('design 6.4: "that many" after a sentence that is not understood is unresolved', () => {
    const disc = tpl('effect', 'discard {n:Qty} card[s]', { op: 'discard', who: { ref: 'you' }, count: '$n' }, { id: 'test.discard' });
    const f = face(card('Count Spell', 'Sorcery', 'Discard two cards. Juggle three apples. Draw that many cards.'), options([...EXTRA, disc]));
    expect(automatedOps(f.abilities)).not.toContain('draw');
    expect(f.diagnostics.some((d) => d.code === 'unbound-reference' && /that many/.test(d.message))).toBe(true);
    expect(f.diagnostics.some((d) => d.code === 'gate-mismatch')).toBe(false);
  });
});

describe('WP17 review: bindings inside one sentence (CR 608.2c)', () => {
  it('CR 608.2c: a pronoun bound to an earlier step of the same sentence names that step (the name is not lost)', () => {
    const token = { op: 'createToken', who: { ref: 'you' }, count: 1, token: { types: ['Creature'], subtypes: ['Soldier'], power: 1, toughness: 1, colors: ['W'] } };
    const d = lowerAnaphora(draft([unit(0, 'create a 1/1 white soldier creature token and put a +1/+1 counter on it', [token, { op: 'putCounters', on: A({ sort: 'object', number: 'singular', text: 'it' }), kind: '+1/+1', count: 1 }])]));
    const st = d.units[0]!.steps;
    expect(d.units[0]!.manual).toBeUndefined();
    expect(st[0]).toMatchObject({ op: 'createToken', as: expect.any(String) });
    expect(st[1]).toMatchObject({ op: 'putCounters', on: { ref: 'bound', name: st[0]!['as'] } });
    expect(validateAbility({ kind: 'spell', text: 'x', effect: { targets: [], steps: st as never } }).filter((i) => i.severity === 'error' && i.code === 'unbound-name')).toEqual([]);
  });
  it('CR 608.2c: "that many" counting an earlier step of the same sentence names that step', () => {
    const d = lowerQuantities(draft([unit(0, 'discard two cards , then draw that many cards', [{ op: 'discard', who: { ref: 'you' }, count: 2 }, { op: 'draw', who: { ref: 'you' }, count: NUM('that many') }])]));
    const st = d.units[0]!.steps;
    expect(st[0]).toMatchObject({ op: 'discard', as: expect.any(String) });
    expect(st[1]).toMatchObject({ op: 'draw', count: { q: 'resultCount', step: st[0]!['as'] } });
  });
  it('CR 118.12: "if you do" after a "may" of the same sentence names it', () => {
    const d = lowerConditions(draft([unit(0, 'you may draw a card and if you do , you gain 2 life', [
      { op: 'may', who: { ref: 'you' }, do: [{ op: 'draw', who: { ref: 'you' }, count: 1 }] },
      { op: 'if', cond: { cond: 'did', step: '', $step: true }, then: [{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }] },
    ])]));
    const st = d.units[0]!.steps;
    expect(st[0]).toMatchObject({ op: 'may', as: expect.any(String) });
    expect(st[1]).toMatchObject({ cond: { cond: 'did', step: st[0]!['as'] } });
  });
});

describe('WP17 review: quoted triggered abilities (CR 603.4, guard G5)', () => {
  const quoted = (text: string) => {
    const opts = options(EXTRA);
    return parseQuoted(adaptTokens(tokenize(text)), { opts, env: { lexicon: opts.lexicon, keywords: opts.keywords }, budget: { limit: DEFAULT_BUDGET, used: 0 } }, ['creature']);
  };
  it('CR 603.4: a quoted trigger with an intervening "if" is not lowered as an effect-level "if"', () => {
    const r = quoted("When ~ dies, if it's your turn, draw a card.");
    expect(steps(r).some((s) => s['op'] === 'if')).toBe(false);
    expect(quoted('When ~ dies, draw a card.')).toMatchObject([{ kind: 'triggered', effect: { steps: [{ op: 'draw' }] } }]);
  });
});

describe('WP17 review: "another target" in a modal bullet (CR 115.3, 700.2)', () => {
  it('CR 115.3: distinctFrom names only targets of the same bullet; with none, "another" means other than the source', () => {
    const d = lowerTargets(draft([], {
      modes: { min: 0, max: 1, options: [
        { text: 'Tap target creature.', units: [unit(0, 'Tap target creature.', [{ op: 'tap', what: T(creature()) }])] },
        { text: 'Destroy another target creature.', units: [unit(1, 'Destroy another target creature.', [{ op: 'destroy', what: T({ ...creature('another target creature'), another: true }) }])] },
      ] },
      selfHeads: ['creature', 'spirit'], // the source can be a creature, so "other than the source" excludes something (WP21 review)
    }));
    const spec = d.targets.find((t) => t.id === 't1')!;
    expect(spec.distinctFrom).toBeUndefined();
    expect(spec.filter).toMatchObject({ other: true });
  });
  it('CR 115.3: a modal trigger with "another target" in a later bullet is not refused by the lint', () => {
    const f = face(card('Mode Wisp', 'Creature — Spirit', 'When this creature enters, choose one —\n• Tap target creature.\n• Destroy another target creature.'));
    expect(f.diagnostics.some((d) => /bad-distinct/.test(d.message))).toBe(false);
  });
});

describe('WP17 review: bootstrap template data (design 6.9, 6.10)', () => {
  it('design 6.9: every bootstrap template has at least two examples', () => {
    for (const t of BOOTSTRAP_TEMPLATES) expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
  });
  it.skipIf(localIndex() === null)('design 6.10: no example is the Oracle text, or a line of the Oracle text, of any card in the local index', () => {
    const lines = new Set<string>();
    for (const c of localIndex() ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        lines.add(text.trim());
        for (const l of text.split('\n')) lines.add(l.trim());
        for (const l of text.split('\n')) lines.add(l.replaceAll(c.name, '~').trim());
      }
    }
    for (const t of BOOTSTRAP_TEMPLATES) for (const e of t.examples) {
      expect(lines.has(e.text), `${t.id}: ${e.text}`).toBe(false);
      expect(lines.has(e.text.replaceAll('~', 'this creature')), `${t.id}: ${e.text}`).toBe(false);
    }
  });
});

describe.skipIf(localIndex() === null)('WP17 review: the real cards named by the review (local Oracle index)', () => {
  const byName = new Map((localIndex() ?? []).map((c) => [c.name, c]));
  const parse = (n: string) => parseCard(byName.get(n)!, options()).faces[0]!;
  it('design 13 (Magma Spray): exactly the JSON of section 13 with the bootstrap templates', () => {
    expect(bare(parse('Magma Spray').abilities)).toEqual(EXAMPLES.find((e) => e.name === 'Magma Spray')!.faces[0]!.abilities);
  });
  it('CR 601.2c, 608.2b: Contradict, Bandage and Deal Gone Bad automate nothing next to an unannounced target', () => {
    for (const n of ['Contradict', 'Bandage', 'Deal Gone Bad']) expect(automatedOps(parse(n).abilities), n).toEqual([]);
  });
  it('CR 607.2: Pentarch Paladin never carries a "$link" placeholder', () => {
    expect(json(parse('Pentarch Paladin').abilities)).not.toContain('$link');
  });
  it('CR 605.1a: Azorius Guildgate keeps a mana ability', () => {
    expect(parse('Azorius Guildgate').abilities.some((a) => (a.kind === 'manual' && a.mana === true) || (a.kind === 'activated' && a.isMana === true))).toBe(true);
  });
  it('CR 602.5b: Willowrush Verge restricts activation instead of resolving the restriction', () => {
    const a = parse('Willowrush Verge').abilities.find((x) => x.text.includes('Activate only'))!;
    expect((a as ActivatedAbilityDef).onlyIf).toBeDefined();
  });
  it('design 6.4: Ertai Resurrected mode 1, "Its controller" after a manual counter sentence is never bound to the trigger subject', () => {
    expect(json(parse('Ertai Resurrected').abilities)).not.toContain('"who":{"ref":"controllerOf","object":{"ref":"event"');
  });
  it('design 6.6: Perilous Myr and Arc-Slogger keep no wrong kept effect, and Arc-Slogger keeps {R}', () => {
    expect(json(parse('Perilous Myr').abilities)).not.toContain('"source":{"ref":"target"');
    expect(parse('Arc-Slogger').abilities[0]).toMatchObject({ cost: { mana: [{ kind: 'colored', color: 'R' }] } });
  });
});
