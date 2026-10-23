/**
 * Cloud std-woe (the Standard backlog of Wilds of Eldraine, tuning half): the template data of parser/templates/zz-cloud/std-woe.json and the renderer, lowering and
 * engine support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in
 * std-woe-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import stdWoe from '../../../src/parser/templates/zz-cloud/std-woe.json';
import review from '../../m5/golden/cards/cloud-std-woe-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const WOE = stdWoe as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/**
 * Design 6.9 evidence for a stable template: three hand-verified golden cards, or, for a sentence few real cards print, every one of them (the line is how the
 * local index finds them; the test at the end checks the list is the whole corpus).
 */
const WHOLE_CORPUS: Readonly<Record<string, { cards: readonly string[]; line: RegExp }>> = {
  'eff.stdwoe.rider.if.damage.thatpermanent.instead': { cards: ['Stonesplitter Bolt'], line: /If [^,.]+, (it|this spell) deals [^.]*damage to that permanent instead/ },
  'eff.stdwoe.milled.put.hand': { cards: ['Picklock Prankster // Free the Fae'], line: /Mill [a-z]+ cards\. Then put an? [^.]* card from among (them|those cards|the milled cards) into your hand/ },
  'eff.stdwoe.rider.if.instead.damage.that.and': { cards: ['Torch the Tower'], line: /, instead (it|this spell) deals \d+ damage to that (creature|permanent) and / },
  'eff.stdwoe.shield.anyDies.dealtBySelf.exile': { cards: ['Torch the Tower'], line: /If an? [a-z]+ dealt damage by [^.]+ would die this turn, exile it instead/ },
  'sta.stdwoe.aslong.self.is.subtype.basept.abilities': { cards: ['Goddric, Cloaked Reveler'], line: /As long as [^,]+, [^.]* is an? [A-Z][a-z]+ with base power and toughness \d+\/\d+, / },
  'eff.stdwoe.cm.spells.thisTurn.colors.less.whereX': { cards: ['Rowan, Scion of War', 'Will, Scion of Peace'], line: /you cast this turn that are [a-z]+ and\/or [a-z]+ cost \{X\} less to cast, where X is/ },
  'eff.stdwoe.look.putBackUpTo.restGraveyard': { cards: ["Rowan's Grim Search"], line: /put up to \w+ of them back on top of your library in any order and the rest into your graveyard/ },
  'eff.stdwoe.choose.anotherPlayer': { cards: ['Discerning Financier'], line: /Choose another player\./ },
};

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('std-woe template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/std-woe.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/std-woe.json');
    expect(files.indexOf('zz-cloud/std-woe.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/std-woe.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are eff.stdwoe.* or sta.stdwoe.*', () => {
    expect(WOE.length).toBe(14);
    for (const t of WOE) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta)\.stdwoe\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9: a stable template has its evidence: three hand-verified golden cards, or every card of the corpus that prints the sentence', () => {
    const golden = review as { card: string; verified: string; expect?: string }[];
    for (const t of WOE.filter((x) => x.status === 'stable')) {
      const cards = golden.filter((g) => g.verified.includes(`(${t.id})`)).map((g) => g.card);
      const whole = WHOLE_CORPUS[t.id];
      if (whole) expect(cards.slice().sort(), t.id).toEqual([...whole.cards].sort());
      else expect(cards.length, `${t.id}: ${cards.join(', ')}`).toBeGreaterThanOrEqual(3);
    }
    // the review pins its cards as full, except Dream Pillager, whose permission sentence is not understood yet (its exile is, by eff.stdwoe.exile.n.fromTop)
    for (const g of golden) expect(g.expect ?? (g.card === 'Dream Pillager' ? 'pending' : undefined), g.card).toBe(g.card === 'Dream Pillager' ? 'pending' : 'full');
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of WOE) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('std-woe guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of WOE) {
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

/** Near-miss mutations of one example sentence (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '').replace(/\."$/, '"');
  const plain = text.endsWith('"') ? [] : [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const out = [...plain];
  const swaps: [RegExp, string][] = [
    [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\bless\b/, 'more'], [/\bgains\b/, 'loses'], [/\bwould die\b/, 'would leave'],
    [/\bfrom the top\b/, 'from the bottom'], [/\binto your graveyard\b/, 'into your hand'], [/\bwhite\b/, 'colorless'], [/\banother player\b/, 'a player'], [/\bthat permanent\b/, 'that player'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('std-woe guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of WOE) {
    it(`${t.id}: an appended "unless/instead/at random/twice" or a swapped key word never gives the example's JSON`, () => {
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

describe('std-woe guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of WOE) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || /^"?\{/.test(w) || w.includes('\n')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('std-woe renderer and lowering support', () => {
  const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, /Creature/.test(type) ? { power: '3', toughness: '3' } : {}), OPTS).faces[0]!;
  const spell = (text: string) => face('Sorcery', text);
  it('CR 614.15, 608.2c: after "If C, look at the top four cards ... instead", a later "them" is what was looked at either way (both branches bind it)', () => {
    const f = spell('Kicker {1}\nLook at the top two cards of your library. If ~ was kicked, look at the top four cards of your library instead. Put one of them into your hand and the rest on the bottom of your library in a random order.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const step = (f.abilities.find((a) => a.kind === 'spell') as unknown as { effect: { steps: { then: { as?: string }[]; else: { as?: string }[] }[] } }).effect.steps[0]!;
    expect(step.then[0]!.as).toBeDefined();
    expect(step.then[0]!.as).toBe(step.else[0]!.as);
    // no later sentence reads it: the replacing step keeps no name
    expect(JSON.stringify(spell('Draw a card. If you control a Wizard, draw two cards instead.').abilities)).not.toContain('"as"');
  });
  it('CR 608.2c: a later sentence that begins with "Then" is read without the word', () => {
    const f = spell('Draw two cards. Then discard a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"op":"discard"');
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 608.2c: an instruction after a sentence that is not understood keeps its place, and the gate reads ". Then"', () => {
    const f = spell('Exchange your graveyard and your hand. Then shuffle your library.');
    const steps = (f.abilities[0] as unknown as { effect: { steps: { op: string }[] } }).effect.steps;
    expect(steps.map((s) => s.op)).toEqual(['manual', 'shuffle']);
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('CR 508.1k: "if a Rat is attacking" is "there is an attacking Rat"', () => {
    const f = face('Creature — Human', 'Whenever ~ attacks, if a Rat is attacking, ~ gets +2/+0 until end of turn.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"subtypes":["Rat"],"attacking":true');
  });
  it('CR 603.1: a trigger condition that lists colors with commas ("a spell that\'s white, blue, black, or red") ends at the comma whose rest is an effect', () => {
    const f = face('Creature — Druid', 'Whenever you cast a spell that\'s white, blue, black, or red, put a +1/+1 counter on ~.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"colors":["W","U","B","R"]');
  });
  it('CR 120.3: "a source you control deals noncombat damage to an opponent" is a damage event by any source you control, not combat damage', () => {
    const f = face('Enchantment', 'Whenever a source you control deals noncombat damage to an opponent, draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('{"ev":"damage","source":{"controller":"you"},"combat":false,"recipient":{"player":"opponent"}}');
  });
  it('CR 113.6m: "return ~ from your graveyard to your hand" in a trigger makes it work from the graveyard only', () => {
    const f = face('Creature — Elf', 'Whenever an artifact you control enters, return ~ from your graveyard to your hand.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"zone":["graveyard"]');
  });
  it('CR 108.4, 613.1b: a control-changing effect gives control to one player: "each opponent gains control of ..." is refused by the lint', () => {
    const f = face('Creature — Imp', 'When ~ enters, each opponent gains control of ~.');
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.diagnostics)).toContain('one player');
  });
  it('CR 608.2h, 603.10a: "with one or more counters on it dies ... that many" is not the number of objects that died (no automated "that many")', () => {
    const f = face('Creature — Faerie', 'Whenever a creature you control with one or more counters on it dies, draw that many cards.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('CR 115.3, 109.2, 508.1k: in its own attack trigger, "other target attacking creature" after a target Equipment may mean other than this object: manual', () => {
    const f = face('Creature — Hedgehog', 'Whenever ~ attacks, attach up to one target Equipment to it. Then up to one other target attacking creature gets +1/+0 until end of turn.');
    expect(fullyAutomated(f)).toBe(false);
    // elsewhere "other" keeps its reading, other than the earlier targets (Rhino, Terrible Trampler's shape)
    const r = face('Creature — Rhino', 'When ~ enters, destroy target artifact or land. Put a +1/+1 counter on up to one other target creature.');
    expect(fullyAutomated(r), JSON.stringify(r.diagnostics)).toBe(true);
    expect(JSON.stringify(r.abilities)).toContain('"distinctFrom":["t0"]');
    const g = face('Creature — Human', '{T}: ~ deals 1 damage to target creature. Then ~ deals 1 damage to another target creature.');
    expect(fullyAutomated(g), JSON.stringify(g.diagnostics)).toBe(true);
    expect(JSON.stringify(g.abilities)).toContain('"distinctFrom":["t0"]');
  });
  it('CR 702.166b: Stonesplitter Bolt\'s shape lowers to an "if" whose two branches deal damage to the same target', () => {
    const f = parseCard(card('Example Bolt', 'Instant', 'Kicker {2}\n~ deals X damage to target creature or planeswalker. If ~ was kicked, it deals twice X damage to that permanent instead.', { mana_cost: '{X}{R}' }), OPTS).faces[0]!;
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"amount":{"q":"math","op":"*","args":[2,{"q":"X"}]}');
  });
});

const index = localIndex();

describe.skipIf(index === null)('std-woe design 6.10 (local index): synthetic examples, the whole corpus of each sentence, real cards', () => {
  it('no std-woe line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = WOE.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
  it('the cards named as the whole corpus of a sentence are every card of the index that prints it', () => {
    for (const [id, w] of Object.entries(WHOLE_CORPUS)) {
      const found = (index ?? []).filter((c) => [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)].some((x) => typeof x === 'string' && w.line.test(x))).map((c) => c.name);
      expect([...new Set(found)].sort(), id).toEqual([...w.cards].sort());
    }
  }, 120_000);

  // the try step on real cards: each card reads its line with the named template, passes the exact render gate and is fully automated
  const REAL: Readonly<Record<string, readonly string[]>> = {
    'eff.stdwoe.rider.if.damage.thatpermanent.instead': ['Stonesplitter Bolt'],
    'eff.stdwoe.milled.put.hand': ['Picklock Prankster // Free the Fae'],
    'eff.stdwoe.rider.if.instead.damage.that.and': ['Torch the Tower'],
    'eff.stdwoe.shield.anyDies.dealtBySelf.exile': ['Torch the Tower'],
    'sta.stdwoe.aslong.self.is.subtype.basept.abilities': ['Goddric, Cloaked Reveler'],
    'eff.stdwoe.return.choose.battlefield.tapped': ['Blossoming Tortoise', 'Deeproot Wayfinder', 'Port of Karfell', 'Teval, the Balanced Scale'],
    'sta.stdwoe.costmod.activated.abilities.of.less': ['Blossoming Tortoise', "Embalmer's Tools", 'Sam, Loyal Attendant'],
    'eff.stdwoe.cm.spells.thisTurn.colors.less.whereX': ['Rowan, Scion of War', 'Will, Scion of Peace'],
    'eff.stdwoe.exile.n.fromTop': ['Virtue of Courage // Embereth Blaze', 'Thor, Guardian of Midgard'],
    'eff.stdwoe.look.putBackUpTo.restGraveyard': ["Rowan's Grim Search"],
    'eff.stdwoe.choose.anotherPlayer': ['Discerning Financier'],
    'eff.stdwoe.player.gainControl': ['Discerning Financier', 'Donate', 'Harmless Offering', 'Bazaar Trader'],
  };
  for (const [id, names] of Object.entries(REAL)) {
    it(`${id}: ${names.join(', ')} read the line with it, pass the render gate and are fully automated`, () => {
      for (const name of names) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        expect(compileCard(oracle!).automation.level, name).toBe('full');
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
      }
    }, 60_000);
  }
});
