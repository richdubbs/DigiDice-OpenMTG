/**
 * Commander lane edh-perms, round edh-perms-10: the template data of parser/templates/zz-cloud/edh-perms-10.json (riders that give a moved permanent extra counters if it matches a
 * description, "becomes a creature with <abilities>", the token copy that enters tapped and attacking, "become 3/3 artifact creatures" for good). The hole, renderer and engine changes
 * ("becomes unattached from a permanent", "enters from your hand", "return each of them", `countersIf`) are tested at the end of this file and in edh-perms-10-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-perms-10-scenarios.test.ts. CR cites verified against the
 * Comprehensive Rules of 2026-09-25 (701.3d, 603.10c, 614.1c, 508.4, 205.1a) where marked in the scenarios; the rest from memory, unverified.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm10 from '../../../src/parser/templates/zz-cloud/edh-perms-10.json';
import review from '../../m5/golden/cards/edh-perms-10-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm10 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'rid.edhpm10.entersWith.ifMv': ['Turntimber Symbiosis // Turntimber, Serpentine Wood'],
  'rid.edhpm10.entersWith.ifCreature': ["Teferi's Time Twist"],
  'rid.edhpm10.entersWith.eachOfThem.byType': ["Semester's End"],
  'eff.edhpm10.becomes.creature.withAbilities': ['Druid Class'],
  'rid.edhpm10.copy.token.entersTappedAttacking': ['Thousand-Faced Shadow'],
  'eff.edhpm10.become.artifactCreatures.permanent': ['Depthshaker Titan'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: an Aura or an Equipment for an attached static, an Enchantment for a trigger, else a spell. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', text.includes('Equipped') ? 'Artifact — Equipment' : 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-10 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-10.json, path order: after edh-perms-5) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-10.json');
    expect(files.indexOf('zz-cloud/edh-perms-10.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    expect(files.indexOf('zz-cloud/edh-perms-10.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm10.* (or eff., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rid)\.edhpm10\./);
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

describe('edh-perms-10 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-perms-10 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-10 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-10 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-10 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-perms-10 parser, renderer and engine changes (one test each)', () => {
  const spell = (text: string, type = 'Instant') => parseCard(card('Example Plan', type, text), OPTS).faces[0]!;
  const equipment = (text: string) => parseCard(card('Example Gear', 'Artifact — Equipment', text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Beast', 'Creature — Beast', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/event.ts + render/evt.ts + triggers (CR 701.3d, 603.10c): "whenever this Equipment becomes unattached from a permanent" is the Equipment leaving a permanent of that description; "that permanent" is what it left; without "from", with another noun or a plural it is not read', () => {
    const ok = equipment('Whenever this Equipment becomes unattached from a permanent, sacrifice that permanent.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"what":"unattached"');
    expect(fullyAutomated(equipment('Whenever this Equipment becomes unattached from a creature, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(equipment('Whenever this Equipment becomes unattached from a permanent, sacrifice it.'))).toBe(false); // "it" is the Equipment itself
    expect(fullyAutomated(equipment('Whenever this Equipment becomes unattached from permanents, sacrifice that permanent.'))).toBe(false);
    expect(fullyAutomated(equipment('Whenever this Equipment becomes unattached, sacrifice that permanent.'))).toBe(false); // no "from": nothing says which permanent
    expect(ENGINE_CAPABILITIES.has('feature:ev.becomes.unattached')).toBe(true);
  });
  it('parser/holes/event.ts + render/evt.ts (CR 400.3, 603.6a): "enters from your hand" is a hand its owner\'s: the subject is a card you own; "from a hand", "from your library" and a batch are not read', () => {
    const ok = creature('When this creature enters from your hand, you gain 1 life.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"from":"hand"');
    expect(fullyAutomated(creature('Whenever another creature you control enters from your hand, you gain 1 life.'))).toBe(true);
    expect(fullyAutomated(creature('When this creature enters from a hand, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(creature('When this creature enters from your library, you gain 1 life.'))).toBe(false);
    expect(fullyAutomated(creature('Whenever one or more creatures enter from your hand, you gain 1 life.'))).toBe(false);
  });
  it('parser/holes/object.ts + render/steps-zones.ts (CR 608.2c): "return each of them to the battlefield under its owner\'s control" is the group "them"; "each of those", "each of the" and a singular stay as they were', () => {
    const base = 'Exile up to two target creatures you control. At the beginning of the next end step, return';
    expect(fullyAutomated(spell(`${base} each of them to the battlefield under its owner's control.`))).toBe(true);
    expect(fullyAutomated(spell(`${base} them to the battlefield under their owners' control.`))).toBe(true);
    expect(fullyAutomated(spell(`${base} each of those to the battlefield under its owner's control.`))).toBe(false);
    expect(fullyAutomated(spell(`${base} each of them to the battlefield under your control.`))).toBe(false);
  });
  it('render/edhpm10.ts + render/fold.ts + render/steps-lasting.ts (CR 614.1c): the counters a moved card enters with are said in the sentence after the move, and in no other shape (a different comparison, count of kinds, creature-only with two counters)', () => {
    const dig = 'Look at the top five cards of your library. You may put a creature card from among them onto the battlefield.';
    const rest = 'Put the rest on the bottom of your library in a random order.';
    expect(fullyAutomated(spell(`${dig} If that card has mana value 2 or less, it enters with two additional +1/+1 counters on it. ${rest}`, 'Sorcery'))).toBe(true);
    expect(fullyAutomated(spell(`${dig} If that card has mana value 2 or greater, it enters with two additional +1/+1 counters on it. ${rest}`, 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell(`${dig} If that card has mana value 2 or less, it enters with two additional +1/+1 counters on it and a flying counter on it. ${rest}`, 'Sorcery'))).toBe(false);
    expect(fullyAutomated(spell(`${dig} If that card has mana value 2 or less, it enters with two additional +1/+1 counters on it.`, 'Sorcery'))).toBe(true);
    expect(JSON.stringify(spell(`${dig} If that card has mana value 2 or less, it enters with two additional +1/+1 counters on it. ${rest}`, 'Sorcery').abilities)).toContain('"countersIf"');
    const twist = (tail: string) => spell(`Exile target artifact you control. Return that card to the battlefield under its owner's control at the beginning of the next end step. ${tail}`);
    expect(fullyAutomated(twist('If it enters as a creature, it enters with an additional +1/+1 counter on it.'))).toBe(true);
    expect(fullyAutomated(twist('If it enters as a creature, it enters with two additional +1/+1 counters on it.'))).toBe(false);
    expect(ENGINE_CAPABILITIES.has('op:move.countersIf')).toBe(true);
  });
  it('render/steps-zones.ts (CR 508.4, 110.5b): a token copy is also said "a token that\'s a copy of X. The token enters tapped and attacking."; one token only, and not without the second sentence', () => {
    const attacker = (tail: string) => parseCard(card('Example Beast', 'Creature — Beast', `Whenever this creature attacks, create a token that's a copy of another target attacking creature.${tail}`, { power: '2', toughness: '2' }), OPTS).faces[0]!;
    expect(fullyAutomated(attacker(' The token enters tapped and attacking.'))).toBe(true);
    expect(fullyAutomated(attacker(' The token enters tapped.'))).toBe(false);
    expect(fullyAutomated(attacker(' The tokens enter tapped and attacking.'))).toBe(false);
  });
});
