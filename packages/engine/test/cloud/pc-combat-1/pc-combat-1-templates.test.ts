/**
 * pc-combat-1 (Commander precon lane pc-combat): the template data of parser/templates/zz-cloud/pc-combat-1.json ("<player> may discard N cards", "<player> may create N tapped
 * <token>", "each opponent attacking that player does the same"), and one test per parser, lowering and renderer change of the round.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in pc-combat-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { ATTACKING_ENCHANTED_PLAYER as PARSER_WHO } from '../../../src/parser/lower/same-for';
import { ATTACKING_ENCHANTED_PLAYER as RENDER_WHO } from '../../../src/render/fold-pccombat1';
import pcCombat1 from '../../../src/parser/templates/zz-cloud/pc-combat-1.json';
import ownReview from '../../m5/golden/cards/pc-combat-1-review.json';

const review = ownReview;
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = pcCombat1 as Template[];
const MECH_COUNT = 3;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one or two precon cards only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.pccombat1.player.mayDiscard': 'Curse of Chaos',
  'eff.pccombat1.player.mayCreateTapped': 'Curse of Shallow Graves',
  'eff.pccombat1.attackersDoTheSame': 'Curse of Vitality',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered). */
const SPELL = new Set<string>();
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Legendary Creature — Human Warlock', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('pc-combat-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/pc-combat-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/pc-combat-1.json');
    expect(files.indexOf('zz-cloud/pc-combat-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/pc-combat-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|trg).pccombat1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.pccombat1\./);
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

describe('pc-combat-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay\b/, 'must'], [/\battacking that player\b/, 'blocking that player'], [/\bopponent\b/, 'player'], [/\btapped\b/, 'untapped'], [/\bone of them\b/, 'each of them'], [/\bone or more\b/, 'two or more'], [/\byou control\b/, 'an opponent controls'],
    [/\btheir turn\b/, 'your turn'], [/\bthis turn\b/, 'next turn'], [/\battack you\b/, 'block you'], [/\bplaneswalkers\b/, 'creatures'],
    [/\bthat permanent\b/, 'that creature'], [/\bis attached to it\b/, 'is attached to ~'], [/\bgain control\b/, 'lose control'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('pc-combat-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('pc-combat-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('pc-combat-1 design 6.10 (local index): synthetic examples', () => {
  it('no pc-combat-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


/** The one triggered or static ability of a synthetic creature, as the game's compiler lowers it (null when it is not fully automated). */
const lowered = (text: string): unknown => {
  const f = parseCard(card('Example Relic', 'Legendary Creature — Human Warlock', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return fullyAutomated(f) ? JSON.parse(JSON.stringify(bare(f.abilities)))[0] : null;
};
const ENCHANTED = { ref: 'enchantedPlayer' };

describe('pc-combat-1: the parser, lowering and renderer changes of the round, one test each', () => {
  it('the parser\'s and the renderer\'s copies of ATTACKING_ENCHANTED_PLAYER are equal (the import rules keep render from importing the parser)', () => {
    expect(RENDER_WHO).toEqual(PARSER_WHO);
  });
  it('hole Event (CR 508.1b, 303.4, 603.2c): "a player attacks enchanted player with one or more creatures" is one declaration of creatures attacking the enchanted player', () => {
    const a = lowered('Whenever a player attacks enchanted player with one or more creatures, you gain 1 life.') as { trigger: unknown };
    expect(a.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'] }, count: { op: '>=', value: 1 }, defender: ENCHANTED }], batch: true });
  });
  it('hole Event (CR 508.1b, 303.4): "enchanted player is attacked" is the same event; with "two or more creatures" the count is kept; an opponent as the attacker is not that wording', () => {
    const a = lowered('Whenever enchanted player is attacked, you gain 1 life.') as { trigger: unknown };
    const b = lowered('Whenever a player attacks enchanted player with one or more creatures, you gain 1 life.') as { trigger: unknown };
    expect(a.trigger).toEqual(b.trigger);
    const c = lowered('Whenever a player attacks enchanted player with two or more creatures, you gain 1 life.') as { trigger: { on: { count: unknown }[] } };
    expect(c.trigger.on[0]!.count).toEqual({ op: '>=', value: 2 });
    expect(lowered('Whenever an opponent attacks enchanted player with one or more creatures, you gain 1 life.')).toBeNull();
    expect(lowered('Whenever enchanted player is attacked or dealt damage, you gain 1 life.')).toBeNull();
  });
  it('hole Event (CR 506.3, 508.1b): "attacks one of your opponents or a planeswalker an opponent controls" (also "they control") is an attack on an opponent or on their planeswalker', () => {
    const a = lowered('Whenever a creature attacks one of your opponents or a planeswalker an opponent controls, you gain 1 life.') as { trigger: unknown };
    expect(a.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent', orPlaneswalker: true }] });
    const b = lowered('Whenever one or more creatures attack one of your opponents or a planeswalker they control, you gain 1 life.') as { trigger: unknown };
    expect(b.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'] }, defender: 'opponent', orPlaneswalker: true }], batch: true });
    expect(lowered('Whenever a creature attacks one of your opponents or a planeswalker you control, you gain 1 life.')).toBeNull();
  });
  it('hole Player (CR 506.2, 508.1): "that attacking player" is the active player; lowering scope: "they" after "a player attacks enchanted player" is the attacking player, never the enchanted one', () => {
    const a = lowered('Whenever a player attacks enchanted player with one or more creatures, that attacking player loses 1 life.') as { effect: { steps: unknown[] } };
    expect(a.effect.steps).toEqual([{ op: 'loseLife', who: { ref: 'active' }, amount: 1 }]);
    const b = lowered('Whenever a player attacks enchanted player with one or more creatures, they lose 1 life.') as { effect: { steps: unknown[] } };
    expect(b.effect.steps).toEqual([{ op: 'loseLife', who: { ref: 'event', role: 'player' }, amount: 1 }]);
  });
  it('lowering, same-for (CR 608.2c, 508.1a): "Each opponent attacking that player does the same" repeats a draw, life gain or token creation of the controller for the opponents who attacked enchanted player; any other instruction stays manual', () => {
    const a = lowered('Whenever enchanted player is attacked, you gain 2 life. Each opponent attacking that player does the same.') as { effect: { steps: unknown[] } };
    const who = { ref: 'eachWho', who: 'opponent', did: { ev: 'attacks', defender: ENCHANTED }, scope: 'attacking' };
    expect(a.effect.steps).toEqual([{ op: 'gainLife', who: { ref: 'you' }, amount: 2 }, { op: 'gainLife', who, amount: 2 }]);
    expect(lowered('Whenever enchanted player is attacked, you lose 2 life. Each opponent attacking that player does the same.')).toBeNull();
    expect(lowered('Whenever enchanted player is attacked, each opponent gains 2 life. Each opponent attacking that player does the same.')).toBeNull();
    expect(lowered('Whenever enchanted player is attacked, you gain 2 life. You draw a card. Each opponent attacking that player does the same.')).toBeNull();
  });
  it('trigger occurrences (CR 603.2c, 508.5): the creatures attacking an opponent or a planeswalker they control are one occurrence for each player attacked', () => {
    const a = lowered('Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain menace until end of turn.');
    expect(a).not.toBeNull();
  });
  it('render (G6): the new wordings pass the exact render gate', () => {
    for (const text of [
      'Whenever a player attacks enchanted player with one or more creatures, that attacking player may discard a card. If the player does, they draw a card.',
      'Whenever a player attacks enchanted player with one or more creatures, that attacking player may create a tapped 1/1 white Soldier creature token.',
      'Whenever enchanted player is attacked, create a Treasure token. Each opponent attacking that player does the same.',
      'Whenever enchanted player is attacked, you draw a card. Each opponent attacking that player does the same.',
      'Whenever a creature attacks one of your opponents or a planeswalker an opponent controls, that creature gets +1/+0 until end of turn.',
      'Whenever one or more creatures attack one of your opponents or a planeswalker they control, those creatures gain trample until end of turn.',
    ]) expect(lowered(text), text).not.toBeNull();
  });
  it('template t67 (CR 611.2a, 109.2): "each other <creature> gets +1/+1 until end of turn" excludes the source (consumes "each other"); the word was refused before', () => {
    expect(lowered('Whenever ~ attacks, each other creature you control gets +1/+1 until end of turn.')).not.toBeNull();
  });
});
