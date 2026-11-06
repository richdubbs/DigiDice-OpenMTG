/**
 * Commander lane edh-perms, round edh-perms-9: the template data of parser/templates/zz-cloud/edh-perms-9.json ("untap it and all Dwarves you control"; "Equipped creature gets +2/+2, has
 * trample, and is a green Beast"; "Enchanted permanent is a Vehicle artifact with crew 4 and it loses all other card types"; "lose hexproof, indestructible, protection, shroud, and ward
 * until end of turn"; "~ and enchanted creature each get +1/+1 for each creature you control and +1/+1 for each Aura you control"; "During your turn, equipped creature has hexproof and
 * can't be blocked"; "As long as ..., untap all creatures you control during each other player's untap step"; "Until end of turn, each creature target player controls loses all
 * abilities and becomes a blue Frog with base power and toughness 1/1"). The hole, lowering and renderer changes (the put-onto-the-battlefield marker, "equal or lesser mana value" of
 * the entering permanent, "except for lands and tokens", excess damage "to a permanent", the supertype before each type, "each of" before the targets of two folded puts of counters,
 * a bestow creature's "this Aura") are tested at the end of this file and in edh-perms-9-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-perms-9-scenarios.test.ts. CR cites from memory (no rules/cr in a cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm9 from '../../../src/parser/templates/zz-cloud/edh-perms-9.json';
import review from '../../m5/golden/cards/edh-perms-9-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm9 as Template[];
const MECH_COUNT = 8;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm9.untap.itAndAll': ['Godo, Bandit Warlord'],
  'sta.edhpm9.attached.pump.grant.isColorSubtype': ['Nim Deathmantle'],
  'sta.edhpm9.enchanted.permanent.subtype.artifact.crew': ['Swift Reconfiguration'],
  'eff.edhpm9.lose.fiveKeywords': ['Shay Cormac'],
  'sta.edhpm9.selfAndEnchanted.pump.foreach.two': ['Eidolon of Countless Battles'],
  'sta.edhpm9.yourTurn.attached.grant.unblockable': ["Bilbo's Ring"],
  'sta.edhpm9.asLongAs.untap.othersUntapStep.group': ['Quest for Renewal'],
  'eff.edhpm9.eot.eachLoseAll.becomes': ["Polymorphist's Jest"],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a static for an Equipment, an Aura or an enchantment, a trigger or a spell otherwise. */
