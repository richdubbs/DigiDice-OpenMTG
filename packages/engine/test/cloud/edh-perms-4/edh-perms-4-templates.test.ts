/**
 * Commander lane edh-perms, round edh-perms-4: the template data of parser/templates/zz-cloud/edh-perms-4.json (Auras that enchant a card in a graveyard: Animate Dead, Dance of the Dead,
 * Necromancy) and the parser, lowering and renderer changes of the round (the holes EnchantGraveyardQuote, EnchantLinkedQuote and EnchantedCard, "if it's on the battlefield", the paragraph
 * split before a second "When ~ leaves the battlefield," trigger, the folds of render/fold-edhpm4.ts). The behavior is in edh-perms-4-scenarios.test.ts.
 * Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local
 * index when it is present. CR cites checked against the Comprehensive Rules of 2026-09-25 (media.wizards.com) except where marked unverified.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhPm4 from '../../../src/parser/templates/zz-cloud/edh-perms-4.json';
import review from '../../m5/golden/cards/edh-perms-4-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = edhPm4 as Template[];
const MECH_COUNT = 7;
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards because Oracle prints the wording on only one to three cards, with
 * their template tests (G9, G2) and played scenarios. Listed in the round's record for the owner (DECIDED BY DEFAULT, owner instruction 2026-10-21).
 */
