/**
 * edh-players-23 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-23.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-23-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp23 from '../../../src/parser/templates/zz-cloud/edh-players-23.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP23 = edhp23 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery (with {X} in its cost when it reads X), anything else on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (/^(Destroy|Each|Target)/.test(text) && !/ gets -1\/-1/.test(text) || / gets -1\/-1/.test(text)) return card('Example Volley', 'Sorcery', text);
  const xCost = /\bX\b/.test(text.replace(/, where X is [^.]*/g, '')) && !text.includes('{X}') ? { mana_cost: '{X}' } : {};
  // a ~ that "is still a land" is a land (the rider's type word is the object's own)
  if (/\bstill a land\b/.test(text) && text.includes('~')) return card('Example Nexus', 'Land', text);
  if (t.kind !== 'static' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Sorcery', text, xCost);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;

describe('edh-players-23 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-23.json, path order: after edh-players-2, 20, 21 and 22, before edh-players-3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-23.json');
    expect(files.indexOf('zz-cloud/edh-players-23.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-2.json'));
    expect(files.indexOf('zz-cloud/edh-players-23.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp23.*', () => {
    for (const t of EP23) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp23./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP23) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-23 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP23) {
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

describe('edh-players-23 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP23) {
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

describe('edh-players-23 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP23) {
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
  'eff.edhp23.itsController.maySacrificeIt.elseDamage': { full: ['Star Athlete'] },
  'eff.edhp23.loseLife.unlessTheyPay': { full: ['Elesh Norn // The Argent Etchings'] },
  'eff.edhp23.incubate.times': { full: ['Elesh Norn // The Argent Etchings'] },
  'eff.edhp23.sacrifice.oneOrMore': { full: ['Swashbuckler Extraordinaire'] },
  'eff.edhp23.forEach.draw': { full: ["Nahiri's Lithoforming"] },
  'eff.edhp23.filter.enterTapped.thisTurn': { full: ["Nahiri's Lithoforming"] },
};

describe.skipIf(index === null)('edh-players-23 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-23 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const verbatim = EP23.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP23) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});






// ---- the parser, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creature = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';
const json = (c: OracleCard): string => JSON.stringify(compileCard(c).faces[0]!.abilities);

describe('edh-players-23: a mana ability beside adding mana that makes players lose life (parser/lower/ability.ts#loseLifeFixed, model/cap-walk.ts, model/lint-nodes.ts; CR 605.1a, 605.3b, 119.3)', () => {
  const T = '{T}: Add one mana of any color. Each player loses 1 life.';
  it('each player, each opponent or you lose a fixed amount of life: a mana ability the engine plays', () => {
    expect(isFull(card('Example Stone', 'Artifact', T))).toBe(true);
    expect(isFull(card('Example Stone', 'Artifact', '{T}: Add {B}{B}. You lose 2 life.'))).toBe(true);
    expect(isFull(card('Example Stone', 'Artifact', '{T}: Add {R}. Each opponent loses 1 life.'))).toBe(true);
    expect(json(card('Example Stone', 'Artifact', T))).toContain('{"op":"loseLife","who":{"ref":"each","who":"player"},"amount":1}');
  });
  it('a computed amount, a target, or another instruction beside the mana is another text (fail closed)', () => {
    expect(isFull(card('Example Stone', 'Artifact', '{T}: Add one mana of any color. Each player loses X life.'))).toBe(false);
    expect(json(card('Example Stone', 'Artifact', '{T}: Add one mana of any color. Target player loses 1 life.'))).not.toContain('"isMana":true'); // a mana ability has no target (CR 605.1a): an ordinary ability
    expect(isFull(card('Example Stone', 'Artifact', '{T}: Add one mana of any color. Each player discards a card.'))).toBe(false);
  });
});

describe('edh-players-23: "each player has 10 or less life" (parser/holes/cond.ts#eachHasLife, render/cond.ts; CR 119.1, 102.2, 603.4)', () => {
  const T = 'At the beginning of your upkeep, if each player has 10 or less life, draw a card.';
  it('no player of the group has a life total above the number: a count of players with life above it is zero', () => {
    expect(isFull(creature(T))).toBe(true);
    expect(json(creature(T))).toContain('"countPlayers","of":{"ref":"each","who":"player"},"lifeIs":{"op":">","n":10}');
    expect(isFull(creature(T.replace('each player', 'each opponent')))).toBe(true);
    expect(json(creature(T.replace('10 or less', '10 or more')))).toContain('"lifeIs":{"op":"<","n":10}');
  });
  it('"an opponent has 10 or less life" keeps its own reading; a word number, "exactly", or another group are other texts', () => {
    expect(json(creature(T.replace('each player', 'an opponent')))).toContain('"lifeIs":{"op":"<=","n":10}');
    expect(isFull(creature(T.replace('each player has 10 or less', 'each player has exactly 10')))).toBe(false);
    expect(isFull(creature(T.replace('each player', 'each creature')))).toBe(false);
  });
});

describe('edh-players-23: "Its controller may sacrifice it. If they don\'t, ~ deals N damage to that player." (lower/ability.ts#joinEdhP23, render/steps-flow.ts, model/lint-roles.ts; CR 701.21a, 608.2d, 120.3)', () => {
  const T = "Whenever ~ attacks, choose target artifact. Its controller may sacrifice it. If they don't, ~ deals 3 damage to that player.";
  it('the controller of the chosen permanent chooses; when they decline, they take the damage (and no other player does)', () => {
    expect(isFull(creature(T))).toBe(true);
    const j = json(creature(T));
    expect(j).toContain('"op":"may","who":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}}');
    expect(j).toContain('"otherwise":[{"op":"damage","source":{"ref":"self"},"to":{"ref":"controllerOf","object":{"ref":"target","id":"t0"}},"amount":3}]');
  });
  it('the owner, a player who is not the controller, or damage to another player are other texts', () => {
    expect(isFull(creature(T.replace('Its controller', 'Its owner')))).toBe(false);
    expect(isFull(creature(T.replace('that player', 'you')))).toBe(false);
    expect(isFull(creature(T.replace("If they don't", 'If they do')))).toBe(false);
    expect(isFull(creature(T.replace('Its controller may sacrifice it', 'Its controller may sacrifice a creature')))).toBe(false);
  });
});

describe('edh-players-23: the defender of "Whenever ~ attacks" and the player of the object\'s own zone change are no antecedent of a pronoun (model/lint-roles.ts#silentRole, #implicitRole; CR 506.2, 603.3a)', () => {
  const T = 'Whenever ~ attacks or dies, choose one or more. Each mode must target a different player.\n• Target opponent loses 2 life.\n• Target opponent sacrifices a nontoken artifact of their choice.\n• ~ deals damage to target opponent equal to the number of cards in their hand.';
  it('"their hand" in a mode of an attack-or-dies trigger is the target of that mode alone', () => {
    expect(isFull(creature(T))).toBe(true);
  });
});

describe('edh-players-23: "Whenever a source an opponent controls deals damage to you or a creature you control, ... that source\'s controller loses N life unless they pay {M}" (render/evt.ts, render/refs.ts, lower/scope.ts#neverSource; CR 120.3, 118.12)', () => {
  const T = "Whenever a source an opponent controls deals damage to you or a creature you control, that source's controller loses 3 life unless they pay {2}.";
  it('"that source" is the source of the damage, never the creature that was dealt it', () => {
    expect(isFull(creature(T))).toBe(true);
    expect(json(creature(T))).toContain('"controllerOf","object":{"ref":"event","role":"source"}');
  });
  it('"that creature" for the source of damage dealt to a creature of yours is still ambiguous (two creatures): the card stays manual', () => {
    expect(isFull(creature("Whenever a creature an opponent controls deals damage to you or a creature you control, that creature's controller loses 3 life unless they pay {2}."))).toBe(false);
  });
});

describe('edh-players-23: "Incubate N M times" and "transform all <description>" (read by the template of edh-replace-6) (CR 701.53a, 111.10i, 701.27a)', () => {
  it('the incubation is repeated, then all the tokens transform', () => {
    const T = 'Incubate 2 five times, then transform all Incubator tokens you control.';
    expect(isFull(spell(T))).toBe(true);
    expect(json(spell(T))).toContain('{"op":"repeat","times":5,"do":[{"op":"action","action":"incubate","who":{"ref":"you"},"n":2}]}');
    expect(json(spell(T))).toContain('"changeFace","what":{"ref":"each","filter":{"subtypes":["Incubator"],"controller":"you","token":true}},"to":"transform"');
  });
  it('without the number of counters, or investigating, is another text', () => {
    expect(isFull(spell('Incubate five times, then transform all Incubator tokens you control.'))).toBe(false);
    expect(isFull(spell('Incubate 2 five times, then draw each card you control.'))).toBe(false);
  });
});

describe('edh-players-23: "sacrifice one or more <things>" with a reflexive "up to that many target" (parser/lower/quantities.ts, render/fold.ts#chooseThenSacrificeAny; CR 701.21a, 603.12)', () => {
  const T = 'Whenever you attack, you may sacrifice one or more Treasures. When you do, up to that many target creatures gain double strike until end of turn.';
  it('at least one is chosen; the number of targets is the number sacrificed, never the number of attackers', () => {
    expect(isFull(creature(T))).toBe(true);
    const j = json(creature(T));
    expect(j).toContain('"min":1,"max":"any"');
    expect(j).toContain('"max":{"q":"resultCount","step":"sacrifice"}');
  });
  it('a fixed count is never counted with "that many" instead of the event amount (review): it stays another text', () => {
    expect(isFull(creature('Whenever you attack, you may sacrifice a Food. When you do, draw that many cards.'))).toBe(false);
  });
  it('"any number" keeps its own reading (min 0); "two Treasures" is a fixed count', () => {
    expect(json(creature(T.replace('one or more', 'any number of')))).toContain('"min":0,"max":"any"');
    expect(json(creature(T.replace('one or more Treasures', 'two Treasures')))).not.toContain('"max":"any"');
  });
});

describe('edh-players-23: "Lands you control enter tapped this turn." and the X of a permission the spell creates (render/steps-lasting.ts#entersTappedThisTurn, model/cap-walk.ts#inResolvedEffect; CR 614.1c, 107.3, 611.2a)', () => {
  const T = 'Sacrifice X lands. For each land sacrificed this way, draw a card. You may play X additional lands this turn. Lands you control enter tapped this turn.';
  it('the lasting replacement of the entering of lands, and the permission with the X chosen for the spell', () => {
    expect(isFull(spell(T, { mana_cost: '{X}' }))).toBe(true);
    expect(json(spell(T, { mana_cost: '{X}' }))).toContain('"replace","replaces":{"ev":"zoneChange","subject":{"types":["Land"],"controller":"you"},"to":"battlefield"},"body":{"b":"enters","tapped":true}');
  });
  it('without {X} in the cost the X is unbound; "until your next turn", another description or untapped are other texts', () => {
    expect(isFull(spell(T))).toBe(false);
    expect(isFull(spell(T.replace('this turn.', 'until your next turn.').replace('enter tapped until your next turn.', 'enter tapped until your next turn.'), { mana_cost: '{X}' }))).toBe(false);
    expect(isFull(spell('Lands you control enter untapped this turn.'))).toBe(false);
  });
  it('a STATIC ability with X still needs the statics to evaluate it (no capability for it): not automated', () => {
    expect(isFull(card('Example Bastion', 'Enchantment', 'You may play X additional lands on each of your turns.'))).toBe(false);
  });
});

describe('edh-players-23: the engine advertises what the round needs', () => {
  it('the capabilities of the round are advertised', () => {
    for (const c of ['action:incubate']) expect(ENGINE_CAPABILITIES.has(c), c).toBe(true);
  });
});
