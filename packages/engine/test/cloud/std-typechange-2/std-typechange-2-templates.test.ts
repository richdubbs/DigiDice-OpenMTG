/**
 * std-typechange-2 (lane std-typechange: type and ability changes): the template data of parser/templates/zz-cloud/std-typechange-2.json (a planeswalker's "During
 * your turn, as long as <condition>, ~ is a N/N <subtype> creature and has <abilities>", the rider "If that card is a <type> card, it enters tapped and attacking",
 * and "If a <creature> dying causes a triggered ability of ~ or an emblem you own to trigger, that ability triggers an additional time"), and the round's parser,
 * lowering and renderer changes (the moved ~ of an earlier instruction of the same list, "the exiled card" of ~ exiled, "If you can't" after turning ~ face up).
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or
 * parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples
 * are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in std-typechange-2-scenarios.test.ts. CR cites from
 * memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdTc2 from '../../../src/parser/templates/zz-cloud/std-typechange-2.json';
import ownReview from '../../m5/golden/cards/std-typechange-2-review.json';
import r4costReview from '../../m5/golden/cards/cloud-r4-cost-review.json';
import r3staticReview from '../../m5/golden/cards/cloud-r3-static-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = stdTc2 as Template[];
const MECH_COUNT = 3;
/** The golden cards of the round: its own review file, and the entries it updated or added in the review files of the cards' earlier rounds (guide section 6). */
const review = [...ownReview, ...r4costReview, ...r3staticReview] as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on one card only, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner.
 */
const NARROW: Readonly<Record<string, string>> = {
  'sta.stdtc2.duringTurn.aslong.self.is.sized.creature.has': 'Kaito, Bane of Nightmares',
  'rid.stdtc2.ifCardIs.entersTappedAttacking': "Summoner's Grimoire",
  'sta.stdtc2.triggerMod.dying.selfOrEmblem': 'The Masamune',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a planeswalker's static, a creature's trigger, an Equipment's or Aura's grant. */
const parsedWith = (t: Template, text: string) => {
  if (t.id.startsWith('sta.stdtc2.duringTurn')) return parseCard(card('Example Walker', 'Legendary Planeswalker — Examplewalker', `${text}\n+1: You gain 1 life.`, { loyalty: '3' }), OPTS).faces[0]!;
  if (t.id.startsWith('rid.')) return parseCard(card('Example Caller', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return parseCard(card('Example Charm', /^Enchanted/.test(text) ? 'Enchantment — Aura' : 'Artifact — Equipment', /^Enchanted/.test(text) ? `Enchant creature\n${text}` : `${text}\nEquip {1}`), OPTS).faces[0]!;
};

describe('std-typechange-2 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-typechange-2.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-typechange-2.json');
    expect(files.indexOf('zz-cloud/std-typechange-2.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-typechange-2.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (sta|rid).stdtc2.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(sta|rid)\.stdtc2\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    const golden = review;
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id}`) || g.verified.includes(` ${t.id}`) || g.verified.includes(`${t.id},`)).map((g) => g.card);
      if (NARROW[t.id] !== undefined) expect(cards, t.id).toContain(NARROW[t.id]);
      else expect(cards.length, t.id).toBeGreaterThanOrEqual(3);
    }
    for (const g of ownReview as { card: string; expect?: string }[]) expect(g.expect, g.card).toBe('full');
    for (const c of Object.values(NARROW)) expect(golden.find((g) => g.card === c)?.expect, c).toBe('full');
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

describe('std-typechange-2 guard G9 (design 6.8): examples and counter-examples', () => {
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
    [/\bmay\b/, 'must'], [/\bremains tapped\b/, 'remains untapped'], [/\bcharge counter\b/, 'charge counters'], [/\bfirst\b/, 'second'], [/\bless\b/, 'more'],
    [/\bhexproof\b/, 'shroud'], [/\bdon't trigger\b/, 'trigger'], [/\bpower\b/, 'toughness'], [/\battack as though\b/, 'block as though'],
    [/\bactivated abilities of all\b/, 'triggered abilities of all'], [/\bany color\b/, 'any type'], [/\byou control\b/, 'an opponent controls'],
    [/\bany number of\b/, 'all'], [/\bin addition to\b/, 'instead of'], [/\blose control\b/, 'gain control'],
    [/\bface down\b/, 'face up'], [/\bturned face up\b/, 'turned face down'], [/\bloses all abilities\b/, 'loses flying'], [/\bartifact creature\b/, 'enchantment creature'],
    [/\bcreature spells you control\b/, 'creature spells you own'], [/\bcreature cards you own\b/, 'creature cards you control'], [/\baren't on the battlefield\b/, 'are on the battlefield'],
    [/\bnamed\b/, 'called'], [/\bis tapped\b/, 'is untapped'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-typechange-2 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('std-typechange-2 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('std-typechange-2 design 6.10 (local index): synthetic examples', () => {
  it('no std-typechange-2 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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


const json = (v: unknown): string => JSON.stringify(v);
const creature = (text: string) => parseCard(card('Example Lurker', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;

describe('std-typechange-2 conditions pass (CR 608.2c, 708.7): "If you can\'t" after "Turn ~ face up"', () => {
  it('reads whether the face-up of the object itself happened', () => {
    const f = creature("{2}: Turn this creature face up. If you can't, you gain 3 life.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"op":"changeFace","what":{"ref":"self"},"to":"faceUp","as":"did"}');
    expect(json(f.abilities)).toContain('"cond":{"cond":"did","step":"did","not":true}');
  });
  it('a face-up of a target is not read ("If you can\'t" stays manual there)', () => {
    const f = creature("{2}: Turn target face-down creature face up. If you can't, you gain 3 life.");
    expect(fullyAutomated(f)).toBe(false);
  });
});

describe('std-typechange-2 lowering (CR 400.7, 608.2c): ~ moved by an earlier instruction of the same list is "the exiled card"', () => {
  it('"Exile ~, then you may cast the exiled card without paying its mana cost" casts the card ~ became', () => {
    const f = creature('{2}: Exile this creature, then you may cast the exiled card without paying its mana cost.');
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('{"op":"cast","who":{"ref":"you"},"what":{"ref":"bound","name":"moved"},"free":true,"optional":true}');
  });
  it('inside an "if" branch too, and "that creature" is still never ~ before it moved', () => {
    const f = creature("{2}: Turn this creature face up. If you can't, exile it, then you may cast the exiled card without paying its mana cost.");
    expect(fullyAutomated(f)).toBe(true);
    const g = creature('{2}: You may cast that creature without paying its mana cost.');
    expect(fullyAutomated(g)).toBe(false);
  });
});

describe('std-typechange-2 renderer (render/fold.ts#chooseThenMove): the status rider is said only for a description by card types', () => {
  it('"If that card is a green card, ..." (a color, not a card type) is not automated', () => {
    const f = creature('Whenever this creature attacks, you may put a creature card from your hand onto the battlefield. If that card is a green card, it enters tapped and attacking.');
    expect(fullyAutomated(f)).toBe(false);
  });
});
