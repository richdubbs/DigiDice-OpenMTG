/**
 * Card wave 2, slice s13 (std-rx14): the template data of parser/templates/zz-cloud/std-rx14.json ("remove a <kind> counter from each of any number of <permanents>",
 * "exile <obj> and up to one <filter>, then return those cards to the battlefield under their owner's control", "put a <kind> counter on <obj> for each other <filter>
 * that entered the battlefield under your control this turn"), the two promotions of the round (dl.endOfCombat.lead, trg.r5trig.cast.notFirstDuringYourTurn) and its
 * parser and renderer changes (the Cond "<that object> was cast for its warp cost", "it's a card of the chosen type", the Qty "for each <kind> counter removed this way",
 * the pronoun before "and up to one <noun>"). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6);
 * every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never
 * leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-rx14-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx14 from '../../../src/parser/templates/zz-cloud/std-rx14.json';
import delayed from '../../../src/parser/templates/effect/delayed.json';
import r5Trig from '../../../src/parser/templates/zz-cloud/r5-trig.json';
import ownReview from '../../m5/golden/cards/cloud-std-rx14-review.json';
import r5Review from '../../m5/golden/cards/cloud-r5-trig-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx14 as Template[];
const MECH_COUNT = 3;
/** The round's golden cards: its own review file, and Geralf in r5-trig's (the review file of the template it promotes, guide section 6). */
const review = [...(ownReview as unknown[]), ...(r5Review as { card: string }[]).filter((g) => g.card === 'Geralf, the Fleshwright')];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrx14.removeCounter.eachOfAnyNumber': 'Garnet, Princess of Alexandria', // the only other printing, Chandra, Legacy of Fire, stays manual ("that many")
  'eff.stdrx14.flicker.objAndUpToOne': 'Fortune, Loyal Steed',
  'eff.stdrx14.counter.forEachOtherEnteredThisTurn': 'Geralf, the Fleshwright',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature (triggered and activated abilities). */
