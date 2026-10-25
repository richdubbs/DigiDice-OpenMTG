/**
 * trek-7 (lane trek, Star Trek, part 2): the template data of parser/templates/zz-cloud/trek-7.json ("You may cast this card from exile", "{Dur}, its owner may
 * play it", "A spell cast this way costs {N} more to cast", "They put the rest on the bottom in a random order", Scotty's "During your main phase, each <cards> has
 * beam me up. The beam me up cost is equal to that spell's mana cost. ~ can't be beamed up to cast a spell this way."), and the round's keyword, parser and renderer
 * changes (the optional `filter` of beam me up, granted only; the quantities "the number of opponents you attacked this turn" and "dilemmas you've faced this
 * turn"; "the rest" of the cards an exile-until step exiled; the computed mana-value limit of the free casts written out). Guard G9 (design 6.8): every example
 * lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss
 * mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10),
 * checked against the local index when it is present. The behavior is in trek-7-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud
 * checkout); beam me up, assimilate and "face a dilemma" have no rule number in the 2026-09-25 edition (their reminder text is their rule source).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { compileCard } from '../../../src/index';
import { keywordRegistry } from '../../../src/keywords/registry';
import trek7 from '../../../src/parser/templates/zz-cloud/trek-7.json';
import ownReview from '../../m5/golden/cards/trek-7-review.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = trek7 as Template[];
const MECH_COUNT = 7;
const review = ownReview as { card: string; verified: string; expect?: string }[];
/**
 * design 6.9 deviation (docs/CARD_AUTOMATION.md section 5, "Narrow wordings"): templates made stable on fewer than three golden cards, accepted by the owner for the Star Trek
 * set (2026-10-24), with their template tests (G9, G2) and played scenarios (trek-7-scenarios.test.ts). Each rests on ONE Star Trek golden card, the only one that can be
 * evidence; some wordings are also printed on other cards, all of them held-out (docs/CARD_AUTOMATION.md section 4: never a golden card, never tuned toward): "You may cast this
 * card from exile." on Eternal Scourge and Misthollow Griffin; "its owner may play it" with "A spell cast this way costs {2} more to cast" on Elite Spellbinder and Invasion of
 * Gobakhan (the first half alone also on Divine Purge, Extraordinary Journey, Soul Partition, Suspend Aggression and Prowl, Stoic Strategist). The mana-value limit in words
 * and Scotty's three sentences are printed on one card each. sta.trek7.duringMain.each.beamMeUp.manaCost (the first two sentences of Scotty's line, no card prints them
 * alone) has no card and stays experimental.
 */
