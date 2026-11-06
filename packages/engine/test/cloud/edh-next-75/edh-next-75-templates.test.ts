/**
 * Commander lane commander, edh-next-75: the template data of parser/templates/zz-cloud/edh-next-75.json (Imposing Grandeur, Myth Unbound, Rilsa Rael, Barrowin of Clan Undurr, Regal Sliver, Hama Pashar and Dungeon Delver)
 * and the parser, renderer and engine changes of the round (one test each at the end). Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are
 * synthetic wordings (design 6.10). The behavior is in edh-next-75-scenarios.test.ts. CR cites from memory unless the record names them (unverified).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhNext75 from '../../../src/parser/templates/zz-cloud/edh-next-75.json';
import review from '../../m5/golden/cards/edh-next-75-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhNext75 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one
 * or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (decided by the owner's standing rule 2026-10-27).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhn75.eachMay.wheel.commanderMv': ['Imposing Grandeur'],
  'sta.edhn75.commander.costLess.forEachCast': ['Myth Unbound'],
  'eff.edhn75.ifCond.alsoGetsAndGains': ['Rilsa Rael, Kingpin'],
  'eff.edhn75.return.upTo.bf.ifCond': ['Barrowin of Clan Undurr'],
  'eff.edhn75.pump.dur.ifCond': ['Regal Sliver'],
  'sta.edhn75.roomAbilities.extraTrigger': ['Hama Pashar, Ruin Seeker', 'Dungeon Delver'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature (static, triggered, replacement). */
const SPELL = new Set<string>(['eff.edhn75.eachMay.wheel.commanderMv', 'eff.edhn75.ifCond.alsoGetsAndGains', 'eff.edhn75.pump.dur.ifCond']);
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id)
    ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{R}' }), OPTS)
    : parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-next-75 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-75.json, path order: after edh-next-71, before edh-next-8) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-75.json');
    expect(files.indexOf('zz-cloud/edh-next-75.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-7.json'));
    expect(files.indexOf('zz-cloud/edh-next-75.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-8.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are eff.edhn75.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rid|kw|cm|rst|trg|rep)\.edhn75\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
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

describe('edh-next-75 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bor more\b/, 'or less'], [/\bhaste\b/, 'flying'], [/\btop\b/, 'bottom'], [/\bonce\b/i, 'twice'], [/\bcast\b/, 'exile'], [/\bwithout paying its mana cost\b/, 'by paying its mana cost'], [/\bor less\b/, 'or more'], [/\bplay\b/, 'cast'], [/\battacked\b/, 'blocked'], [/\bspell\b/, 'ability'], [/\blife\b/, 'cards'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-75 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-75 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          if (words.includes('--') && i < words.indexOf('--')) return; // the ability word before the dash has no rules meaning (CR 207.2c)
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

describe.skipIf(index === null)('edh-next-75 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-75 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-next-75 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Sorcery', name = 'Example Plan') => parseCard(card(name, type, text), OPTS).faces[0]!;
  const creature = (text: string) => parseCard(card('Example Relic', 'Legendary Artifact Creature — Golem Villain', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/cond.ts, parser/lower/ability.ts, render/abil.ts (CR 113.6b, 603.4; Oloro): "if ~ is in the command zone" makes the trigger work in the command zone only, and only on its own', () => {
    const t = 'At the beginning of your upkeep, if ~ is in the command zone, you gain 2 life.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"zone":["command"]');
    expect(fullyAutomated(creature(t.replace('the command zone', 'the command zone or on the battlefield')))).toBe(true); // eminence, the older reading, unchanged
    expect(JSON.stringify(creature(t.replace('the command zone', 'the command zone or on the battlefield')).abilities)).toContain('"zone":["battlefield","command"]');
    expect(fullyAutomated(creature(t.replace('is in the command zone', 'is in your hand')))).toBe(false);
  });
  it('parser/holes/filter.ts, render/np.ts (CR 408.1, 903.9a; Campfire): "from the command zone and from your graveyard" is the two zones of your own cards, in that order, and only with "you own"', () => {
    const t = 'Put all commanders you own from the command zone and from your graveyard into your hand.';
    expect(fullyAutomated(face(t, 'Instant'))).toBe(true);
    expect(JSON.stringify(face(t, 'Instant').abilities)).toContain('"zone":["command","graveyard"]');
    expect(fullyAutomated(face(t.replace('your graveyard', 'a graveyard'), 'Instant'))).toBe(false);
    expect(fullyAutomated(face(t.replace('you own', 'your opponents own'), 'Instant'))).toBe(false);
  });
  it('parser/holes/event.ts, parser/lower/scope.ts, render/refs.ts (CR 508.1b, 725.1; The Spear of Bashenga): "attacks the monarch" names the monarch as the defender, and "that player" after it is the player attacked', () => {
    const t = 'Whenever ~ attacks the monarch, destroy target tapped nonland permanent that player controls.';
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"defender":{"ref":"monarch"}');
    expect(fullyAutomated(creature(t.replace('the monarch', 'the initiative')))).toBe(false);
  });
  it('types/ability.ts, statics/costmods.ts, render/stat.ts (CR 903.8, 601.2f; Myth Unbound): the casts of the commander whose cost is changed is read in a cost amount only', () => {
    const t = "Your commander costs {1} less to cast for each time it's been cast from the command zone this game.";
    expect(fullyAutomated(creature(t))).toBe(true);
    expect(JSON.stringify(creature(t).abilities)).toContain('"costSpell":true');
    expect(fullyAutomated(creature("Creatures you control get +1/+1 for each time it's been cast from the command zone this game."))).toBe(false);
  });
  it('statics/hooks.ts, core/dungeons.ts (CR 309.4c, 603.2d): the rule roomAbilitiesExtra is the rule of its controller and has no other wording', () => {
    expect(JSON.stringify(creature('Room abilities of dungeons you own trigger an additional time.').abilities)).toContain('"rule":"roomAbilitiesExtra"');
    expect(fullyAutomated(creature('Room abilities of dungeons you own trigger two additional times.'))).toBe(false);
  });
});