const parsedWith = (_t: Template, text: string) => parseCard(card('Example Shaman', 'Artifact Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx14 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx14.json, after std-rx1.json, before std-rx3.json, std-sos.json and zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx14.json');
    expect(files.indexOf('zz-cloud/std-rx14.json')).toBeGreaterThan(files.indexOf('zz-cloud/std-rx1.json'));
    expect(files.indexOf('zz-cloud/std-rx14.json')).toBeLessThan(files.indexOf('zz-cloud/std-rx3.json'));
    expect(files.indexOf('zz-cloud/std-rx14.json')).toBeLessThan(files.indexOf('zz-cloud/std-sos.json'));
    expect(files.indexOf('zz-cloud/std-rx14.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdrx14.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^eff\.stdrx14\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-rx14 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
        if (e.expect !== undefined) expect(bare(f.abilities), e.text).toEqual(e.expect);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} until end of turn.`];
  const swaps: [RegExp, string][] = [[/\bremove a\b/, 'put a'], [/\bany number of\b/, 'two'], [/\bup to one\b/, 'up to two'], [/\btheir owner's control\b/, 'your control'], [/\bentered the battlefield\b/, 'left the battlefield'], [/\bfor each other\b/, 'for each']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx14 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/until end of turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx14 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          if (/^counters?$/.test(words[i + 1] ?? '')) return; // a counter kind is an open vocabulary (CR 122.1: any word names a kind of counter)
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx14 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx14 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


// ---- the promotions of the round ---------------------------------------------------------------------------------------------------------------------------

describe('std-rx14 promotions (design 6.9 deviation, guide section 5 "Narrow wordings")', () => {
  it('dl.endOfCombat.lead (experimental since the import, used fully by no card) is stable on Fortune, Loyal Steed', () => {
    expect((delayed as Template[]).find((t) => t.id === 'dl.endOfCombat.lead')?.status).toBe('stable');
    expect((ownReview as { card: string; verified: string }[]).find((g) => g.card === 'Fortune, Loyal Steed')?.verified).toContain('(dl.endOfCombat.lead');
  });
  it('trg.r5trig.cast.notFirstDuringYourTurn (only Geralf prints the wording) is stable on Geralf, the Fleshwright, in r5-trig\'s review file', () => {
    expect((r5Trig as Template[]).find((t) => t.id === 'trg.r5trig.cast.notFirstDuringYourTurn')?.status).toBe('stable');
    expect((r5Review as { card: string; verified: string }[]).find((g) => g.card === 'Geralf, the Fleshwright')?.verified).toContain('(trg.r5trig.cast.notFirstDuringYourTurn');
  });
});

// ---- parser/holes/cond.ts#castForAltCost + render/cond.ts#wasCastPhrase -------------------------------------------------------------------------------------

describe('std-rx14 Cond (CR 702.185a, 400.7d): "if that creature was cast for its warp cost" reads the cast record of the object named before', () => {
  it('after a target: `wasCast` with `via: warp` and `object` the target', () => {
    const f = face('Instant', 'Target creature you control gets +1/+1 until end of turn. If that creature was cast for its warp cost, it gains flying until end of turn.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cond":{"cond":"wasCast","via":"warp","object":{"ref":"target","id":"t0"}}');
  });
  it('another alternative cost, or no object named before, is not read', () => {
    expect(fullFace(face('Instant', 'Target creature you control gets +1/+1 until end of turn. If that creature was cast for its sneak cost, it gains flying until end of turn.'))).toBe(false);
    expect(fullFace(face('Instant', 'If that creature was cast for its warp cost, draw a card.'))).toBe(false);
  });
});

// ---- render/cond.ts predicates: "it's a [<type>] card of the chosen type" -------------------------------------------------------------------------------------

describe('std-rx14 renderer (CR 607.2d, 108.1): "If it\'s a card of the chosen type" and "a creature card of the chosen type" after a look at the top card', () => {
  const stone = (cond: string): ReturnType<typeof face> => face('Artifact', `As this artifact enters, choose a creature type.\nAt the beginning of your upkeep, look at the top card of your library. If it's ${cond}, you may reveal it and put it into your hand.`);
  it('both are full; the filter is a card (isCard) of the linked type', () => {
    for (const c of ['a card of the chosen type', 'a creature card of the chosen type']) {
      const f = stone(c);
      expect(fullFace(f), `${c}: ${JSON.stringify(f.diagnostics)}`).toBe(true);
      expect(JSON.stringify(f.abilities), c).toContain('"isCard":true');
      expect(JSON.stringify(f.abilities), c).toContain('"chosen":{"link":"type","quality":"creatureType"}');
    }
  });
  it('a quality no ability of the face chose (the chosen color after a creature type choice) is not read', () => {
    expect(fullFace(stone('a card of the chosen color'))).toBe(false);
  });
});

// ---- holes/qty.ts#countersRemovedAt + lower/conditions.ts#resolveCountersRemoved -----------------------------------------------------------------------------

describe('std-rx14 Qty (CR 122.1, 608.2c): "for each <kind> counter removed this way" names the removal right before it', () => {
  it('after a removal: `countersRemoved` of that instruction, of that kind', () => {
    const f = face('Artifact', '{T}: Remove a charge counter from each of any number of artifacts you control. Draw a card for each charge counter removed this way.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"count":\{"q":"countersRemoved","step":"[a-z0-9]+","kind":"charge"\}/);
  });
  it('fail closed: with no removal right before it (another instruction), the sentence is not automated; a cost that removes them is read since p2-counters-move-2', () => {
    // p2-counters-move-2 (CR 118.3, 107.3a): "Remove all charge counters from ~" is a cost part with the ability's X (CostPart `all`), which the sentence names
    expect(fullFace(face('Artifact', '{T}, Remove all charge counters from this artifact: You gain 2 life for each charge counter removed this way.'))).toBe(true);
    expect(fullFace(face('Artifact', '{T}: Draw a card. You gain 2 life for each charge counter removed this way.'))).toBe(false);
  });
});

// ---- lower/mentions.ts#joinedAfter: "exile it and up to one <noun>" ----------------------------------------------------------------------------------------

describe('std-rx14 antecedents (CR 608.2c, design 6.4): in "exile it and up to one creature ...", the chosen creature is named after "it"', () => {
  it('"it" is the creature of the trigger, never the creature chosen after it', () => {
    const f = face('Creature — Horse Mount', "Whenever this creature attacks, at end of combat, exile it and up to one other creature you control, then return those cards to the battlefield under their owner's control.", ['3', '3']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"of":[{"ref":"event","role":"attacker"},{"ref":"bound","name":"flickerAlso"}]');
  });
});
