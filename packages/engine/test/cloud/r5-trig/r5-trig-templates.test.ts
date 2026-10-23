/**
 * Standard round 5, slice r5-trig (trigger conditions, both halves): the template data of parser/templates/zz-cloud/r5-trig.json and the Event, Filter, Cond, Qty
 * and Obj hole readings of the slice. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves
 * an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * r5-trig-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { CRITICAL_WORDS } from '../../../src/parser/lower/units';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import r5Trig from '../../../src/parser/templates/zz-cloud/r5-trig.json';
import review from '../../m5/golden/cards/cloud-r5-trig-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const R5 = r5Trig as Template[];
const R5_COUNT = 3;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Equipment for "attach it to ...", anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.id === 'eff.r5trig.attachToChosen') return card('Example Relic', 'Artifact — Equipment', `${text}\nEquip {2}`);
  return card('Example Brute', 'Creature — Elf Pilot', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('r5-trig template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/r5-trig.json, after r4-trig.json, before std-blb.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/r5-trig.json');
    expect(files.indexOf('zz-cloud/r5-trig.json')).toBeGreaterThan(files.indexOf('zz-cloud/r4-trig.json'));
    expect(files.indexOf('zz-cloud/r5-trig.json')).toBeLessThan(files.indexOf('zz-cloud/std-blb.json'));
    expect(files.indexOf('zz-cloud/r5-trig.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.r5trig.* or trg.r5trig.*', () => {
    expect(R5.length).toBe(R5_COUNT);
    for (const t of R5) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.r5trig\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: at least one hand-verified golden card that uses it (the review file pins each card as full)', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of R5.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(t.id)).map((g) => g.card);
      expect(cards.length, t.id).toBeGreaterThanOrEqual(1);
    }
    for (const g of golden) {
      expect(g.expect, g.card).toBe('full');
      expect(g.verified, g.card).toMatch(/CR \d{3}/);
    }
  });
  it('guard G3: a critical word or phrase a pattern spells out (parser/lower/units.ts#CRITICAL_WORDS) is listed in `consumes`', () => {
    for (const t of R5) {
      const literal = ` ${t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ')} `;
      for (const w of CRITICAL_WORDS) if (literal.includes(` ${w} `)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
    }
  });
});

describe('r5-trig guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of R5) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\byour main phase\b/, "an opponent's main phase"], [/\byour main phase\b/, 'your second main phase'], [/\bcrews a Vehicle\b/, 'crews a Mount'],
    [/\bto a creature you control\b/, 'to target creature you control'], [/\bto a creature you control\b/, 'to each creature you control'], [/\battach it\b/, 'detach it'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('r5-trig guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of R5) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
      for (const e of t.examples) {
        const orig = parsedWith(t, e.text);
        for (const m of nearMisses(e.text)) {
          if (m === e.text) continue;
          const f = parsedWith(t, m);
          expect(automated(f.abilities) && f.gate.every((g) => g.ok) && jsonKey(f.abilities) === jsonKey(orig.abilities), m).toBe(false);
        }
      }
    });
  }
});

describe('r5-trig guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of R5) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || /^[+-]?\d+\/[+-]?\d+$/.test(w)) return;
          const end = w.match(/[.,:"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    }, 60_000);
  }
});

const index = localIndex();

describe.skipIf(index === null)('r5-trig design 6.10 (local index): synthetic examples', () => {
  it('no r5-trig line of an example or counter-example, and no test card line of this slice, is a line of a real card (the card\'s own name or "this <type>" read as "~")', () => {
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
    const own = [...R5.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples]), ...SAMPLES.map((x) => x[1])];
    const verbatim = own.filter((x) => x.split('\n').some((l) => lines.has(l.trim()) || lines.has(l.replace(/\bthis (creature|artifact|enchantment|Equipment)\b/g, '~').trim())));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

/** A one-card face for the parser checks below. */
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;
const json = (type: string, text: string): string => JSON.stringify(face(type, text).abilities);

/** The hole readings of this slice, each [type line, synthetic text, a JSON fragment the reading builds]. */
const SAMPLES: [string, string, string][] = [
  ['Enchantment', "Whenever a creature you control becomes tapped, if it's the first time that creature has become tapped this turn, you gain 1 life.", '"interveningIf":{"cond":"firstTime","object":{"ref":"event","role":"subject"},"event":{"ev":"becomes","what":"tapped","object":{}}}'],
  ['Enchantment', "Whenever one or more counters are put on a creature you control, if it's the first time counters have been put on that creature this turn, you gain 1 life.", '"event":{"ev":"counters","change":"put","on":{}}'],
  ['Creature — Human Pilot', 'Whenever this creature crews a Vehicle, draw a card.', '"on":[{"ev":"becomes","what":"crewCostPaid","object":{"subtypes":["Vehicle"]},"by":{"self":true}}]'],
  ['Creature — Human Pilot', 'Whenever this creature saddles a Mount, you gain 2 life.', '"on":[{"ev":"becomes","what":"saddleCostPaid","object":{"subtypes":["Mount"]},"by":{"self":true}}]'],
  ['Creature — Human Pilot', 'Whenever a Vehicle crewed by this creature this turn deals combat damage to a player, draw a card.', '"crewedBySourceThisTurn":true'],
  ['Creature — Human Rogue', 'Whenever this creature and/or one or more other creatures you control enter, you gain 1 life.', '"batch":true'],
  ['Enchantment', 'Whenever one or more creatures you control enter, if none of them were cast or no mana was spent to cast them, scry 1.', '"filter":{"castWithMana":false}'],
  ['Enchantment', 'Whenever one or more creatures enter, if one or more of them entered from a graveyard or was cast from a graveyard, scry 1.', '"cond":"someMatch","object":{"ref":"event","role":"subject"},"filter":{"anyOf":[{"enteredFrom":"graveyard"},{"castFrom":"graveyard"}]}'],
  ['Enchantment', 'At end of combat on your turn, scry 1.', '"on":[{"ev":"step","step":"endCombat","whose":"you"}]'],
  ['Enchantment', 'At the beginning of your end step, if a player was dealt 4 or more damage this turn, scry 1.', '"left":{"q":"happenedCount","event":{"ev":"damage","recipient":{"player":"any"}},"scope":"turn","per":"player","sum":"amount"},"op":">=","right":4'],
  ['Enchantment', 'Whenever you put one or more +1/+1 counters on one or more creatures you control, scry 1.', '"batch":true,"wholeBatch":true'],
  ['Enchantment', 'Whenever you cast a spell with two or more red mana symbols in its mana cost, scry 1.', '"manaSymbols":{"color":"R","cmp":{"op":">=","value":2}}'],
  ['Artifact', 'Whenever you untap one or more permanents during your untap step, you gain that much life.', '"untapStep":true'],
  ['Artifact', 'When there are 2,500 or more charge counters on this artifact, draw a card.', '"right":2500'],
  ['Enchantment', "At the beginning of your end step, if you've played a land or cast a spell this turn from anywhere other than your hand, draw a card.", '{"ev":"cast","player":"you","notFrom":"hand"}'],
];

