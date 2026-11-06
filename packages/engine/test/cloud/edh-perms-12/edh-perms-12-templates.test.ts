/**
 * Commander lane edh-perms, round edh-perms-12: the template data of parser/templates/zz-cloud/edh-perms-12.json ("you put a -1/-1 counter on up to one target creature they control"; "As ~
 * enters, you may reveal a Dragon card from your hand. ~ enters tapped unless you revealed a Dragon card this way or you control a Dragon"; "Equipped creature has menace and mobilize X, where X is
 * its power"; "Choose up to two creatures, then destroy the rest"; "starting with you, each player may choose an artifact or enchantment you don't control"; "return another permanent card from your
 * graveyard to the battlefield"). The hole, lowering and renderer changes (the sentences after a delayed return name the card it returned, "it entered under your control", "Sacrifice ~ and a
 * legendary artifact", "each permanent chosen this way", the keyword amount "its power") are tested at the end of this file and in edh-perms-12-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. The behavior is in edh-perms-12-scenarios.test.ts. CR cites from memory (no rules/cr in a cloud session).
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm12 from '../../../src/parser/templates/zz-cloud/edh-perms-12.json';
import review from '../../m5/golden/cards/edh-perms-12-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm12 as Template[];
const MECH_COUNT = 6;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the
 * wording on only one or two cards, with their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT,
 * owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  // the cards of the EDHREC top 5,000 that print each wording and are full (held-out ones opened by the owner, commander request 2026-10-27)
  'eff.edhpm12.counters.put.you': ['Persistent Constrictor'],
  'rep.edhpm12.enters.tappedUnlessRevealOr': ['Temple of the Dragon Queen'],
  'sta.edhpm12.attached.has.keywordAndMobilizeXPower': ['Infantry Shield'],
  'eff.edhpm12.chooseUpTo.destroyRest': ['Mount Doom'],
  'eff.edhpm12.startingWithYou.eachPlayerMayChoose': ['Druid of Purification'],
  'eff.edhpm12.return.another.battlefield': ['Rise of the Witch-king'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a land for an "As ~ enters", an Equipment or an Aura for a static, a creature, an enchantment or a spell otherwise. */
