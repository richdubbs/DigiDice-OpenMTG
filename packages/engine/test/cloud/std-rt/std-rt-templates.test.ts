/**
 * Standard card wave 2, slice s4 (std-rt): the template data of parser/templates/zz-cloud/std-rt.json ("until the end of your next turn, whenever E, X") and the
 * round's renderer and engine changes. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example
 * never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rt-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { capabilitiesOfDef } from '../../../src/model/cap-walk';
import stdRt from '../../../src/parser/templates/zz-cloud/std-rt.json';
import e29 from '../../../src/parser/templates/zz-fast5x/e29.json';
import review from '../../m5/golden/cards/cloud-std-rt-review.json';
import { renderGate } from '../../../src/index';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRt as Template[];
const MECH_COUNT = 1;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an instant's spell ability, or an artifact's activated ability. */
function exampleCard(text: string): OracleCard {
  return /^\{[^}]*\}.*:/.test(text) ? card('Example Relic', 'Artifact', text) : card('Example Vigil', 'Instant', text);
}
const parsedWith = (text: string) => parseCard(exampleCard(text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Thief', type, text, type.startsWith('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rt template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rt.json, after zz-cloud/std-rp.json, before zz-cloud/std-sos.json) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rt.json');
    expect(files.indexOf('zz-cloud/std-rt.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rp.json'));
    expect(files.indexOf('zz-cloud/std-rt.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrt.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdrt\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 (narrow wording, deviation named in the round record): the stable template has its evidence, the one card that prints it hand-verified as a golden card', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      expect(cards, t.id).toEqual(['Season of the Bold']);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'whenever']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rt guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bwhenever\b/, 'when'], [/\byour next turn\b/, 'their next turn'], [/\bthe end of your next\b/, 'your next'], [/\byou cast\b/, 'an opponent casts']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rt guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('std-rt guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rt design 6.10 (local index): synthetic examples', () => {
  it('no std-rt line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
          // a mode line of a modal spell ("{P}{P}{P} — ...") is the sentence after its pawprints
          lines.add(l.replaceAll(c.name, '~').replace(/^(\{P\})+ — /, '').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

// ---- the lowering: what the template means ---------------------------------------------------------------------------------------------------------------------

describe('std-rt lowering (CR 603.7b, 611.2a): "until the end of your next turn, whenever E, X" is a delayed trigger that lasts until the end of your next turn', () => {
  it('a delay waiting for the event every time (no `once`), with the duration endOfNextTurn of you; the targets of its instructions are its own (CR 603.3d)', () => {
    const f = parsedWith('Until the end of your next turn, whenever you cast a spell, ~ deals 3 damage to up to one target creature.');
    const step = (f.abilities[0] as unknown as { effect: { steps: Record<string, unknown>[]; targets: unknown[] } }).effect;
    expect(step.targets).toEqual([]);
    expect(step.steps[0]).toMatchObject({ op: 'delay', when: { at: 'event', event: { ev: 'cast', player: 'you' } }, duration: { d: 'endOfNextTurn', whose: { ref: 'you' } } });
    expect(step.steps[0]!['once']).toBeUndefined();
    expect(JSON.stringify(step.steps[0]!['targets'])).toContain('"max":1');
  });
  it('"until your next turn" and "until end of turn" keep their own templates (r5-refs, t50), never this one', () => {
    expect(parsedWith('Until your next turn, whenever a creature you control dies, you gain 2 life.').templatesUsed).not.toContain(MECH[0]!.id);
    expect(parsedWith('Until end of turn, whenever a creature you control dies, you gain 2 life.').templatesUsed).not.toContain(MECH[0]!.id);
  });
  it('the capability of the duration is the engine\'s (dur:endOfNextTurn)', () => {
    const f = parsedWith('Until the end of your next turn, whenever a creature you control dies, you gain 2 life.');
    expect(capabilitiesOfDef(f.abilities[0] as never)).toContain('dur:endOfNextTurn');
    expect(ENGINE_CAPABILITIES.has('dur:endOfNextTurn')).toBe(true);
  });
});

// ---- render/steps-lasting.ts#untilYourNextTurn: the leading words of the delayed trigger ------------------------------------------------------------------------

describe('std-rt renderer (CR 603.7b, 611.2a): a delayed trigger until the end of your next turn is written in front of its effect', () => {
  const def = (whose: string) => ({ kind: 'spell', effect: { targets: [], steps: [{ op: 'delay', when: { at: 'event', event: { ev: 'cast', player: 'you' } }, duration: { d: 'endOfNextTurn', whose: { ref: whose } }, do: [{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }] }] } }) as never;
  it('"Until the end of your next turn, whenever you cast a spell, you gain 2 life." is accepted', () => {
    expect(renderGate(def('you'), ['Until the end of your next turn, whenever you cast a spell, you gain 2 life.'], { selfNames: ['Test Vigil'], selfTypes: ['Instant'] }).ok).toBe(true);
  });
  it('the effect first, "until your next turn" or "until end of turn" are other durations and are refused', () => {
    for (const text of ['Whenever you cast a spell until the end of your next turn, you gain 2 life.', 'Until your next turn, whenever you cast a spell, you gain 2 life.', 'Until end of turn, whenever you cast a spell, you gain 2 life.']) {
      expect(renderGate(def('you'), [text], { selfNames: ['Test Vigil'], selfTypes: ['Instant'] }).ok, text).toBe(false);
    }
  });
});

// ---- render/steps-zones.ts#bindMoved: "the exiled card" after exiling the top card of a library ------------------------------------------------------------------

describe('std-rt renderer (CR 608.2c, 400.7): the one card exiled from the top of a library is also "the exiled card"', () => {
  it('"Exile the top card of target opponent\'s library. You may play the exiled card this turn." is fully automated (as "that card" was)', () => {
    const a = face('Artifact', "{T}: Exile the top card of target opponent's library. You may play the exiled card this turn.");
    const b = face('Artifact', "{T}: Exile the top card of target opponent's library. You may play that card this turn.");
    expect(fullFace(a), JSON.stringify(a.diagnostics)).toBe(true);
    const named = (k: string): string => k.replace(/"(as|name)":"[^"]+"/g, '"$1":"x"'); // the binding's name differs ("them" / "impulse"); nothing else
    expect(named(jsonKey(a.abilities))).toBe(named(jsonKey(b.abilities)));
  });
  it('the anyType rider reads too ("..., and mana of any type can be spent to cast it"; eff.e29.permit.play.obj.dur.anyType)', () => {
    const f = face('Artifact', "{T}: Exile the top card of target opponent's library. You may play the exiled card this turn, and mana of any type can be spent to cast it.");
    expect(automated(f.abilities), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toContain('eff.e29.permit.play.obj.dur.anyType');
  });
  it('a card put into a graveyard is not "the exiled card", and "the exiled card" after a mill stays manual', () => {
    const f = face('Artifact', "{T}: Mill a card. You may play the exiled card this turn.");
    expect(fullFace(f)).toBe(false);
  });
});

// ---- the promotion of eff.e29.permit.play.obj.dur.anyType --------------------------------------------------------------------------------------------------------

describe('std-rt promotion (design 6.9, 10.4): eff.e29.permit.play.obj.dur.anyType is stable', () => {
  it('its status is stable; the evidence is in fast5x/e29/e29-templates.test.ts (WHOLE: every card of the local index that reads it automated, hand-verified)', () => {
    const t = (e29 as Template[]).find((x) => x.id === 'eff.e29.permit.play.obj.dur.anyType')!;
    expect(t.status).toBe('stable');
  });
});
