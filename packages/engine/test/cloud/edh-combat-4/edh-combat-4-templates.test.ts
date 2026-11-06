/**
 * Commander lane edh-combat, round edh-combat-4: the template data of parser/templates/zz-cloud/edh-combat-4.json ("Create a tapped and attacking X/X ... token, where X is ...",
 * "create ... token that's blocking that creature", "Until end of combat, you don't lose this mana as steps end", "As long as C, ~ gets +X/+0, where X is ...", "<player> creates a
 * tapped ... token that's attacking <player>") and the round's reader and renderer changes ("a player attacks", "a player attacks one of your opponents", "defending player" in a
 * static quantity).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to
 * different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic
 * wordings (design 6.10), checked against the local index when it is present. The behavior is in edh-combat-4-scenarios.test.ts. CR cites checked against the
 * Comprehensive Rules of 2026-09-25 (rules/cr/ is not in the cloud checkout; the text was fetched from media.wizards.com).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhCb4 from '../../../src/parser/templates/zz-cloud/edh-combat-4.json';
import review from '../../m5/golden/cards/edh-combat-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhCb4 as Template[];
const MECH_COUNT = 5;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhcb4.token.tappedAttacking.whereX': ['Ghalta and Mavren'],
  'eff.edhcb4.token.blocking': ['Brimaz, King of Oreskos'],
  'rid.edhcb4.mana.keep.endofcombat': ['Avatar Roku, Firebender'],
  'sta.edhcb4.aslong.pump.power.whereX': ['Elturel Survivors'],
  'eff.edhcb4.token.player.tapped.attackingPlayer': ['Combat Calligrapher'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (a sorcery); the others are abilities of a creature. */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text, { mana_cost: '{X}{W}' }), OPTS) : parseCard(card('Example Relic', 'Artifact Creature — Golem', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('edh-combat-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-combat-4.json, path order: after edh-combat-2, before edh-mana-keywords-1) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-combat-4.json');
    expect(files.indexOf('zz-cloud/edh-combat-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-combat-2.json'));
    expect(files.indexOf('zz-cloud/edh-combat-4.json')).toBeLessThan(files.indexOf('zz-cloud/edh-mana-keywords-1.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are sta./eff./rid.edhcb4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep|rid)\.edhcb4\./);
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
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'also']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-combat-4 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-combat-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-combat-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-combat-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-combat-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('edh-combat-4 parser, renderer and engine changes (one test each)', () => {
  const face = (text: string, type = 'Creature — Golem', name = 'Example Relic') => parseCard(card(name, type, text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('parser/holes/event.ts + render/evt.ts (CR 508.1a, 603.2c): "a player attacks" is one declaration of attackers by any player (a batch of at least one attacker, once for the declaration); "a player attacks you" and "a player attacks with creatures" are other things', () => {
    const a = face('Whenever a player attacks, you gain 1 life.');
    expect(fullyAutomated(a)).toBe(true);
    expect(JSON.stringify(a.abilities)).toContain('"ev":"attacks"');
    expect(JSON.stringify(a.abilities)).toContain('"batch":true');
    expect(JSON.stringify(a.abilities)).toContain('"count":{"op":">=","value":1}');
    for (const other of ['Whenever a player attacks you, you gain 1 life.', 'Whenever a player attacks a planeswalker, you gain 1 life.', 'Whenever a player attack, you gain 1 life.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(a.abilities), other).toBe(false);
    }
  });
  it('parser/holes/event.ts + render/evt.ts (CR 508.3e, 603.2c): "a player attacks one of your opponents" is one occurrence for each opponent attacked (not wholeBatch), unlike "one or more of your opponents"', () => {
    const one = face('Whenever a player attacks one of your opponents, that attacking player draws a card.');
    expect(fullyAutomated(one)).toBe(true);
    expect(JSON.stringify(one.abilities)).not.toContain('wholeBatch');
    const many = face('Whenever a player attacks one or more of your opponents, that attacking player draws a card.');
    expect(fullyAutomated(many)).toBe(true);
    expect(JSON.stringify(many.abilities)).toContain('"wholeBatch":true');
    expect(jsonKey(one.abilities)).not.toBe(jsonKey(many.abilities));
    for (const other of ['Whenever a player attacks one of their opponents, that attacking player draws a card.', 'Whenever a player attacks one of your opponents or a planeswalker, that attacking player draws a card.']) {
      const f = face(other);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(one.abilities), other).toBe(false);
    }
  });
  it('parser/lower/scope.ts (CR 508.3e): in that trigger "that opponent" is the opponent attacked, "that player" stays ambiguous (the attacking player may be an opponent too)', () => {
    const opp = face("Whenever a player attacks one of your opponents, that attacking player creates a tapped 1/1 white Spirit creature token that's attacking that opponent.");
    expect(fullyAutomated(opp)).toBe(true);
    expect(JSON.stringify(opp.abilities)).toContain('"attacking":{"defender":{"ref":"event","role":"defender"}}');
    expect(fullyAutomated(face("Whenever a player attacks one of your opponents, that attacking player creates a tapped 1/1 white Spirit creature token that's attacking that player."))).toBe(false);
  });
  it('lower/static-anaphora.ts + statics/match.ts (CR 506.2, 508.5, 107.3): the "it" of "As long as ~ is attacking, it gets +X/+0, where X is the number of lands defending player controls" is the one object named, the counted lands and the defending player are no candidates; a second object named stays manual', () => {
    const f = face('As long as this creature is attacking, it gets +X/+0, where X is the number of lands defending player controls.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).not.toContain('$anaphor');
    expect(fullyAutomated(face('As long as this creature is attacking, it gets +X/+0, where X is the number of lands target player controls.'))).toBe(false);
  });
  it('model/cap-walk.ts + effects/handlers/tokens-create.ts (CR 506.3e): the createToken `blocking` field is the capability feature:createToken.blocking, which the engine runs', () => {
    expect(ENGINE_CAPABILITIES.has('feature:createToken.blocking')).toBe(true);
  });
});