const parsedWith = (t: Template, text: string) => {
  if (/^As ~ enters/.test(text)) return parseCard(card('Example Land', 'Land', text), OPTS).faces[0]!;
  if (/^Enchanted\b/.test(text)) return parseCard(card('Example Aura', 'Enchantment — Aura', text), OPTS).faces[0]!;
  if (t.id.startsWith('sta.')) return parseCard(card('Example Relic', 'Artifact — Equipment', text, { mana_cost: '{3}' }), OPTS).faces[0]!;
  if (/^(Whenever this creature|When ~ enters)/.test(text)) return parseCard(card('Example Soldier', 'Creature — Soldier', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  if (/^(At the beginning|Whenever)/.test(text)) return parseCard(card('Example Relic', 'Enchantment', text), OPTS).faces[0]!;
  if (/^\{/.test(text)) return parseCard(card('Example Gate', 'Creature — Wizard', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  return parseCard(card('Example Plan', 'Instant', text), OPTS).faces[0]!;
};

describe('edh-perms-12 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-12.json, path order: after edh-perms-1, before edh-perms-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-12.json');
    expect(files.indexOf('zz-cloud/edh-perms-12.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-1.json'));
    expect(files.indexOf('zz-cloud/edh-perms-12.json')).toBeLessThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm12.* (or rep., sta.)', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta|rep)\.edhpm12\./);
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

describe('edh-perms-12 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-perms-12 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-12 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-12 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-12 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.replace(/\s*\([^)]*\)/g, '').trim());
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});






describe('edh-perms-12 parser, lowering and renderer changes (one test each)', () => {
  const one = (text: string, type = 'Creature — Spirit') => parseCard(card('Example Relic', type, text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  const SHEPHERD = "Whenever this creature attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on this creature.";
  it('parser/lower/delay-tail.ts + lower/anaphora.ts + holes/cond.ts + render/cond.ts (CR 603.7c, 400.7, 608.2c): the sentences after a delayed return join the delayed trigger and name the card it returned (the binding its move re-bases, never the exiled target handle); "it entered under your control" is the controller test of that card', () => {
    const ok = one(SHEPHERD);
    expect(fullyAutomated(ok)).toBe(true);
    const json = JSON.stringify(ok.abilities);
    expect(json).toContain('"cond":"matches","object":{"ref":"bound","name":"moved"},"filter":{"controller":"you"}');
    expect(json).not.toMatch(/"do":\[[^\]]*"ref":"target"/); // nothing inside the delayed trigger reads the target handle
    expect(fullyAutomated(one(SHEPHERD.replace('under your control', 'under an opponent\'s control')))).toBe(false); // only the "you" wording is read
    expect(fullyAutomated(one(SHEPHERD.replace('At the beginning of the next end step, return that card', 'Return that card')))).toBe(false); // no delay: the card is not back yet when the sentence runs
    // another event that leaves the object itself where it is: the bare "it" after a target is the target, as for an enters trigger (Mention.selfObject)
    expect(fullyAutomated(one('Whenever this creature attacks, tap target creature an opponent controls. Put a +1/+1 counter on it if it\'s a Goblin.'))).toBe(true);
  });
  it('parser/holes/cost.ts + render/costs.ts (CR 701.21a, 118.3, 602.2b): "Sacrifice ~ and a legendary artifact" is the object itself and one other permanent, two parts; "another", two others and "or" are not read this way', () => {
    const land = (t: string) => parseCard(card('Example Land', 'Legendary Land', t), OPTS).faces[0]!;
    const ok = land('{T}, Sacrifice ~ and a legendary artifact: Add {C}{C}.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"filter":{"self":true},"count":1,"self":true},{"kind":"sacrifice","filter":{"supertypes":["Legendary"],"types":["Artifact"]},"count":1}');
    expect(fullyAutomated(land('{T}, Sacrifice ~ and another artifact: Add {C}{C}.'))).toBe(true); // edh-next-90 (changed on purpose, Magus of the Order): one OTHER permanent is read (`other: true`); several others are not
    expect(fullyAutomated(land('{T}, Sacrifice ~ and two artifacts: Add {C}{C}.'))).toBe(true); // edh-perms-18: a fixed count of the second part is read too (Glass-Cast Heart); any number of them is not
    expect(fullyAutomated(land('{T}, Sacrifice ~ and any number of artifacts: Add {C}{C}.'))).toBe(false);
    expect(fullyAutomated(land('{T}, Sacrifice ~ or a legendary artifact: Add {C}{C}.'))).toBe(false);
  });
  it('parser/holes/object.ts + render/steps-flow.ts (CR 608.2c, 101.4): "each permanent chosen this way" is the group an earlier choice of each player chose, and only after such a choice', () => {
    const ok = one("When this creature enters, starting with you, each player may choose an artifact or enchantment you don't control. Destroy each permanent chosen this way.");
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(one('When this creature enters, destroy each permanent chosen this way.'))).toBe(false); // nothing was chosen
    expect(fullyAutomated(one("When this creature enters, starting with you, each player may choose an artifact or enchantment you don't control. Destroy each creature chosen this way."))).toBe(false); // a creature was not offered
  });
  it('render/stat.ts + effects/bodies/m5.ts (CR 614.1c, 614.12, 701.20a): the payment and the condition of an enters replacement together say "unless you revealed ... this way or ..."; a payment other than revealing is not said so', () => {
    const land = (t: string) => parseCard(card('Example Land', 'Land', t), OPTS).faces[0]!;
    const ok = land('As ~ enters, you may reveal a Wizard card from your hand. ~ enters tapped unless you revealed a Wizard card this way or you control a Wizard.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"tappedUnlessPay"');
    expect(JSON.stringify(ok.abilities)).toContain('"tappedUnless"');
    expect(fullyAutomated(land('As ~ enters, you may reveal an Elf card from your hand. ~ enters tapped unless you revealed a Wizard card this way or you control a Wizard.'))).toBe(false); // the card revealed is the card said
    expect(fullyAutomated(land('As ~ enters, you may pay 2 life. ~ enters tapped unless you revealed a Wizard card this way or you control a Wizard.'))).toBe(false);
  });
  it('render/kw.ts (CR 107.3, 208.1): a keyword whose amount is the power of the creature that has it is "mobilize X, where X is its power"; its toughness and any other amount are other wordings', () => {
    const eq = (t: string) => parseCard(card('Example Relic', 'Artifact — Equipment', t, { mana_cost: '{3}' }), OPTS).faces[0]!;
    expect(fullyAutomated(eq('Equipped creature has menace and mobilize X, where X is its power.'))).toBe(true);
    expect(fullyAutomated(eq('Equipped creature has menace and mobilize X, where X is its toughness.'))).toBe(false);
    expect(fullyAutomated(eq('Equipped creature has menace and mobilize X, where X is the number of creatures you control.'))).toBe(false);
  });
  it('render/steps-life.ts (family and-you-plain-clause): "they lose 1 life and you put a counter" joins the two clauses; two separate sentences are the same program', () => {
    const ok = one("At the beginning of each opponent's upkeep, they lose 1 life and you put a -1/-1 counter on up to one target creature they control.", 'Enchantment');
    expect(fullyAutomated(ok)).toBe(true);
    expect(fullyAutomated(one("At the beginning of each opponent's upkeep, each opponent puts a -1/-1 counter on up to one target creature they control.", 'Enchantment'))).toBe(false); // another player puts them
  });
  it('render/fold-stdlibrary2.ts (CR 608.2c, 109.2, 701.21a): "another" after "if you sacrificed a creature this way" is also read for a return to the battlefield; only the card you sacrificed is left out', () => {
    const spell = (t: string) => parseCard(card('Example Plan', 'Sorcery', t), OPTS).faces[0]!;
    const body = 'Each player sacrifices a creature of their choice. If you sacrificed a creature this way, you may return another permanent card from your graveyard to the battlefield.';
    expect(fullyAutomated(spell(body))).toBe(true);
    expect(fullyAutomated(spell(body.replace('If you sacrificed', 'If an opponent sacrificed')))).toBe(false);
    expect(fullyAutomated(spell(body.replace('to the battlefield', 'to the battlefield tapped')))).toBe(false);
  });
});
