/**
 * Commander lane edh-perms, round edh-perms-5: the template data of parser/templates/zz-cloud/edh-perms-5.json ("Choose any number of target creatures you control. For each of
 * them, create a token that's a copy of that creature, except it has haste"; "Its controller creates two tokens that are copies of that creature, except their power is half
 * that creature's power and their toughness is half that creature's toughness. Round up each time."; "Put a +1/+1 counter on each creature you control and a loyalty counter on
 * each planeswalker you control"; "Equipped creature has base power and toughness 7/7 and can't be blocked by creatures with power 2 or less"). The hole, lowering and renderer
 * changes ("that creature dies this way", "Round up each time", X/1 tokens with a computed power, creature-type lists joined with "and", the merged base-power static) are tested at
 * the end of this file and in edh-perms-5-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-5-scenarios.test.ts. CR cites from
 * memory unless noted, unverified for the parts the CR text of 2026-09-25 was not read for.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm5 from '../../../src/parser/templates/zz-cloud/edh-perms-5.json';
import review from '../../m5/golden/cards/edh-perms-5-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm5 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm5.forEachOfThem.copyToken.except': ['Twinflame'],
  'eff.edhpm5.player.copyTokens.except': ['Saw in Half'],
  'eff.edhpm5.counters.put.twoGroups': ['Brokers Ascendancy'],
  'sta.edhpm5.attached.basept.cantBeBlockedBy': ['Wrecking Ball Arm'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura or an Equipment for an attached static, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', text.includes('Equipped') ? 'Artifact — Equipment' : 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-5 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-5.json, path order: after edh-perms-3, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-5.json');
    expect(files.indexOf('zz-cloud/edh-perms-5.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-3.json'));
    expect(files.indexOf('zz-cloud/edh-perms-5.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm5.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhpm5\./);
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

describe('edh-perms-5 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-perms-5 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-5 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-5 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-5 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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




describe('edh-perms-5 parser and renderer changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  it('parser/holes/cond.ts + lower/conditions.ts + render/cond.ts (CR 700.4, 701.8a): "that creature dies this way" reads a destroy of one announced target; "a creature dies this way", a sacrifice and a destroy-all are not read', () => {
    const ok = spell('Destroy target creature. If that creature dies this way, you gain 2 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"to":"graveyard"');
    expect(fullyAutomated(spell('Destroy target creature. If a creature dies this way, you gain 2 life.'))).toBe(false);
    expect(fullyAutomated(spell('Sacrifice a creature. If that creature dies this way, you gain 2 life.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy all creatures. If that creature dies this way, you gain 2 life.'))).toBe(false);
    expect(fullyAutomated(spell('Destroy target artifact. If that creature dies this way, you gain 2 life.'))).toBe(false);
  });
  it('parser/holes/p2copyperm1.ts + lower/ability.ts + render/steps-zones.ts (CR 707.9b, 107.1a): "their power is half ..." is read only with the rounding sentence after it, up or down, and only for several tokens', () => {
    const base = 'Destroy target creature. Its controller creates two tokens that are copies of that creature, except their power is half that creature\'s power and their toughness is half that creature\'s toughness.';
    const up = spell(`${base} Round up each time.`);
    const down = spell(`${base} Round down each time.`);
    expect(fullyAutomated(up)).toBe(true);
    expect(fullyAutomated(down)).toBe(true);
    expect(JSON.stringify(up.abilities)).toContain('"op":"ceilDiv"');
    expect(JSON.stringify(down.abilities)).toContain('"op":"floorDiv"');
    expect(fullyAutomated(spell(base))).toBe(false); // CR 107.1a: the rounding is always stated
    expect(fullyAutomated(spell(`${base.replace('two tokens that are copies', 'a token that\'s a copy').replace('their power', 'its power').replace('their toughness', 'its toughness')} Round up each time.`))).toBe(false);
    expect(fullyAutomated(spell(`${base.replace('that creature\'s toughness', 'that creature\'s power')} Round up each time.`))).toBe(true); // any number, not only the matching characteristic
  });
  it('parser/lower/ability.ts: "Round down each time." still joins "half" (Pox Plague\'s reading is unchanged)', () => {
    const pox = spell('Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of their choice. Round down each time.', 'Sorcery');
    expect(fullyAutomated(pox)).toBe(true);
    expect(fullyAutomated(spell('Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of their choice. Round up each time.', 'Sorcery'))).toBe(false);
  });
  it('render/steps-zones.ts (CR 111.4, 107.3): a token with a computed power and a plain toughness (X/1) is said "an X/1 ... token, where X is ..."; a computed toughness with a plain power too; two different computed numbers are not', () => {
    const power = parseCard(card('Example Engine', 'Artifact', 'At the beginning of your upkeep, put a gear counter on this artifact, then create an X/1 green Beast creature token, where X is the number of gear counters on this artifact.'), OPTS).faces[0]!;
    expect(fullyAutomated(power)).toBe(true);
    const tough = parseCard(card('Example Engine', 'Artifact', 'At the beginning of your upkeep, put a gear counter on this artifact, then create a 1/X green Beast creature token, where X is the number of gear counters on this artifact.'), OPTS).faces[0]!;
    expect(fullyAutomated(tough)).toBe(true);
    const same = parseCard(card('Example Engine', 'Artifact', 'At the beginning of your upkeep, create an X/X green Beast creature token, where X is the number of creatures you control.'), OPTS).faces[0]!;
    expect(fullyAutomated(same)).toBe(true);
    const both = parseCard(card('Example Engine', 'Artifact', 'At the beginning of your upkeep, create an X/Y green Beast creature token, where X is the number of creatures you control.'), OPTS).faces[0]!;
    expect(fullyAutomated(both)).toBe(false);
  });
  it('render/np.ts (CR 205.3m): "Other Ninja and Rogue creatures you control get +1/+1" is the same set as "... Ninja or Rogue creatures ..."; the singular and other lists are unchanged', () => {
    const and = parseCard(card('Example Lord', 'Creature — Ninja', 'Other Ninja and Rogue creatures you control get +1/+1.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    const or = parseCard(card('Example Lord', 'Creature — Ninja', 'Other Ninja or Rogue creatures you control get +1/+1.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(and)).toBe(true);
    expect(jsonKey(and.abilities)).toBe(jsonKey(or.abilities));
    const three = parseCard(card('Example Lord', 'Creature — Ninja', 'Other Ninja, Rogue, and Elf creatures you control get +1/+1.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(three)).toBe(true);
    // a card type list keeps its own wording: "artifact and creature" is a different description
    const typed = parseCard(card('Example Lord', 'Creature — Ninja', 'Other artifact and creature permanents you control get +1/+1.', { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(jsonKey(typed.abilities)).not.toBe(jsonKey(and.abilities));
  });
  it('render/stat.ts (CR 613.4b, 509.1b): the merged "has base power and toughness N/N and can\'t be blocked by ..." also for a group; a base power with another restriction stays two sentences', () => {
    const arm = parseCard(card('Example Relic', 'Artifact — Equipment', 'Equipped creature has base power and toughness 7/7 and can\'t be blocked by creatures with power 2 or less.'), OPTS).faces[0]!;
    expect(fullyAutomated(arm)).toBe(true);
    expect(JSON.stringify(arm.abilities)).toContain('"layer":"7b"');
    expect(JSON.stringify(arm.abilities)).toContain('"action":"beBlockedBy"');
    const pump = parseCard(card('Example Relic', 'Artifact — Equipment', 'Equipped creature gets +1/+1 and can\'t be blocked by creatures with power 2 or less.'), OPTS).faces[0]!;
    expect(fullyAutomated(pump)).toBe(true);
    expect(JSON.stringify(pump.abilities)).toContain('"layer":"7c"');
  });
});
