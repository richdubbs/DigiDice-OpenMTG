/**
 * std-combat-1 (lane std-combat): the template data of parser/templates/zz-cloud/std-combat-1.json ("attach one of them to a <filter>", the trigger "<event> during their
 * turn", "<player> can't attack you or planeswalkers you control <dur>", "gain control of that permanent for as long as that Aura is attached to it"), and one test per
 * parser, lowering and renderer change of the round.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-combat-1-scenarios.test.ts. CR cites from memory,
 * unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdCombat1 from '../../../src/parser/templates/zz-cloud/std-combat-1.json';
import ownReview from '../../m5/golden/cards/std-combat-1-review.json';
import c6Review from '../../m5/golden/cards/cloud-c6-review.json';

/** The round's golden cards: its own file, and the entry of a card an earlier round pinned (CLOUD C6's Unstable Glyphbridge, updated in place: guide section 6). */
const review = [...ownReview, ...(c6Review as { card: string }[]).filter((g) => g.card === 'Unstable Glyphbridge // Sandswirl Wanderglyph')];
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdCombat1 as Template[];
const MECH_COUNT = 4;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.stdcombat1.attachOneOfThem.toA': 'Gilgamesh, Master-at-Arms',
  'trg.stdcombat1.when.duringTheirTurn': 'Unstable Glyphbridge // Sandswirl Wanderglyph',
  'eff.stdcombat1.player.cantAttackYouOrWalkers.dur': 'Unstable Glyphbridge // Sandswirl Wanderglyph',
  'eff.stdcombat1.gainControl.whileAuraAttached': 'Eriette, the Beguiler',
}
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** Templates whose examples are spell text (an instant); the others are abilities of a creature (static, activated, triggered; "~ gains" needs a creature). */
const SPELL = new Set<string>(['eff.stdcombat1.player.cantAttackYouOrWalkers.dur']);
/** A synthetic card in which an example is an ability of the right kind. */
const parsedWith = (t: Template, text: string) =>
  (SPELL.has(t.id) ? parseCard(card('Example Plan', 'Sorcery', text), OPTS) : parseCard(card('Example Relic', 'Legendary Creature — Human Warlock', text, { power: '2', toughness: '2' }), OPTS)).faces[0]!;

describe('std-combat-1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-combat-1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-combat-1.json');
    expect(files.indexOf('zz-cloud/std-combat-1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-combat-1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|trg).stdcombat1.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|trg)\.stdcombat1\./);
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

describe('std-combat-1 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay\b/, 'must'], [/\bone of them\b/, 'each of them'], [/\bone or more\b/, 'two or more'], [/\byou control\b/, 'an opponent controls'],
    [/\btheir turn\b/, 'your turn'], [/\bthis turn\b/, 'next turn'], [/\battack you\b/, 'block you'], [/\bplaneswalkers\b/, 'creatures'],
    [/\bthat permanent\b/, 'that creature'], [/\bis attached to it\b/, 'is attached to ~'], [/\bgain control\b/, 'lose control'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-combat-1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-combat-1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-combat-1 design 6.10 (local index): synthetic examples', () => {
  it('no std-combat-1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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

describe('std-combat-1: the parser, lowering and renderer changes of the round, one test each', () => {
  it('hole Event (CR 508.1a, 603.2c): "whenever an opponent attacks with creatures" is one declaration by an opponent with one or more creatures', () => {
    const a = lowered('Whenever an opponent attacks with creatures, you gain 1 life.') as { trigger: unknown };
    expect(a.trigger).toEqual({ on: [{ ev: 'attacks', attacker: { types: ['Creature'], controller: 'opponent' }, count: { op: '>=', value: 1 } }], batch: true });
  });
  it('lowering, scope (CR 508.5, 608.2c): after "an opponent attacks with creatures", "they" is the attacking opponent, never the defending player', () => {
    const a = lowered('Whenever an opponent attacks with creatures, they lose 1 life.') as { effect: { steps: unknown[] } };
    expect(a.effect.steps).toEqual([{ op: 'loseLife', who: { ref: 'event', role: 'player' }, amount: 1 }]);
  });
  it('hole Cond (CR 603.4, 508.5): "two or more of those creatures are attacking you and/or planeswalkers you control" counts the attackers at you or your planeswalkers', () => {
    const a = lowered('Whenever an opponent attacks with creatures, if three or more of those creatures are attacking you and/or planeswalkers you control, you gain 1 life.') as { interveningIf: unknown };
    expect(a.interveningIf).toEqual({ cond: 'compare', left: { q: 'count', of: { ref: 'each', filter: { is: { ref: 'event', role: 'attacker' }, attacking: { defender: 'you', orPlaneswalker: true } } } }, op: '>=', right: 3 });
  });
  it('hole Player (CR 608.2c, 508.1b): "each opponent who attacked you or a planeswalker you control this turn" is the player reference eachWho', () => {
    const a = lowered('Each opponent who attacked you or a planeswalker you control this turn can\'t activate abilities.') ?? lowered('Each opponent who attacked you or a planeswalker you control this turn can\'t cast creature spells.');
    expect(JSON.stringify(a)).toContain(JSON.stringify({ ref: 'eachWho', who: 'opponent', did: { ev: 'attacks', defender: 'you', orPlaneswalker: true }, scope: 'turn' }));
  });
  it('lowering, anaphora (CR 603.12, 608.2c, 400.7): "them" after "When you put one or more Equipment onto the battlefield this way" is the Equipment the move put there', () => {
    const a = lowered('When ~ enters, look at the top three cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest into your graveyard. When you put one or more Equipment onto the battlefield this way, attach one of them to a Warlock you control.');
    expect(JSON.stringify(a)).toContain(JSON.stringify({ ref: 'each', filter: { is: { ref: 'bound', name: 'chosen' } } }));
  });
  it('lowering, trigger (CR 603.2, 202.3): in an attach trigger, "that Aura\'s mana value" in the permanent\'s description is the attached Aura\'s (the event\'s subject)', () => {
    const a = lowered('Whenever an Aura you control becomes attached to a creature an opponent controls with mana value less than or equal to that Aura\'s mana value, you gain 1 life.') as { trigger: { on: { by: unknown }[] } };
    expect(a.trigger.on[0]!.by).toEqual({ types: ['Creature'], controller: 'opponent', manaValue: { op: '<=', value: { q: 'stat', stat: 'manaValue', of: { ref: 'event', role: 'subject' } } } });
  });
  it('render (G6): the four new wordings pass the exact render gate', () => {
    for (const text of [
      'Whenever an opponent attacks with creatures, if two or more of those creatures are attacking you and/or planeswalkers you control, that opponent loses 1 life.',
      'Whenever an opponent draws a card during their turn, they can\'t attack you or planeswalkers you control this turn.',
      'Whenever an Aura you control becomes attached to an artifact an opponent controls with mana value less than or equal to that Aura\'s mana value, gain control of that permanent for as long as that Aura is attached to it.',
      'When ~ enters, look at the top three cards of your library. You may put any number of Equipment cards from among them onto the battlefield. Put the rest into your graveyard. When you put one or more Equipment onto the battlefield this way, attach one of them to a Warlock you control.',
    ]) expect(lowered(text), text).not.toBeNull();
  });
});
