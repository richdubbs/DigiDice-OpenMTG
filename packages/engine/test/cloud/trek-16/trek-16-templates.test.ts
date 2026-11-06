/**
 * Lane trek, round trek-16 (Star Trek: copies and extra triggers): the template data of parser/templates/zz-cloud/trek-16.json, the "~'s other types" tail of the
 * copy-exception hole (parser/holes/p2copyperm1.ts, render/copy-except.ts) and the player target restriction "whose turn it is" (types/ability.ts#TargetSpec.players
 * `activePlayer`; rules/targets.ts; effects/ctx.ts). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * trek-16-scenarios.test.ts. CR cites checked against the Comprehensive Rules text of 2026-09-25; Star Trek's own mechanics have no rule text, none is used here.
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-16.json';
import review from '../../m5/golden/cards/trek-16-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 6;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** An ability text of a creature card. */
const parse = (text: string) => parseCard(card('Example Ooze', 'Creature — Ooze', text, { power: '0', toughness: '0' }), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);

describe('trek-16 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-16.json, after trek-12, before trek-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-16.json');
    expect(files.indexOf('zz-cloud/trek-16.json')).toBeGreaterThan(files.indexOf('zz-cloud/trek-12.json'));
    expect(files.indexOf('zz-cloud/trek-16.json')).toBeLessThan(files.indexOf('zz-cloud/trek-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (rep|eff).trek16.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rep|eff)\.trek16\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one Star Trek card (the owner accepted this on 2026-10-24 and 2026-10-27), so each is stable on one hand-verified golden card plus these tests', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual(MECH.map((t) => t.id).sort());
    expect(evidence('rep.trek16.tokens.any.thatManyOther')).toEqual(['Holo-Engineer']);
    expect(evidence('eff.trek16.each.becomeCopy.dur')).toEqual(['Gwyndala, the Progeny']);
    expect(evidence('eff.trek16.whenIt.dies.thisTurn.nextEnd')).toEqual(['Dr. Leonard "Bones" McCoy']);
    expect(evidence('eff.trek16.lasting.triggersAdditionalTime')).toEqual(['Lwaxana Troi, Charming Guest']);
    expect(evidence('eff.trek16.player.mayCast.fromTheirHand.free')).toEqual(['Cmdr. Troi, Outgoing Empath']);
    expect(evidence('eff.trek16.you.copy.spell')).toEqual(['Cmdr. Troi, Outgoing Empath']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-16 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parse(t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parse(e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parse(c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bunder your control\b/, "under an opponent's control"], [/\bthat many\b/, 'twice that many'], [/\bare created instead\b/, 'are created'], [/\bEach\b/, 'Each other'],
    [/\bbecomes a copy\b/, 'becomes a copy of itself and'], [/\bwhose turn it is\b/, 'whose turn it is not'], [/\bfrom their hand\b/, 'from their graveyard'], [/\bYou may have\b/, 'You have'],
    [/\bthis turn\b/, 'next turn'], [/\badditional time\b/, 'additional times'], [/\bnext end step\b/, 'next upkeep'], [/\bcopy that spell\b/, 'copy that creature'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-16 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parse(e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parse(m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('trek-16 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parse(mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('trek-16 parser hole (parser/holes/p2copyperm1.ts): the "~\'s other types" tail of a copy exception', () => {
  const base = 'You may have ~ enter as a copy of a creature card in a graveyard, except ~ is a Spy in addition to ~\'s other types';
  it('"except ~ is a Spy in addition to ~\'s other types and has menace" is one replacement, fully automated, through the copy-exception template', () => {
    const f = parse(`${base} and has menace.`);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(f.templatesUsed).toContain('rep.p2copyperm1.enters.copy.except');
    expect(JSON.stringify(f.abilities)).toContain('"except":[{"layer":4,"subtypes":{"add":["Spy"]}},{"layer":6,"add":[{"kind":"keyword","keyword":"menace"');
  });
  it('the name clause before it: "except ~\'s name is ~ and ~ is a legendary Ooze in addition to ~\'s other types" keeps the name and adds the supertype and the subtype', () => {
    const f = parse("You may have ~ enter as a copy of any creature card in your graveyard that was put there from the battlefield this turn, except ~'s name is ~ and ~ is a legendary Ooze in addition to ~'s other types.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"except":[{"retain":["name"]},{"layer":4,"supertypes":{"add":["Legendary"]},"subtypes":{"add":["Ooze"]}}]');
  });
  it('the near misses stay unautomated: other words in the tail, a set (not added) type, a color, a missing tail', () => {
    for (const text of [
      `${base.replace("~'s other types", "~'s other abilities")}.`,
      'You may have ~ enter as a copy of a creature card in a graveyard, except ~ is a Spy.',
      "You may have ~ enter as a copy of a creature card in a graveyard, except ~ is a black Spy in addition to ~'s other types.",
      `${base} if it is blue.`,
    ]) expect(fullyAutomated(parse(text)), text).toBe(false);
  });
  it('the old wording is unchanged: "except it\'s a Spy in addition to its other types" is still read', () => {
    expect(fullyAutomated(parse("You may have ~ enter as a copy of a creature you control, except it's a Spy in addition to its other types."))).toBe(true);
  });
});

describe('trek-16 engine capabilities (rules/targets.ts, effects/ctx.ts, actions/announce.ts#FEATURES): registered by the code that honors them', () => {
  it('`feature:target.player.activePlayer` is an engine capability, so a card with "target opponent whose turn it is" is not held back', () => {
    expect(ENGINE_CAPABILITIES.has('feature:target.player.activePlayer')).toBe(true);
  });
  it('"target opponent whose turn it is" is a player target of the active opponent only; "target player whose turn it is" and several targets are not read', () => {
    const f = parse('{T}: Target opponent whose turn it is gains 2 life.');
    expect(JSON.stringify(f.abilities[0])).toContain('"players":{"who":"opponent","activePlayer":true}');
    expect(fullyAutomated(parse('{T}: Target player whose turn it is gains 2 life.'))).toBe(false);
    expect(fullyAutomated(parse('{T}: Up to two target opponents whose turn it is gain 2 life.'))).toBe(false);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-16 design 6.10 (local index): synthetic examples', () => {
  it('no trek-16 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
