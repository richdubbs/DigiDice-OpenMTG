/**
 * Commander lane edh-combat, round edh-next-11: the template data of parser/templates/zz-cloud/edh-next-11.json ("<player> draws a card if <condition>", "Each opponent can't block with
 * more than one creature this combat", "~ can attack players who attacked you during their last turn as though it didn't have defender", "Whenever <creature> deals combat damage to a
 * player this combat, ...") and the round's reader, renderer and engine changes ("another player attacks with N or more creatures", "none of those creatures attacked you", "that opponent"
 * for the controller of the creatures that dealt combat damage to you, "one or more players being attacked are poisoned", "fight" as an event, the per-player block limit).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-next-11-scenarios.test.ts. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (rules/cr/ is not in the cloud checkout; the text was fetched from media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhN11 from '../../../src/parser/templates/zz-cloud/edh-next-11.json';
import review11 from '../../m5/golden/cards/edh-next-11-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhN11 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 20,000 that print each wording and are full
  'eff.edhn11.obj.extrablock.any': ['Valor Made Real'],
  'sta.edhn11.enchanted.isSnow': ['Glittering Frost'],
  'sta.edhn11.self.spendAnyColor.ownActivationCosts': ['Manascape Refractor'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant), an Aura, or an ability of an artifact. */
const SPELL = new Set<string>([]);
const AURA = new Set<string>(['sta.edhn11.enchanted.isSnow']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Instant', text, { mana_cost: '{W}' }), OPTS)
    : AURA.has(t.id) ? parseCard(card('Example Growth', 'Enchantment — Aura', text, { mana_cost: '{1}{G}' }), OPTS)
      : parseCard(card('Example Relic', 'Artifact', text, {}), OPTS)).faces[0]!;

