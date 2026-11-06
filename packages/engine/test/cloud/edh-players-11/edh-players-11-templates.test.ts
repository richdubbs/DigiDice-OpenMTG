/**
 * edh-players-11 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-11.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-11-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp11 from '../../../src/parser/templates/zz-cloud/edh-players-11.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP11 = edhp11 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  // a ~ that "is still a land" is a land (the rider's type word is the object's own)
  if (/\bstill a land\b/.test(text) && text.includes('~')) return card('Example Nexus', 'Land', text);
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-11 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-11.json, path order: after edh-players-1, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-11.json');
    expect(files.indexOf('zz-cloud/edh-players-11.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-1.json'));
    expect(files.indexOf('zz-cloud/edh-players-11.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp11.*', () => {
    for (const t of EP11) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp11\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP11) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-11 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP11) {
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
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} at random.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\binstead\b/, 'also'], [/\btwice\b/, 'three times'], [/\bdouble\b/, 'triple'], [/\bplus\b/, 'minus'], [/\byou control\b/, 'an opponent controls'],
    [/\bexile it\b/, 'destroy it'], [/\byour graveyard\b/, 'your hand'], [/\bwould\b/, 'could'], [/\bone or more\b/, 'exactly one'], [/\bcreature spell\b/, 'artifact spell'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('edh-players-11 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP11) {
    it(`${t.id}: an appended "unless/at random/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('edh-players-11 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP11) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || w === '~,' || w === "~'s" || /^"?\{/.test(w) || w.includes('\n')) return;
          // a counter's kind is an open class (design 6.11: the word before "counter(s)" is any word, weak when it is not in the lexicon): not a G2 word here
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const start = w.startsWith('"') ? '"' : '';
          const mutated = [...words.slice(0, i), `${start}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

const index = localIndex();

/** The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`). */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'eff.edhp11.eachPlayerMayDraw': { full: ['Kwain, Itinerant Meddler', 'The Second Doctor'] },
  'eff.edhp11.player.cantAttackYouOrPermanents.theirNextTurn': { full: ['The Second Doctor'] },
  'eff.edhp11.ifPlayerDoes.creaturesCantAttackYou': { full: ['Orzhov Advokist'] },
  'eff.edhp11.eachPlayerMayPutCounters.onCreatureTheyControl': { full: ['Orzhov Advokist'] },
  'eff.edhp11.dig.putAll.bf': { full: ['Tezzeret, Master of the Bridge'] },
  'eff.edhp11.pump.xOrMinusX.whereX': { full: ['Liliana of the Dark Realms'] },
  'eff.edhp11.forEachOpponent.token.attacking.thatPlayer': { full: ['Ainok Strike Leader'] },
};

describe.skipIf(index === null)('edh-players-11 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-11 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Vehicle|Saga)\b/gi, '~').trim());
        }
      }
    }
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Players can't lose life this turn and ..."); a lone keyword line is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP11.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);

  for (const [id, { full, partial }] of Object.entries(REAL)) {
    it(`${id}: ${[...full, ...(partial ?? [])].join(', ')} read the line with it and pass the render gate${full.length > 0 ? ' (and the first are fully automated)' : ''}`, () => {
      for (const name of [...full, ...(partial ?? [])]) {
        const oracle = (index ?? []).find((c) => c.name === name);
        expect(oracle, name).toBeDefined();
        const parsed = parseCard(oracle!, OPTS);
        expect(parsed.faces.flatMap((f) => f.templatesUsed), name).toContain(id);
        if (full.includes(name)) {
          expect(compileCard(oracle!).automation.level, name).toBe('full');
          expect(parsed.faces.every((f) => f.gate.every((g) => g.ok)), name).toBe(true);
        }
      }
    }, 60_000);
  }
  it('every template of the file has its real cards listed', () => {
    for (const t of EP11) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});




// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creatureText = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const enchantText = (text: string): OracleCard => card('Example Hymn', 'Enchantment', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-11: the players of a group who did an optional action (effects/handlers/control.ts#bindDoers, parser/lower/mentions.ts#didOf, holes/player.ts; CR 608.2c, 608.2d, 101.4)', () => {
  it('"each player who drew a card this way", "who does" and "who did" name the players of the `may` before who did it', () => {
    expect(isFull(spell('Each player may draw a card, then each player who drew a card this way gains 2 life.'))).toBe(true);
    expect(isFull(spell('Each player may draw a card. Each player who drew a card this way gains 2 life.'))).toBe(true);
    expect(isFull(spell('Each player may draw a card. Each player who does gains 2 life.'))).toBe(true);
    expect(isFull(spell('Each player may draw a card. Each player who did gains 2 life.'))).toBe(true);
    expect(isFull(spell('Each player may draw two cards. Each opponent who does loses 1 life.'))).toBe(true); // the players who did it other than you
  });
  it('the option must be the one the words name: "drew a card this way" after another option, after one player\'s option or after another group is not read', () => {
    expect(isFull(spell('Each player may discard a card, then each player who drew a card this way gains 2 life.'))).toBe(false);
    expect(isFull(spell('You may draw a card, then each player who drew a card this way gains 2 life.'))).toBe(false);
    expect(isFull(spell('Each opponent may draw a card, then each player who drew a card this way gains 2 life.'))).toBe(false);
    expect(isFull(spell('Draw a card, then each player who drew a card this way gains 2 life.'))).toBe(false);
  });
  it('"each player who doesn\'t" and a player who is not named by the words are other texts', () => {
    expect(isFull(spell("Each player may draw a card. Each player who doesn't gains 2 life."))).toBe(false);
    expect(isFull(spell('Each player may draw a card. Each creature who does gains 2 life.'))).toBe(false);
  });
  it('"Each opponent who does ..." after "each player may ..." is every doer but the controller; "if a player does" ties the restriction to the doers', () => {
    expect(isFull(enchantText('At the beginning of your end step, each player may draw a card. Each opponent who does can\'t attack you or permanents you control during their next turn.'))).toBe(true);
    expect(isFull(enchantText("At the beginning of your upkeep, each player may put two +1/+1 counters on a creature they control. If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn."))).toBe(true);
    // (no `may` of a group before it, or another duration shape: nothing to refer to)
    expect(isFull(enchantText("At the beginning of your upkeep, If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn."))).toBe(false);
    expect(isFull(enchantText("At the beginning of your upkeep, you may draw a card. If a player does, creatures that player controls can't attack you or planeswalkers you control until your next turn."))).toBe(false);
  });
});

describe('edh-players-11: "you put one or more counters on a permanent or player" (parser/holes/event.ts#youPutCounters, render/evt.ts#events; CR 122.1, 122.6, 603.2c)', () => {
  const T = (on: string): OracleCard => enchantText(`Whenever you put one or more counters on ${on}, you gain 1 life.`);
  it('is read and said back', () => {
    expect(isFull(T('a permanent or player'))).toBe(true);
    expect(isFull(T('a permanent'))).toBe(true);
  });
  it('another list of the two (a creature, a planeswalker, a set) is another text', () => {
    expect(isFull(T('a creature or player'))).toBe(false);
    expect(isFull(T('a permanent or planeswalker'))).toBe(false);
    expect(isFull(T('one or more permanents or players'))).toBe(false);
  });
});

describe('edh-players-11: "target opponent, creature an opponent controls, or planeswalker an opponent controls" (parser/holes/object.ts#mixedTargets, render/refs.ts; CR 115.1, 115.4)', () => {
  const T = (t: string): OracleCard => enchantText(`Whenever you gain life, ~ deals 2 damage to ${t}.`);
  it('is read and said back (one target: a player or an object of either description)', () => {
    expect(isFull(T('target opponent, creature an opponent controls, or planeswalker an opponent controls'))).toBe(true);
    expect(isFull(T('target player, creature you control, or planeswalker you control'))).toBe(true);
  });
  it('"and", three descriptions or a plural are not this target', () => {
    expect(isFull(T('target opponent, creature an opponent controls, and planeswalker an opponent controls'))).toBe(false);
    expect(isFull(T('target opponent, creature an opponent controls, planeswalker an opponent controls, or artifact an opponent controls'))).toBe(false);
    expect(isFull(T('up to two target opponents, creatures an opponent controls, or planeswalkers an opponent controls'))).toBe(false);
  });
});

describe('edh-players-11: "if the {1}{B} cost was paid" (parser/holes/cond.ts#altCostPaid, parser/parse.ts#linkAltCostNamed, render/cond.ts; CR 118.9, 601.2b, 607.2i)', () => {
  const ALT = 'You may pay {1}{B} rather than pay this spell\'s mana cost.';
  const mastery = (alt: string, cost: string): OracleCard => card('Example Mastery', 'Instant', `${alt}\nIf the ${cost} cost was paid, an opponent draws a card.\nExile target creature.`, { mana_cost: '{3}{B}' });
  it('is the face\'s one alternative cost, when it is named by its mana cost', () => {
    expect(isFull(mastery(ALT, '{1}{B}'))).toBe(true);
  });
  it('another cost than the alternative cost\'s, a face without one, or two of them is not read (fail closed)', () => {
    expect(isFull(mastery(ALT, '{2}{B}'))).toBe(false);
    expect(isFull(mastery('Flying', '{1}{B}'))).toBe(false);
    expect(isFull(mastery(`${ALT}\nYou may pay {R} rather than pay this spell's mana cost.`, '{1}{B}'))).toBe(false);
  });
});