const NARROW: Readonly<Record<string, string>> = {
  'eff.trek7.self.castFromExile': 'Khan, Vengeful Heart',
  'eff.trek7.ownerMayPlay.dur': 'Zero, Incorporeal Sensate',
  'rid.trek7.spellCastThisWay.costsMore': 'Zero, Incorporeal Sensate',
  'eff.trek7.they.putRest.bottomRandom': 'The Borg Queen',
  'eff.trek7.cast.anyNumber.free.mvLte.fromAmong': 'Captain Benjamin Sisko',
  'sta.trek7.duringMain.each.beamMeUp.manaCost.selfCantBeamedUp': 'Scotty, Miracle Worker',
};
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a creature's static or trigger, a sorcery. */
const parsedWith = (_t: Template, text: string) => {
  if (/^(During |You may cast this )/.test(text)) return parseCard(card('Example Chief', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  if (/^(\{|When )/.test(text)) return parseCard(card('Example Lurker', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  return parseCard(card('Example Order', 'Sorcery', text), OPTS).faces[0]!;
};

describe('trek-7 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-7.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-7.json');
    expect(files.indexOf('zz-cloud/trek-7.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/trek-7.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (eff|rid|sta).trek7.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(eff|rid|sta)\.trek7\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
    expect(MECH.find((t) => t.id === 'sta.trek7.duringMain.each.beamMeUp.manaCost')?.status).toBe('experimental'); // no card prints it alone
  });
  it('design 6.9: a stable template has its evidence: three or more hand-verified golden cards, or (a recorded deviation) the one card that prints the wording', () => {
    for (const t of MECH.filter((x) => x.status === 'stable')) {
      const cards = review.filter((g) => new RegExp(`[( ]${t.id.replaceAll('.', '\\.')}[,)]`).test(g.verified)).map((g) => g.card);
      expect(NARROW[t.id], `${t.id}: a stable template needs a NARROW entry or three golden cards`).toBeDefined();
      expect(cards, t.id).toContain(NARROW[t.id]);
    }
    for (const g of review) expect(g.expect, g.card).toBe('full');
    for (const g of review) expect(g.verified, g.card).toMatch(/CR \d{3}/);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'equal']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-7 guard G9 (design 6.8): examples and counter-examples', () => {
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\bcast\b/, 'play'], [/\bplay\b/, 'cast'], [/\bfrom exile\b/, 'from your graveyard'], [/\bowner\b/, 'controller'], [/\bmore\b/, 'less'], [/\bbottom\b/, 'top'],
    [/\brandom\b/, 'any'], [/\bbeam me up\b/, 'flashback'], [/\bmain phase\b/, 'end step'], [/\bcan't\b/, 'can'], [/\bmana cost\b/, 'mana value'], [/\bthis way\b/, 'that way'],
    [/\bremains exiled\b/, 'remains tapped'], [/\beach\b/, 'one'], [/\bcreature card\b/, 'creature'], [/\bthey put\b/, 'you put'], [/\bwhile\b/, 'until'], [/\bdraw\b/, 'discard'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-7 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able/this turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('trek-7 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
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

describe.skipIf(index === null)('trek-7 design 6.10 (local index): synthetic examples', () => {
  it('no trek-7 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
const SPELL_TEXT = 'You gain 3 life.\nBeam me up {3}{U} (You may cast this card from your graveyard for {3}{U} if you also return a creature you control to its owner\'s hand. Then exile this spell.)';

describe('trek-7 keyword: Beam me up granted by a static ability (Star Trek reminder text; CR 702 number unverified), a keyword newer than the CR edition', () => {
  it('the optional `filter` of the keyword is for a grant only: a printed "Beam me up {cost}" line has none and still expands to "a creature you control"', () => {
    const f = parseCard(card('Example Transport', 'Sorcery', SPELL_TEXT), OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(true);
    const kw = f.abilities.find((a) => a.kind === 'keyword')! as never;
    expect(json(kw)).not.toContain('"filter"');
    const [st] = keywordRegistry.expand(kw, { granted: false, faceName: 'Example Transport', types: ['Sorcery'], keyPrefix: 'k:0:1' });
    expect(json(st)).toContain('{"kind":"returnToHand","filter":{"types":["Creature"],"controller":"you"},"count":1,"beamUp":true}');
  });
  it('a granted instance with a `filter` returns a creature of that filter (CR 118.9, 601.2b: the cost part names the object), and the cost is its mana cost', () => {
    const filter = { types: ['Creature'], controller: 'you', not: { is: { ref: 'grantor' } } };
    const kw = { kind: 'keyword', keyword: 'beam me up', text: 'beam me up', costIsManaCost: true, filter } as never;
    const [st] = keywordRegistry.expand(kw, { granted: true, faceName: 'Example Chief', types: ['Sorcery'], keyPrefix: 'k:0:1', manaCost: [{ kind: 'generic', amount: 2 }, { kind: 'colored', color: 'U' }] } as never);
    expect(json(st)).toContain('"beamUp":true');
    expect(json(st)).toContain(json(filter));
    expect(json(st)).toContain('{"kind":"generic","amount":2},{"kind":"colored","color":"U"}');
  });
  it('a granted instance for a card with no mana cost stands for nothing (CR 118.6: there is no cost to pay)', () => {
    const kw = { kind: 'keyword', keyword: 'beam me up', text: 'beam me up', costIsManaCost: true } as never;
    expect(keywordRegistry.expand(kw, { granted: true, faceName: 'Example Land', types: ['Sorcery'], keyPrefix: 'k:0:1' } as never)).toEqual([]);
  });
  it('the other cards that print "Beam me up {cost}" (and grants by other cards) stay as they were: the line is a keyword line, the cost is read, no `filter` is asked for', () => {
    for (const text of ['You gain 3 life.\nBeam me up {2}{U}', 'You gain 3 life.\nBeam me up {1}{W}{W}']) {
      const f = parseCard(card('Example Transport', 'Sorcery', text), OPTS).faces[0]!;
      expect(json(f.abilities), text).toContain('"keyword":"beam me up"');
      expect(json(f.abilities), text).not.toContain('"filter"');
    }
  });
});

describe('trek-7 readings: quantities, "the rest" of an exile-until, the free casts limit (general readings, not card-specific)', () => {
  const trig = (body: string) => parseCard(card('Example Lurker', 'Creature — Human', `At the beginning of your end step, ${body}`, { power: '2', toughness: '2' }), OPTS).faces[0]!;
  it('"the number of opponents you attacked this turn" is the whole turn\'s count (CR 506.3, 508.1), in either tense', () => {
    for (const phrase of ['you attacked', "you've attacked", 'you have attacked']) {
      const f = trig(`you gain life equal to the number of opponents ${phrase} this turn.`);
      expect(fullyAutomated(f), phrase).toBe(true);
      expect(json(f.abilities), phrase).toContain('{"q":"opponentsAttacked","scope":"turn"}');
    }
  });
  it('negative: another period or another object is no such quantity ("last turn", "players", no period at all)', () => {
    for (const body of ['you gain life equal to the number of opponents you attacked last turn.', 'you gain life equal to the number of players you attacked this turn.', 'you gain life equal to the number of opponents you attacked.']) {
      expect(json(trig(body).abilities), body).not.toContain('"scope":"turn"');
      expect(fullyAutomated(trig(body)), body).toBe(false);
    }
  });
  it('"the number of dilemmas you\'ve faced this turn" counts the faced-a-dilemma actions of this turn (Star Trek reminder text); without "this turn" it is no reading', () => {
    const f = trig("you gain life equal to the number of dilemmas you've faced this turn.");
    expect(fullyAutomated(f)).toBe(true);
    expect(json(f.abilities)).toContain('"verb":"faceDilemma"');
    expect(json(f.abilities)).toContain('"scope":"turn"');
    expect(fullyAutomated(trig("you gain life equal to the number of dilemmas you've faced."))).toBe(false);
  });
  it('"the rest" of an exile-until is the cards it exiled other than the one it stopped at, still in exile (CR 406.1, 608.2c); another player or another word is not read that way', () => {
    const queen = (rest: string) => parseCard(card('Example Order', 'Sorcery', `Target opponent exiles cards from the top of their library until they exile a creature card. ${rest}`), OPTS).faces[0]!;
    const ok = queen('They put the rest on the bottom in a random order.');
    expect(fullyAutomated(ok)).toBe(true);
    expect(json(ok.abilities)).toContain('"op":"exileUntil"');
    expect(json(ok.abilities)).toMatch(/"exiled":"[^"]+"/);
    for (const part of ['"order":"random"', '"position":"bottom"', '"zone":"library"']) expect(json(ok.abilities), part).toContain(part);
    for (const rest of ['They put the rest on top in a random order.', 'You put the rest on the bottom in a random order.', 'They put the others on the bottom in a random order.']) {
      expect(fullyAutomated(queen(rest)), rest).toBe(false);
    }
    // the player who exiles is the one reading "the rest": your own exile-until written with "your" does not become automated by this reading (the gate refuses its wording)
    const own = parseCard(card('Example Order', 'Sorcery', 'Exile cards from the top of your library until you exile a creature card. Put the rest on the bottom of your library in a random order.'), OPTS).faces[0]!;
    expect(fullyAutomated(own)).toBe(false);
  });
  it('"cast any number of spells with mana value less than or equal to <N> from among those cards without paying their mana costs" is one choice among the cards that can be cast now, each face or half held to the limit (CR 118.9, 202.3, 601.2, 608.2d)', () => {
    const t = (limit: string) => parseCard(card('Example Chief', 'Creature — Human', `{T}: Exile the top five cards of your library. You may cast any number of spells with mana value ${limit} from among those cards without paying their mana costs.`, { power: '2', toughness: '2' }), OPTS).faces[0]!;
    const computed = t('less than or equal to the number of Officers you control');
    expect(fullyAutomated(computed)).toBe(true);
    for (const part of ['"op":"cast"', '"maxManaValue":{', '"q":"count"', '"subtypes":["Officer"]', '"select":{}', '"free":true']) expect(json(computed.abilities), part).toContain(part);
    expect(computed.templatesUsed).toContain('eff.trek7.cast.anyNumber.free.mvLte.fromAmong');
    expect(json(t('less than or equal to 3').abilities)).toContain('"maxManaValue":3');
    // the pre-existing "X or less" reading of eff.r3cost... is another template, with its own JSON, and is not this round's
    expect(t('3 or less').templatesUsed).not.toContain('eff.trek7.cast.anyNumber.free.mvLte.fromAmong');
    for (const limit of ['less than the number of Officers you control', 'greater than or equal to the number of Officers you control', 'more than 3']) expect(fullyAutomated(t(limit)), limit).toBe(false);
  });
});

describe('trek-7: fail closed on wordings near the new templates', () => {
  it('Scotty\'s three sentences are one static ability: dropping or changing a sentence is not automated as the full reading', () => {
    const scotty = (text: string) => parseCard(card('Example Chief', 'Creature — Human', text, { power: '2', toughness: '2' }), OPTS).faces[0]!;
    const base = "During your main phase, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. ~ can't be beamed up to cast a spell this way.";
    expect(fullyAutomated(scotty(base))).toBe(true);
    expect(json(scotty(base).abilities)).toContain('"grantor"');
    for (const text of [
      "During your main phase, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. ~ can't be beamed up.",
      "During your main phase, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. Other creatures you control can't be beamed up to cast a spell this way.",
      "During your turn, each card in your graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. ~ can't be beamed up to cast a spell this way.",
      "During your main phase, each card in each graveyard has beam me up. The beam me up cost is equal to that spell's mana cost. ~ can't be beamed up to cast a spell this way.",
    ]) {
      const f = scotty(text);
      expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(scotty(base).abilities), text).toBe(false);
    }
  });
  it('a bare keyword or a misspelled one is not automated ("Beam me up" with no cost; "Beam me down {2}{U}")', () => {
    for (const text of ['You gain 3 life.\nBeam me up', 'You gain 3 life.\nBeam me down {2}{U}']) {
      expect(compileCard(card('Example Transport', 'Sorcery', text)).automation.level, text).not.toBe('full');
    }
  });
});