const NARROW: Readonly<Record<string, readonly string[]>> = {
  'eff.edhpm4.swapEnchant.linked': ['Animate Dead', 'Dance of the Dead'],
  'eff.edhpm4.becomesAura.linked': ['Necromancy'],
  'eff.edhpm4.returnEnchanted.attachSelf': ['Animate Dead'],
  'eff.edhpm4.putEnchanted.tapped.attachSelf': ['Dance of the Dead'],
  'eff.edhpm4.putTarget.fromGraveyard.attachSelf': ['Necromancy'],
  'eff.edhpm4.linked.controllerSacrifices': ['Animate Dead', 'Dance of the Dead', 'Necromancy'],
  'sta.edhpm4.self.flash.offTimingSacrifice': ['Necromancy'],
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind. */
function cardFor(t: Template, text: string): OracleCard {
  const type = /\b(land)\b/.test(text) ? 'land' : 'artifact';
  switch (t.id) {
    case 'eff.edhpm4.swapEnchant.linked':
    case 'eff.edhpm4.returnEnchanted.attachSelf':
    case 'eff.edhpm4.putEnchanted.tapped.attachSelf':
      return card('Example Raise', 'Enchantment — Aura', `Enchant ${type} card in a graveyard\n${text}`);
    case 'eff.edhpm4.linked.controllerSacrifices':
      return /^When this enchantment/.test(text) ? card('Example Raise', 'Enchantment', text) : card('Example Raise', 'Enchantment — Aura', `Enchant artifact card in a graveyard\n${text}`);
    default:
      return card('Example Raise', 'Enchantment', text);
  }
}
const parsedWith = (t: Template, text: string) => parseCard(cardFor(t, text), OPTS).faces[0]!;

describe('edh-perms-4 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-perms-4.json, path order: after edh-perms-2, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-perms-4.json');
    expect(files.indexOf('zz-cloud/edh-perms-4.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-perms-2.json'));
    expect(files.indexOf('zz-cloud/edh-perms-4.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.edhpm4.* or sta.edhpm4.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|sta)\.edhpm4\./);
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

describe('edh-perms-4 guard G9 (design 6.8): examples and counter-examples', () => {
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

describe('edh-perms-4 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
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

describe('edh-perms-4 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('edh-perms-4 design 6.10 (local index): synthetic examples', () => {
  it('no edh-perms-4 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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





describe('edh-perms-4 parser, lowering and renderer changes (one test each)', () => {
  const RAISE_LINE = 'When this Aura enters, if it\'s on the battlefield, it loses "enchant artifact card in a graveyard" and gains "enchant artifact put onto the battlefield with this Aura." Return enchanted artifact card to the battlefield under your control and attach this Aura to it.';
  const aura = (text: string, enchant = 'Enchant artifact card in a graveyard') => parseCard(card('Example Raise', 'Enchantment — Aura', `${enchant}\n${text}`), OPTS).faces[0]!;
  it('cards/pipeline.ts (CR 702.5a, 303.4a): "Enchant <type> card in a graveyard" is automated; any other zone or another description of the card stays manual (fail closed)', () => {
    const level = (enchant: string) => compileCard(card('Example Raise', 'Enchantment — Aura', `${enchant}\nEnchanted artifact gets +1/+1.`)).automation.level;
    expect(level('Enchant artifact card in a graveyard')).toBe('full');
    expect(level('Enchant artifact card in your graveyard')).not.toBe('full'); // an owner is not read
    expect(level('Enchant artifact or creature card in a graveyard')).not.toBe('full'); // one card type only
    expect(level('Enchant artifact card in exile')).not.toBe('full');
    expect(level('Enchant artifact')).toBe('full'); // the unchanged Aura
  });
  it('parser/holes/cond.ts#matches (CR 603.4, 400.7): "if it\'s on the battlefield" is the existence of the object on the battlefield now (an intervening condition on the source), not a question about its last known information; "isn\'t on the battlefield" is not read here', () => {
    const f = aura('When this Aura enters, if it\'s on the battlefield, you gain 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(jsonKey(f.abilities)).toContain('"interveningIf":{"cond":"exists","of":{"ref":"self"}}');
    expect(fullyAutomated(aura('When this Aura enters, if it\'s not on the battlefield, you gain 1 life.'))).toBe(false);
  });
  it('parser/preprocess.ts (CR 603.2, 607.2): a second trigger "When ~ leaves the battlefield," in the paragraph of "When ~ enters, ..." is an ability of its own; a delayed trigger of another wording stays part of the first', () => {
    const f = aura(`${RAISE_LINE} When this Aura leaves the battlefield, that permanent's controller sacrifices it.`);
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities.filter((a) => a.kind === 'triggered')).toHaveLength(2);
    const g = aura('When this Aura enters, you gain 1 life. When this Aura dies, you lose 1 life.');
    expect(g.abilities.filter((a) => a.kind === 'triggered')).toHaveLength(1); // not split: only the "leaves the battlefield" pair of the paragraph is
    const q = aura('When this Aura enters, you gain 1 life. When this Aura leaves the battlefield this turn, you lose 1 life.');
    expect(q.abilities.filter((a) => a.kind === 'triggered')).toHaveLength(1);
  });
  it('parser/holes/edhpm4.ts (CR 702.5a, 607.2a): only an enchant ability of exactly the two forms is a quoted enchant ability; another zone, another object or another word fails closed', () => {
    const swap = (lost: string, gained: string) => fullyAutomated(aura(`When this Aura enters, it loses "${lost}" and gains "${gained}" Return enchanted artifact card to the battlefield under your control and attach this Aura to it.`));
    expect(swap('enchant artifact card in a graveyard', 'enchant artifact put onto the battlefield with this Aura.')).toBe(true);
    expect(swap('enchant artifact card in a graveyard', 'enchant artifact put onto the battlefield with an opponent.')).toBe(false);
    expect(swap('enchant artifact card in a graveyard', 'enchant artifacts put onto the battlefield with this Aura.')).toBe(false);
    expect(swap('enchant artifact card in a graveyard', 'enchant artifact you control.')).toBe(false);
    expect(swap('enchant artifact card in a graveyard', 'flying.')).toBe(false);
    expect(swap('enchant artifact card in exile', 'enchant artifact put onto the battlefield with this Aura.')).toBe(false);
    expect(swap('enchant artifact', 'enchant artifact put onto the battlefield with this Aura.')).toBe(false);
  });
  it('parser/holes/edhpm4.ts#enchantedCard (CR 303.4a): "enchanted <type> card" names the card in a graveyard the Aura is attached to; "enchanted <type>" alone (a permanent) is not this reading', () => {
    const f = aura(RAISE_LINE);
    expect(jsonKey(f.abilities)).toContain('"attachedToSource":true');
    // "enchanted artifact" (a permanent, no card in a graveyard) is read by the general templates, never by this one: no link to what it returned
    expect(jsonKey(aura(RAISE_LINE.replace('enchanted artifact card', 'enchanted artifact')).abilities)).not.toContain('"link":"putWith","op":"move"');
  });
  it('model/schema + statics/mods.ts (CR 613.1f): `removeEnchant` is a layer 6 field of the model, understood by the lint and the capability walk', () => {
    const f = aura(RAISE_LINE);
    expect(jsonKey(f.abilities)).toContain('"removeEnchant":{"isCard":true,"types":["Artifact"],"zone":"graveyard"}');
    expect(compileCard(card('Example Raise', 'Enchantment — Aura', `Enchant artifact card in a graveyard\n${RAISE_LINE}`, { mana_cost: '{1}' })).automation.level).toBe('full');
  });
  it('render/fold-edhpm4.ts, render/kw.ts, render/mods.ts, render/stat.ts (CR 303.4a, 613.1f, 701.21a): the wordings the gate reads back are only those of the cards (a different pair of steps is manual)', () => {
    expect(fullyAutomated(aura(RAISE_LINE.replace('under your control', 'under its owner\'s control')))).toBe(false);
    expect(fullyAutomated(parseCard(card('Example Raise', 'Enchantment', 'When this enchantment enters, if it\'s on the battlefield, it becomes an Aura with "enchant artifact put onto the battlefield with this enchantment." Put target artifact card from a graveyard onto the battlefield under your control and attach this enchantment to it.'), OPTS).faces[0]!)).toBe(true);
    expect(fullyAutomated(parseCard(card('Example Raise', 'Enchantment', 'When this enchantment enters, if it\'s on the battlefield, it becomes an Equipment with "enchant artifact put onto the battlefield with this enchantment." Put target artifact card from a graveyard onto the battlefield under your control and attach this enchantment to it.'), OPTS).faces[0]!)).toBe(false);
  });
});