describe('edh-players-11: "Put all <cards> from among them onto the battlefield" after an exile of the top cards (parser/lower/mentions.ts#producedBy, render/fold-edhp11.ts; CR 701.13a, 608.2c, 400.7j)', () => {
  it('is read and said back after "Exile the top N cards of your library."', () => {
    expect(isFull(spell('Exile the top six cards of your library. Put all land cards from among them onto the battlefield.'))).toBe(true);
  });
  it('without a group before it, after one card, or onto the battlefield tapped it is another text', () => {
    expect(isFull(spell('Put all land cards from among them onto the battlefield.'))).toBe(false);
    expect(isFull(spell('Exile the top card of your library. Put all land cards from among them onto the battlefield.'))).toBe(false);
    expect(isFull(spell('Exile the top six cards of your library. Put all land cards from among them into your hand.'))).toBe(false);
  });
  it('the cards are in exile: a choice among them that the library templates would read with zone library stays another text (review: Xenagos, the Reveler)', () => {
    // edh-zones-27: this wording is now read by eff.edhz27.put.fromExiledTop.battlefield (zone any, the exiled group), Aminatou's Augury; the library templates still do not read it
    expect(isFull(spell('Exile the top seven cards of your library. You may put a land card from among them onto the battlefield.'))).toBe(true);
    expect(isFull(spell('Exile the top four cards of your library. Put one of them into your hand.'))).toBe(false);
  });
});

describe('edh-players-11: "gets +X/+X or -X/-X ..., where X is ..." (render/fold-edhp11.ts#choosePumpXOrMinusX; CR 608.2d, 613.4c)', () => {
  it('is read and said back, and an emblem that gives permanents an ability is automated', () => {
    expect(isFull(spell('Target creature gets +X/+X or -X/-X until end of turn, where X is the number of lands you control.'))).toBe(true);
    expect(isFull(spell('You get an emblem with "Swamps you control have \'{T}: Add {B}{B}{B}{B}.\'"'))).toBe(true);
  });
  it('another pair of changes, no duration or an emblem of its own activated ability is not this reading', () => {
    expect(isFull(spell('Target creature gets +X/+0 or -X/-0 until end of turn, where X is the number of lands you control.'))).toBe(false);
    expect(isFull(spell('Target creature gets +X/+X or -X/-X, where X is the number of lands you control.'))).toBe(false);
    // edh-next-100: an emblem's own activated ability is advertised now (core/legal.ts), so "{T}: Draw a card." in an emblem is understood; it is still not this pump reading
    expect(isFull(spell('You get an emblem with "{T}: Draw a card." and "{T}: Draw a blorfty."'))).toBe(false);
  });
});

describe('edh-players-11: "Whenever you attack with ~ and/or your commander" (parser/holes/event.ts#youAttack, render/evt.ts; CR 508.1, 903.3d-e, 603.2c)', () => {
  const T = (who: string): OracleCard => creatureText(`Whenever you attack with ${who}, draw a card.`);
  it('is read and said back', () => {
    expect(isFull(T('~ and/or your commander'))).toBe(true);
  });
  it('another list is another text', () => {
    expect(isFull(T('~ and/or another creature'))).toBe(false);
    expect(isFull(T('~ and your commander'))).toBe(false);
    expect(isFull(T('~ and/or your commanders'))).toBe(false);
  });
});

describe('edh-players-11: "that creature" names the creature a sacrifice COST sacrificed (parser/lower/ability.ts#sacrificedMentions; CR 602.2b, 608.2h)', () => {
  it('is read when no other creature is named', () => {
    expect(isFull(creatureText('{T}, Sacrifice another creature: Draw X cards, where X is that creature\'s power.'))).toBe(true);
    expect(isFull(creatureText('{T}, Sacrifice a creature: Draw X cards, where X is the sacrificed creature\'s power.'))).toBe(true);
  });
  it('a target creature of the ability stays "that creature" (the cost\'s creature is a candidate only when nothing else fits); a noun the cost does not say names nothing (fail closed)', () => {
    const withTarget = compileCard(creatureText('{T}, Sacrifice a creature: Target creature gets +1/+1 until end of turn. You gain life equal to that creature\'s toughness.'));
    expect(withTarget.automation.level).toBe('full');
    expect(JSON.stringify(withTarget.faces)).not.toContain('costSacrificed'); // "that creature" is the target, as before the round
    expect(isFull(creatureText('{T}, Sacrifice an artifact: Draw X cards, where X is that creature\'s power.'))).toBe(false);
  });
});

describe('edh-players-11: damage with its X stated first, then "You gain X life." as a sentence of its own (render/fold.ts#damageGainWhereX; CR 608.2h, 107.3)', () => {
  it('is said back both ways', () => {
    expect(isFull(spell('~ deals X damage to each opponent, where X is the number of lands you control. You gain X life.'))).toBe(true);
    expect(isFull(spell('~ deals X damage to each opponent and you gain X life, where X is the number of lands you control.'))).toBe(true);
  });
  it('another amount in the gain is another instruction, not the same X', () => {
    const c = compileCard(spell('~ deals X damage to each opponent, where X is the number of lands you control. You gain 3 life.'));
    expect(JSON.stringify(c.faces)).toContain('"amount":3');
  });
});

describe('edh-players-11: the engine advertises what the round needs', () => {
  it('no new capability is needed: a group `may` binds its doers under `as` (bound refs are read as ever)', () => {
    expect(ENGINE_CAPABILITIES.has('ref:bound')).toBe(true);
  });
  it('an emblem\'s OWN activated ability is advertised since edh-next-100 (core/legal.ts lists the emblem\'s activations)', () => {
    expect(ENGINE_CAPABILITIES.has('feature:emblem.activated')).toBe(true);
  });
});