describe('edh-next-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-next-11.json, path order: after edh-next-1, before edh-next-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-next-11.json');
    expect(files.indexOf('zz-cloud/edh-next-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-next-1.json'));
    expect(files.indexOf('zz-cloud/edh-next-11.json')).toBeLessThan(files.indexOf('zz-cloud/edh-next-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 9; ids are sta./eff./rid.edhn11.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rid|dl)\.edhn11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(9);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review11 as { card: string; verified: string; expect?: string }[];
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) for (const n of NARROW[t.id]!) expect(cards, t.id).toContain(n);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of golden) expect(g.expect, g.card).toBe('full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-next-11 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bgets\b/, 'loses'], [/\btapped and attacking\b/, 'tapped and blocking'], [/\bend of combat\b/, 'end of turn'], [/\bthat's attacking\b/, "that's blocking"],
    [/\bhas\b/, 'loses'], [/\bYou control\b/, 'An opponent controls'], [/\byou control\b/, 'an opponent controls'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-next-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-next-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
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

describe.skipIf(index === null)('edh-next-11 design 6.10 (local index): synthetic examples', () => {
  it('no edh-next-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // design 6.9 deviation (one card prints the wording): the one sentence of Manascape Refractor cannot be said another way (its template has no variable part), so that line is the only exemption
    const OWN_LINES = new Set(["You may spend mana as though it were mana of any color to pay the activation costs of ~'s abilities."]);
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !OWN_LINES.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});

describe('edh-next-11 parser, renderer and pattern changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Advisor', name = 'Example Relic') => parseCard(card(name, type, text, type.includes('Creature') ? { power: '2', toughness: '2' } : {}), OPTS).faces[0]!;
  const same = (a: string, b: string, type?: string) => {
    const fa = face(a, type);
    expect(fullyAutomated(fa), a).toBe(true);
    expect(jsonKey(fa.abilities), `${a} = ${b}`).toBe(jsonKey(face(b, type).abilities));
  };
  const differs = (a: string, others: string[], type?: string) => {
    const fa = face(a, type);
    for (const o of others) {
      const f = face(o, type);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(fa.abilities), o).toBe(false);
    }
  };
  it('eff.p2rd1.prevent.all.to.obj.dur (CR 615.1a, 611.2a): "dealt this turn to <object>" says the same prevention as "dealt to <object> this turn"; another recipient or a combat-only prevention is another thing', () => {
    same('Prevent all damage that would be dealt this turn to target creature you control.', 'Prevent all damage that would be dealt to target creature you control this turn.', 'Instant');
    differs('Prevent all damage that would be dealt this turn to target creature you control.', ['Prevent all combat damage that would be dealt this turn to target creature you control.', 'Prevent all damage that would be dealt this turn by target creature you control.', 'Prevent all damage that would be dealt to target creature you control.'], 'Instant');
  });
  it('render/np.ts (CR 122.1; family that-has-keyword): "target creature that has a -1/-1 counter on it" says the same set as "... with a -1/-1 counter on it"; "without" and a different counter are other sets', () => {
    same('{B}, Sacrifice this creature: Destroy target creature that has a -1/-1 counter on it.', '{B}, Sacrifice this creature: Destroy target creature with a -1/-1 counter on it.');
    differs('{B}, Sacrifice this creature: Destroy target creature that has a -1/-1 counter on it.', ['{B}, Sacrifice this creature: Destroy target creature that has a +1/+1 counter on it.', '{B}, Sacrifice this creature: Destroy target creature without a -1/-1 counter on it.']);
  });
  it('render/stat.ts + zz-cloud/std-rx19.json (CR 305.2): "each player may play an additional land during each of their turns" is the same permission as "... on each of their turns"; "this turn" or "you" are other things', () => {
    same('Each player may play an additional land during each of their turns.', 'Each player may play an additional land on each of their turns.', 'Enchantment');
    differs('Each player may play an additional land during each of their turns.', ['Each player may play an additional land this turn.', 'You may play an additional land during each of your turns.', 'Each player may play two additional lands during each of their turns.'], 'Enchantment');
  });
  it('render/steps-lasting.ts (CR 608.2c, 705.2; family then-flip-a-coin): "Create two tokens, then flip a coin. If you win the flip, ..." says the same as the same instructions in two sentences', () => {
    const a = 'Create two 1/1 red Elemental creature tokens, then flip a coin. If you win the flip, return ~ to its owner\'s hand.';
    same(a, 'Create two 1/1 red Elemental creature tokens. Flip a coin. If you win the flip, return ~ to its owner\'s hand.', 'Sorcery');
    differs(a, ['Create two 1/1 red Elemental creature tokens, then flip a coin. If you lose the flip, return ~ to its owner\'s hand.', 'Create two 1/1 red Elemental creature tokens, then flip two coins. If you win the flip, return ~ to its owner\'s hand.'], 'Sorcery');
  });
  it('render/mods.ts (CR 611.2c, 115.1; family each-targets): "target creature you control and target creature an opponent controls each gain ..." is the pair of targets with the plural verb; "until your next turn" is another duration', () => {
    same('Target creature you control and target creature an opponent controls each gain indestructible until end of turn. Then destroy all creatures.', 'Target creature you control and target creature an opponent controls gain indestructible until end of turn. Then destroy all creatures.', 'Sorcery');
    differs('Target creature you control and target creature an opponent controls each gain indestructible until end of turn. Then destroy all creatures.', ['Target creature you control and target creature an opponent controls each gain indestructible until your next turn. Then destroy all creatures.', 'Target creature you control and target creature an opponent controls each gain first strike until end of turn. Then destroy all creatures.'], 'Sorcery');
  });
  it('render/mods.ts + zz-cloud/edh-mana-keywords-12.json (CR 613.1f, 609.4b, 602.2b): "has all activated abilities of all lands on the battlefield" is every land (no zone, no controller); a controller or "target" is another set', () => {
    differs('~ has all activated abilities of all lands on the battlefield.', ['~ has all activated abilities of all lands you control.', '~ has all activated abilities of all artifacts on the battlefield.'], 'Artifact');
    same('~ has all activated abilities of all lands. You may spend mana as though it were mana of any color to pay the activation costs of ~\'s abilities.', '~ has all activated abilities of all lands. You may spend mana as though it were mana of any color to activate those abilities.', 'Artifact');
  });
  it('parser/holes/event.ts + render/evt.ts + render/refs.ts (CR 606.3, 303.4, 602.2): "whenever you activate a loyalty ability of enchanted planeswalker" names the permanent the Aura is attached to; a loyalty ability of any planeswalker, an opponent, or an enchanted creature is another thing', () => {
    const a = 'Enchant planeswalker\nWhenever you activate a loyalty ability of enchanted planeswalker, copy that ability. You may choose new targets for the copy.';
    const fa = face(a, 'Enchantment — Aura');
    expect(fullyAutomated(fa)).toBe(true);
    expect(JSON.stringify(fa.abilities)).toContain('"ev":"activate"');
    expect(JSON.stringify(fa.abilities)).toContain('"ability":"loyalty"');
    expect(JSON.stringify(fa.abilities)).toContain('"attachedToSource":true');
    for (const o of ['Enchant planeswalker\nWhenever you activate a loyalty ability, copy that ability. You may choose new targets for the copy.', 'Enchant planeswalker\nWhenever an opponent activates a loyalty ability of enchanted planeswalker, copy that ability. You may choose new targets for the copy.', 'Enchant creature\nWhenever you activate a loyalty ability of enchanted creature, copy that ability. You may choose new targets for the copy.']) {
      const f = face(o, 'Enchantment — Aura');
      expect(fullyAutomated(f) && JSON.stringify(f.abilities) === JSON.stringify(fa.abilities), o).toBe(false);
    }
  });
});