describe('r5-trig hole and lowering readings (no template of their own)', () => {
  it.each(SAMPLES)('%s: "%s" is automated with its reading', (type, text, fragment) => {
    const f = face(type, text);
    expect(fullyAutomated(f), `${text}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain(fragment);
  });
  it('CR 603.4: "the first time" is read only of an object the trigger named ("that creature"), never of a description', () => {
    expect(json('Enchantment', "Whenever a creature you control becomes tapped, if it's the first time a creature has become tapped this turn, you gain 1 life.")).not.toContain('firstTime');
    expect(fullyAutomated(face('Enchantment', "Whenever one or more counters are put on a creature you control, if it's the first time counters have been put on that creature, you gain 1 life."))).toBe(false);
  });
  // std-rx13 changed this pin on purpose: "a counter is put on" was left out as not printed; Hollowmurk Siege prints it, so it is read now as the singular of
  // "one or more counters are put on" (any kind); "a counters are put on" stays no reading
  it('CR 122.1: a kindless counter is read with "one or more counters are put on" and (std-rx13) "a counter is put on"', () => {
    expect(json('Enchantment', 'Whenever a counter is put on a creature you control, scry 1.')).toContain('"ev":"counters"');
    expect(json('Enchantment', 'Whenever a counters are put on a creature you control, scry 1.')).not.toContain('"ev":"counters"');
  });
  it('CR 702.122b, 702.171c: a creature crews a Vehicle and saddles a Mount; "crews a Mount" and "saddles a Vehicle" are no reading', () => {
    expect(fullyAutomated(face('Creature — Human Pilot', 'Whenever this creature crews a Mount, draw a card.'))).toBe(false);
    expect(fullyAutomated(face('Creature — Human Pilot', 'Whenever this creature saddles a Vehicle, draw a card.'))).toBe(false);
  });
  it('CR 603.2c: "and/or" joins a list only before "one or more"', () => {
    expect(fullyAutomated(face('Creature — Human Rogue', 'Whenever this creature and/or another creature you control enters, you gain 1 life.'))).toBe(false);
  });
  it('CR 107.4: mana symbols are read only as "N or more <color> mana symbols in its mana cost"', () => {
    expect(fullyAutomated(face('Enchantment', 'Whenever you cast a spell with one blue mana symbol in its mana cost, scry 1.'))).toBe(false);
    expect(fullyAutomated(face('Enchantment', 'Whenever you cast a spell with one or more blue mana symbols in their mana cost, scry 1.'))).toBe(false);
  });
  it('CR 120.1: the damage total per player is read for "a player" (any player) and, since p2-exile-play-1, for "an opponent" (opponents only); "that many" names the symbols only after a cast trigger that counts them', () => {
    expect(json('Enchantment', 'At the beginning of your end step, if a player was dealt 4 or more damage this turn, scry 1.')).toContain('"recipient":{"player":"any"}');
    expect(json('Enchantment', 'At the beginning of your end step, if an opponent was dealt 4 or more damage this turn, scry 1.')).toContain('"recipient":{"player":"opponent"}');
    expect(fullyAutomated(face('Enchantment', 'Whenever you cast a spell, create that many 1/1 blue Merfolk creature tokens.'))).toBe(false);
  });
});

describe('r5-trig: numbers with thousands separators (CR 107.1)', () => {
  it('"1,000" is one number; "1, 2" and "1,00" are not joined', async () => {
    const { tokenize } = await import('../../../src/parser/tokenize');
    const nums = (t: string): string[] => tokenize(t).filter((x) => x.kind === 'NUM').map((x) => x.norm);
    expect(nums('each opponent loses 1,000 life.')).toEqual(['1000']);
    expect(nums('choose 1, 2 or 3.')).toEqual(['1', '2', '3']);
    expect(nums('pay 1,00 life.')).toEqual(['1', '00']);
  });
  it('CR 502.3: an untap in another player\'s untap step is no reading of "you untap"', () => {
    expect(fullyAutomated(face('Artifact', 'Whenever an opponent untaps one or more permanents during their untap step, you gain 1 life.'))).toBe(false);
  });
});
