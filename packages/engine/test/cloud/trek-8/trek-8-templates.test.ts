/**
 * Lane trek, round trek-8 (Star Trek: control, copies, combat): the template data of parser/templates/zz-cloud/trek-8.json and the round's other changes, one
 * test each:
 *   - scripts/gen-lexicon.ts input: the creature type "Tribble" (printed only on the tokens of one card) is in the checked-in index lexicon, with its plural;
 *   - parser/lower/quantities.ts#delayedEventAmount: "that many" in the instructions of a delayed trigger that waits for an event is the amount of that event;
 *   - parser/lower/delay-tail.ts: the sentences after a delayed trigger written in front of its instructions are its instructions;
 *   - parser/holes/object.ts#perPlayerTarget: a mana value limit after "that player controls"; parser/holes/event.ts: "combat on each player's turn";
 *   - render/self-replacement.ts: a kicker's "instead for each ..." replaces the instruction before it as a whole; render/refs.ts: "that creature" in a for-each loop.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in trek-8-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { GENERATED_LEXICON, lexiconIndex } from '../../../src/parser/front/lexicon-index';
import round from '../../../src/parser/templates/zz-cloud/trek-8.json';
import review from '../../m5/golden/cards/trek-8-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 6;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A static ability or a replacement of a creature card; any other template, a sorcery's instructions. */
const parseOf = (t: Template, text: string) =>
  parseCard(t.kind === 'static' ? card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }) : card('Example Rite', 'Sorcery', text), OPTS).faces[0]!;