const parsedWith = (t: Template, text: string) => {
  if (/\benchanted\b/i.test(text) && t.id.startsWith('sta.') && t.id !== 'sta.edhpm9.selfAndEnchanted.pump.foreach.two') return parseCard(card('Example Aura', 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (/^Whenever this creature/.test(text)) return parseCard(card('Example Soldier', 'Creature — Soldier', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  if (t.id === 'sta.edhpm9.attached.pump.grant.isColorSubtype' || t.id === 'sta.edhpm9.yourTurn.attached.grant.unblockable') return parseCard(card('Example Relic', 'Artifact — Equipment', text, { mana_cost: '{3}' }), OPTS).faces[0]!;
  if (t.id === 'sta.edhpm9.selfAndEnchanted.pump.foreach.two') return parseCard(card('Example Spirit', 'Enchantment Creature — Spirit', text, { mana_cost: '{3}{W}', power: '2', toughness: '2' }), OPTS).faces[0]!;
  if (t.id === 'sta.edhpm9.enchanted.permanent.subtype.artifact.crew') return parseCard(card('Example Aura', 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (t.id === 'sta.edhpm9.asLongAs.untap.othersUntapStep.group') return parseCard(card('Example Quest', 'Enchantment', text), OPTS).faces[0]!;
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', 'Artifact', text, { mana_cost: '{3}' }), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  if (/^\{/.test(text)) return parseCard(card('Example Gate', 'Creature — Wizard', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-9 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-9.json, path order: after edh-perms-3, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-9.json');
    expect(files.indexOf('zz-cloud/edh-perms-9.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    expect(files.indexOf('zz-cloud/edh-perms-9.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm9.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhpm9\./);
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
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of review as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
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

describe('edh-perms-9 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const swaps: [RegExp, string][] = [
    [/\bremoved this way\b/, 'put this way'], [/\bfor each\b/, 'for every two'], [/\ban additional\b/, 'two additional'], [/\bany number of\b/, 'all'],
    [/\bany type\b/, 'any color'], [/\bany color\b/, 'any type'], [/\bcould produce\b/, 'produced'], [/\bland produced\b/, 'creature produced'],
    [/\byou control\b/, 'an opponent controls'], [/\ban opponent controls\b/, 'you control'], [/\bone mana\b/, 'two mana'], [/\bplus that many\b/, 'plus twice that many'], [/\bthat many\b/, 'twice that many'], [/\bone or more\b/, 'two or more'], [/\bnumber of\b/, 'number of twice'], [/\bequal to\b/, 'equal to twice'], [/\bcan't be blocked\b/, 'can be blocked'], [/\bin addition to\b/, 'instead of'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-perms-9 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-9 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (/^counters?\b/.test(words[i + 1] ?? '')) return; // a counter's kind is any word (CR 122.1): "a blorfty counter" is a counter kind, not nonsense
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

describe.skipIf(index === null)('edh-perms-9 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-9 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-perms-9 parser, lowering and renderer changes (one test each)', () => {
  const one = (text: string, type = 'Creature — Spirit') => parseCard(card('Example Relic', type, text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  it('parser/holes/cond.ts + effects/eval.ts (CR 608.2, 603.4): "if it wasn\'t put onto the battlefield with this ability" is the negated `putBySource` of the entering permanent, only that wording, only "this ability"', () => {
    const body = 'Whenever another permanent you control enters, if it wasn\'t put onto the battlefield with this ability, you may put a permanent card with equal or lesser mana value from your hand onto the battlefield.';
    const ok = one(body);
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"cond":"putBySource"');
    expect(fullyAutomated(one(body.replace('with this ability', 'with a spell')))).toBe(false);
    expect(fullyAutomated(one(body.replace("wasn't put", 'was put')))).toBe(false); // only the negative wording is read
    expect(fullyAutomated(one(body.replace('Whenever another permanent you control enters, ', 'Whenever you gain life, ')))).toBe(false); // it names no entering permanent
  });
  it('parser/lower/ability.ts + render/np.ts (CR 202.3, 603.6a): "equal or lesser mana value" in a trigger about a permanent entering or dying is at most the mana value of that permanent; a cast trigger keeps the spell (std-rx28), a spell and an activated ability have neither', () => {
    const enters = one('Whenever another creature you control enters, you may put a permanent card with equal or lesser mana value from your hand onto the battlefield.');
    expect(fullyAutomated(enters)).toBe(true);
    expect(JSON.stringify(enters.abilities)).toContain('"role":"subject"');
    const dies = one('Whenever a creature you control dies, return a creature card with equal or lesser mana value from your graveyard to the battlefield.');
    expect(JSON.stringify(dies.abilities)).not.toContain('"role":"spell"');
    const cast = one('Whenever you cast a spell, you may cast a creature spell with equal or lesser mana value from your hand without paying its mana cost.');
    expect(JSON.stringify(cast.abilities)).toContain('"role":"spell"');
    expect(fullyAutomated(one('{T}: You may put a permanent card with equal or lesser mana value from your hand onto the battlefield.'))).toBe(false);
  });
  it('parser/holes/filter.ts + render/np.ts (CR 205.2a, 111.1): "except for lands and tokens" is the negation of each listed kind; a single kind, a kind that is not a plain type, and an "except" with no list are not read this way', () => {
    const spell = (t: string) => parseCard(card('Example Plan', 'Instant', t), OPTS).faces[0]!;
    const ok = spell('Destroy all permanents except for lands and tokens.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"notTypes":["Land"]');
    expect(JSON.stringify(ok.abilities)).toContain('"token":false');
    expect(fullyAutomated(spell('Destroy all permanents except for lands and creatures with flying.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy all permanents except for lands, artifacts, and tokens.'))).toBe(true);
    expect(fullyAutomated(spell('Destroy all permanents except for.'))).toBe(false);
  });
  it('parser/holes/excess.ts + render/steps-zones.ts + render/cond.ts (CR 120.10, 608.2c): "if excess damage was dealt to a permanent this way, create that many tapped Treasure tokens" names the damage step before it; none before it is not read', () => {
    const ok = parseCard(card('Example Plan', 'Instant', 'Example Plan deals 3 damage to any target. If excess damage was dealt to a permanent this way, create that many tapped Treasure tokens.'), OPTS).faces[0]!;
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"q":"excessDamage"');
    expect(fullyAutomated(parseCard(card('Example Plan', 'Instant', 'Draw a card. If excess damage was dealt to a permanent this way, create that many tapped Treasure tokens.'), OPTS).faces[0]!)).toBe(false);
  });
  it('parser/front/selfref.ts (CR 702.103b, 303.4): a bestow creature\'s "this Aura" is itself, so the Aura clause of a bestow card reads like any Aura\'s; a card without bestow keeps "this Aura" as two words', () => {
    const bestow = parseCard(card('Example Hydra', 'Enchantment Creature — Hydra', 'Bestow {2}{G}{G}\nEnchanted creature gets +1/+1 for each +1/+1 counter on this Aura and has reach and trample.', { power: '1', toughness: '1', keywords: ['Bestow'] }), OPTS).faces[0]!;
    expect(fullyAutomated(bestow)).toBe(true);
    const plain = parseCard(card('Example Hydra', 'Enchantment Creature — Hydra', 'Enchanted creature gets +1/+1 for each +1/+1 counter on this Aura and has reach and trample.', { power: '1', toughness: '1' }), OPTS).faces[0]!;
    expect(fullyAutomated(plain)).toBe(false);
  });
});
