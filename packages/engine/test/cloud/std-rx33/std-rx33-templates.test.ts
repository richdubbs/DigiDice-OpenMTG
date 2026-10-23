/**
 * EDH lane rx33 (std-rx33): the template data of parser/templates/zz-cloud/std-rx33.json ("<src> deals N damage to <recipient> and [M damage to] each <filter>";
 * "each opponent sacrifices a <permanent> of their choice unless they pay <cost>"; "enchanted|equipped creature can block an additional creature each combat",
 * with a P/T change and a grant, and "~ can block an additional creature each combat as long as <Cond>"; "enchanted|equipped creature gets +N/+M and can't be
 * blocked by <filter>"), the four templates of earlier rounds the round promoted with their evidence, and the round's parser and renderer changes (Cost: "you may
 * pay {E}{E}"; render/stat.ts#sharedSubject for "gets +2/+2, has vigilance, and can block an additional creature each combat").
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-rx33-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdRx33 from '../../../src/parser/templates/zz-cloud/std-rx33.json';
import review from '../../m5/golden/cards/cloud-std-rx33-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdRx33 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdrx33.damage.recipientAndEach': 'Radiating Lightning', // the only tuning-half printing (Chandra's Fury needs "that planeswalker's controller")
  'eff.stdrx33.damage.recipientAndEach.same': "Chandra, Flame's Fury", // and Chandra, Bold Pyromancer; the other printings are held out or name a planeswalker
  'eff.stdrx33.each.opponent.sacrifice.unless.they.pay': 'Rishadan Footpad', // and Rishadan Cutpurse; Rishadan Brigand is held out
  'sta.stdrx33.attached.extrablock': 'Echo Circlet',
  'sta.stdrx33.self.extrablock.aslong': 'Entourage of Trest',
  'sta.stdrx33.attached.pump.has.extrablock': "Iona's Blessing",
  'sta.stdrx33.attached.pump.cantBeBlockedBy': 'Dust Corona',
};
/** Templates of earlier rounds this round promoted (experimental -> stable), each on three or more tuning-half golden cards of cloud-std-rx33-review.json. */
const PROMOTED: readonly string[] = ['eff.c3.tap.freeze.it', 'rep.stdsos.enters.counters.numberEqual', 'sta.cmd1.self.pump.whereX', 'eff.m6.turnFaceDown'];
/** Templates kept experimental (none: each has its golden evidence). */
const EXPERIMENTAL: readonly string[] = [];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * A synthetic card in which an example is an ability of the right kind: an Aura for "Enchant ...", an Equipment for "Equip ...", else a creature (triggered and
 * activated abilities, the instant and sorcery effects of a creature's lines are read the same way by the effect templates).
 */
const parsedWith = (_t: Template, text: string) => {
  if (/^Enchant\b/.test(text) || /^Enchanted\b/.test(text)) return parseCard(card('Example Charm', 'Enchantment — Aura', /^Enchant /.test(text) ? text : `Enchant creature\n${text}`), OPTS).faces[0]!;
  if (/^Equip\b/.test(text) || /^Equipped\b/.test(text)) return parseCard(card('Example Gear', 'Artifact — Equipment', text), OPTS).faces[0]!;
  return parseCard(card('Example Shaman', 'Creature — Goblin Shaman', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
};
const face = (type: string, text: string, pt?: [string, string]) => parseCard(card('Example Monk', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;
const fullFace = (f: ReturnType<typeof face>): boolean => fullyAutomated(f) && f.gate.every((g) => g.ok) && f.diagnostics.every((d) => d.level !== 'manual');

describe('std-rx33 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-rx33.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-rx33.json');
    expect(files.indexOf('zz-cloud/std-rx33.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-rx33.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta|eff.stdrx33.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|eff)\.stdrx33\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.status, t.id).toBe(EXPERIMENTAL.includes(t.id) ? 'experimental' : 'stable');
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

describe('std-rx33 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} during combat.`];
  const swaps: [RegExp, string][] = [[/\bcan't\b/, 'can'], [/\bopponent\b/, 'teammate'], [/\bunless\b/, 'if'], [/\badditional\b/, 'other'], [/\beach combat\b/, 'this turn'],
    [/\bthat player\b/, 'you'], [/\bthey\b/, 'you'], [/\bas long as\b/, 'unless']];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-rx33 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/during combat" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-rx33 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^\{/.test(w)) return;
          const end = w.match(/[.,:]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('std-rx33 design 6.10 (local index): synthetic examples', () => {
  it('no std-rx33 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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



// ---- promotions (design 6.9): evidence of the earlier rounds' templates this round made stable ----------------------------------------------------------------

describe('std-rx33 promotions (design 6.9): eff.c3.tap.freeze.it, rep.stdsos.enters.counters.numberEqual, sta.cmd1.self.pump.whereX, eff.m6.turnFaceDown', () => {
  it('each is stable and cited by three or more golden cards of cloud-std-rx33-review.json, each pinned full', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const id of PROMOTED) {
      expect(TEMPLATE_SET.find((t) => t.id === id)?.status, id).toBe('stable');
      const cards = golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id},`) || g.verified.includes(` ${id})`) || g.verified.includes(`, ${id}`)).map((g) => g.card);
      expect(cards.length, `${id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ---- parser/holes/cost.ts#symbols: "you may pay {E}{E}" ---------------------------------------------------------------------------------------------------------

describe('std-rx33 Cost (CR 107.14, 118.3): a run of energy symbols right after "pay"', () => {
  it('"you may pay {E}{E}. If you do, ..." is full and writes payEnergy with the number of symbols', () => {
    const f = face('Creature — Human Artificer', 'Whenever this creature attacks, you may pay {E}{E}{E}. If you do, draw a card.', ['2', '2']);
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"cost":{"other":[{"kind":"payEnergy","amount":3}]}');
  });
  it('a bare energy run is not a cost anywhere else ("{E}: Draw a card." is not read as paying energy)', () => {
    const f = face('Creature — Human Artificer', '{E}{E}: Draw a card.', ['2', '2']);
    expect(JSON.stringify(f.abilities)).not.toContain('"payEnergy"');
    const g = face('Creature — Human Artificer', '{E}{E}, Pay {E}: Draw a card.', ['2', '2']);
    expect(fullFace(g)).toBe(false);
  });
});

// ---- render/stat.ts#sharedSubject: "gets +2/+2, has vigilance, and can block an additional creature each combat" -------------------------------------------

describe('std-rx33 renderer (CR 613.4c, 613.1f, 509.1a): the attached creature\'s P/T change and grant, then its extra block, the subject said once', () => {
  it('the three-part list is full and writes the rule extraBlockers of {is: attachedTo}', () => {
    const f = face('Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+1, has trample, and can block an additional creature each combat.');
    expect(fullFace(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"s":"rule","rule":"extraBlockers","value":1,"of":{"is":{"ref":"attachedTo"}}}');
  });
  it('"can block two additional creatures" is not this reading', () => {
    const f = face('Enchantment — Aura', 'Enchant creature\nEnchanted creature gets +3/+1, has trample, and can block two additional creatures each combat.');
    expect(fullFace(f)).toBe(false);
  });
});