const parseCreature = (text: string) => parseCard(card('Example Ooze', 'Creature — Ooze', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
const parseSpell = (text: string) => parseCard(card('Example Rite', 'Sorcery', text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-8 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-8.json, after std-woe, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-8.json');
    expect(files.indexOf('zz-cloud/trek-8.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-woe.json'));
    expect(files.indexOf('zz-cloud/trek-8.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|sta|rep).trek8.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.trek8\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one card, so each stable template is stable on that one hand-verified golden card; the plural form no card needs is experimental', () => {
    const stable: Record<string, string> = {
      'sta.trek8.pump.goaded.plural': 'Koloth, Tribble Hunter',
      'eff.trek8.player.cant.attack.andYouPutCounter': 'Peace in Our Time',
      'eff.trek8.becomes.addtype.gains.they': 'Worf, Intelligence Contractor',
      'rep.trek8.destroyed.instead.removeCountersAndHeal': 'Dr. McCoy, Surly Surgeon',
      'rep.trek8.enters.tappedAttacking.while': 'Kira Nerys, Firebrand',
    };
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(Object.keys(stable).sort());
    for (const [id, name] of Object.entries(stable)) expect(evidence(id), id).toEqual([name]);
    expect(MECH.find((t) => t.id === 'eff.trek8.becomes.addtype.gains.plural')!.status).toBe('experimental');
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also', 'while', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-8 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const same = t.examples.map((e) => jsonKey(parseOf(t, e.text).abilities));
      for (const e of t.examples) {
        const f = parseOf(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parseOf(t, c);
        expect(fullyAutomated(f) && same.includes(jsonKey(f.abilities)), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bcan't attack\b/, "can't block"], [/\bcan't attack\b/, 'can attack'], [/\bare goaded\b/, 'are tapped'], [/\bget \+(\d)\/\+0\b/, 'get -$1/-0'], [/\bgain\b/, 'lose'], [/\bbecome\b/, 'lose'],
    [/\bwould be destroyed\b/, 'would be exiled'], [/\bremove all\b/, 'put a'], [/\bis healed\b/, 'is dealt'], [/\btapped and attacking\b/, 'tapped'], [/\btapped and attacking\b/, 'untapped and attacking'],
    [/\bwhile you control\b/, 'if you control'], [/\binstead it enters\b/, 'it enters'], [/\byou put\b/, 'they put'], [/\bUntil end of turn\b/, 'Until your next turn'],
    [/\bin addition to their other types\b/, 'in place of their other types'], [/\bAll\b/, 'Each'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-8 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parseOf(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parseOf(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-8 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // the kind of a counter is an open word by design (parser/holes/misc.ts#counterKind, weak)
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parseOf(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-8 lexicon (scripts/gen-lexicon.ts, CR 111.4, 205.3m): the creature type of the Tribble tokens', () => {
  it('the checked-in index lexicon knows Tribble with its plural, so "Tribbles get +1/+0" is a reading', () => {
    expect(GENERATED_LEXICON.subtypes.find((s) => s.singular === 'Tribble')).toEqual({ singular: 'Tribble', plural: 'Tribbles', class: 'creature' });
    expect(lexiconIndex().subtypes.has('tribbles')).toBe(true);
    const f = parseCreature('Tribbles get +1/+0.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
  });
});

describe('trek-8 parser/lower/quantities.ts#delayedEventAmount (CR 603.7, 603.2c, 608.2h): "that many" in a delayed trigger that waits for an event', () => {
  const SENTENCE = 'Choose target creature. Whenever it deals combat damage to a player this turn, you draw that many cards.';
  it('is the amount of the delayed trigger\'s event: the draw counts the damage dealt, read as the delayed trigger resolves', () => {
    const f = parseSpell(SENTENCE);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"count":{"q":"eventAmount"}');
  });
  it('a candidate that exists is never overridden: with a sentence before it that supplies a number (the card drawn), the reading is the one it always was (manual here: another resolution)', () => {
    const f = parseSpell('Draw a card. Whenever a creature you control deals combat damage to a player this turn, you gain that much life.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('only the first instruction of the delayed trigger reads it: after "..., mill three cards, then draw that many cards" the number is what that instruction made, so the sentence stays manual', () => {
    const f = parseSpell('Whenever a creature you control deals combat damage to a player this turn, mill three cards, then draw that many cards.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('an event with no amount offers none: "Whenever a creature you control attacks this turn, you draw that many cards." stays manual', () => {
    const f = parseSpell('Whenever a creature you control attacks this turn, you draw that many cards.');
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('trek-8 parser/lower/delay-tail.ts (CR 603.7, 608.2c): the sentences after a delayed trigger written in front of its instructions are its instructions', () => {
  const HEAD = 'Test Rite deals 2 damage to target creature an opponent controls. At the beginning of the next combat this turn, gain control of that creature until end of turn.';
  it('"Untap it. It gains haste until end of turn." join the delayed trigger (three instructions, none outside it)', () => {
    const f = parseSpell(`${HEAD} Untap it. It gains haste until end of turn.`.replace('Test Rite', '~'));
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['damage', 'delay']);
    expect(steps[1]!.do!.map((s) => s.op)).toEqual(['effect', 'untap', 'effect']);
  });
  it('only the sentences of the lead\'s own paragraph join it: a later paragraph of the spell is the spell\'s own (Morningtide\'s Light: the damage prevention and the exile of the card stay outside)', () => {
    const f = parseSpell("Exile any number of target creatures. At the beginning of the next end step, return those cards to the battlefield tapped under their owners' control.\nUntil your next turn, prevent all damage that would be dealt to you.\nExile ~.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['move', 'delay', 'effect', 'move']);
    expect(steps[1]!.do!.map((s) => s.op)).toEqual(['move']);
    const g = parseSpell(`${HEAD} Untap it.\nYou gain 2 life.`.replace('Test Rite', '~'));
    const gs = (g.abilities[0] as unknown as { effect: { steps: { op: string; do?: { op: string }[] }[] } }).effect.steps;
    expect(gs.map((s) => s.op)).toEqual(['damage', 'delay', 'gainLife']);
    expect(gs[1]!.do!.map((s) => s.op)).toEqual(['effect', 'untap']);
  });
  it('a sentence that is not understood after it leaves the sequence as it was (fail closed)', () => {
    const f = parseSpell(`${HEAD} Flibber the creature.`.replace('Test Rite', '~'));
    expect(fullyAutomated(f)).toBe(false);
  });
  it('a delayed trigger that waits for an event keeps its own fold (lower/anaphora.ts#foldIntoDelay): a later sentence with no pronoun about it stays outside', () => {
    const f = parseSpell('Whenever a creature you control deals combat damage to a player this turn, draw a card. You gain 2 life.');
    const steps = (f.abilities[0] as unknown as { effect?: { steps: { op: string }[] } }).effect?.steps ?? [];
    if (steps.length > 0) expect(steps.map((s) => s.op)).toEqual(['delay', 'gainLife']);
  });
});

describe('trek-8 parser/holes/object.ts#perPlayerTarget and parser/holes/event.ts (CR 115.1, 601.2c, 603.2)', () => {
  it('a mana value limit after "that player controls": one target for each opponent, the limit in the filter', () => {
    const f = parseSpell('For each opponent, tap up to one target creature that player controls with mana value 3 or less.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const targets = (f.abilities[0] as unknown as { effect: { targets: unknown[] } }).effect.targets;
    expect(targets).toMatchObject([{ min: 0, max: 1, perOpponent: true, filter: { types: ['Creature'], controller: 'opponent', manaValue: { op: '<=', value: 3 } } }]);
  });
  it('the limit in front of it is the same target, and a limit that is not a mana value is not read after it', () => {
    const f = parseSpell('For each opponent, tap up to one target creature with mana value 3 or less that player controls.');
    expect(JSON.stringify(f.abilities)).toContain('"manaValue":{"op":"<=","value":3}');
    expect(fullyAutomated(parseSpell('For each opponent, tap up to one target creature that player controls with flying.'))).toBe(false); // only a mana value, power or toughness is read after it
  });
  it('"At the beginning of combat on each player\'s turn" is the beginning of every combat; "on each opponent\'s turn" an opponent\'s only', () => {
    const any = parseCard(card('Example Ooze', 'Enchantment', "At the beginning of combat on each player's turn, that player may draw a card."), OPTS).faces[0]!;
    expect(fullyAutomated(any), JSON.stringify(any.diagnostics)).toBe(true);
    expect(JSON.stringify(any.abilities)).toContain('"trigger":{"on":[{"ev":"step","step":"beginCombat"}]}');
    const opp = parseCard(card('Example Ooze', 'Enchantment', "At the beginning of combat on each opponent's turn, that player may draw a card."), OPTS).faces[0]!;
    expect(JSON.stringify(opp.abilities)).toContain('"trigger":{"on":[{"ev":"step","step":"beginCombat","whose":"opponent"}]}');
  });
});

describe('trek-8 render/self-replacement.ts and render/refs.ts (CR 614.15, 601.2c, 608.2f): a kicked "instead for each ..."', () => {
  const KICKER = "Kicker {1}\nCreate a token that's a copy of target creature an opponent controls. If this spell was kicked, instead for each creature target opponent controls, create a token that's a copy of that creature.";
  it('is one choice made as the spell is cast: the target of the plain reading only when not kicked, the opponent only when kicked', () => {
    const f = parseCard(card('Example Rite', 'Sorcery', KICKER), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const ability = f.abilities.find((a) => a.kind === 'spell') as unknown as { effect: { targets: { id: string; onlyIf?: unknown }[]; steps: { op: string; then?: { op: string }[]; else?: { op: string }[] }[] } };
    expect(ability.effect.targets.every((x) => x.onlyIf !== undefined)).toBe(true);
    expect(ability.effect.steps[0]).toMatchObject({ op: 'if', then: [{ op: 'forEach' }], else: [{ op: 'copy' }] });
  });
  it('a "for each" that is not the whole replacement stays refused: a kicked instead with a payment is still not one instruction', () => {
    const f = parseCard(card('Example Rite', 'Sorcery', "Kicker {1}\nCreate a token that's a copy of target creature an opponent controls. If this spell was kicked, instead you may pay {2}. If you do, create a token that's a copy of target creature."), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-8 design 6.10 (local index): synthetic examples', () => {
  it('no trek-8 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
