/**
 * edh-players-17 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-17.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-17-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp17 from '../../../src/parser/templates/zz-cloud/edh-players-17.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP17 = edhp17 as Template[];
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

describe('edh-players-17 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-17.json, path order: after edh-players-16, before edh-players-2) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-17.json');
    expect(files.indexOf('zz-cloud/edh-players-17.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-14.json'));
    expect(files.indexOf('zz-cloud/edh-players-17.json')).toBeLessThan(files.indexOf('zz-cloud/edh-players-2.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp17.*', () => {
    for (const t of EP17) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg|rid)\.edhp17./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP17) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-17 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP17) {
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

describe('edh-players-17 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP17) {
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

describe('edh-players-17 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP17) {
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
  'eff.edhp17.gainLife.youAndPlayer': { full: ['Angel of Destiny'] },
  'eff.edhp17.counters.put.you.onChosen.youControl': { full: ['Breena, the Demagogue'] },
  'eff.edhp17.forEachVote.gainControlOwnedByVoter': { full: ['Expropriate'] },
  'eff.edhp17.eachPlayer.choose.color': { full: ['Selective Obliteration'] },
  'eff.edhp17.exileEach.unlessColorlessOrOnlyControllersColor': { full: ['Selective Obliteration'] },
  'trg.edhp17.when.attackEnchantedOpponentOrTheyAttackYou': { full: ['Tenuous Truce'] },
  'eff.edhp17.untap.next.theirController': { full: [], partial: ['Tamiyo, Field Researcher'] },
};

describe.skipIf(index === null)('edh-players-17 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-17 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP17.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
    for (const t of EP17) expect(REAL[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const spell = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Volley', 'Sorcery', text, extra);
const creatureText = (text: string, extra: Record<string, unknown> = {}): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3', ...extra });
const auraText = (text: string): OracleCard => card('Example Aura', 'Enchantment — Aura', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';
const jsonOf = (c: OracleCard): string => JSON.stringify(compileCard(c).faces[0]!.abilities);

describe('edh-players-17: "each player this creature attacked this turn" (types PlayerRef.attackedBySource, effects/refs.ts, render/refs.ts; CR 506.3, 508.1)', () => {
  const T = 'At the beginning of your end step, each player this creature attacked this turn loses the game.';
  it('is read and said back, and is the history of the source\'s own attacks', () => {
    expect(isFull(creatureText(T))).toBe(true);
    expect(jsonOf(creatureText(T))).toContain('"ref":"attackedBySource"');
  });
  it('another wording of who was attacked, or another instruction for the same players, is another reading (fail closed or different data)', () => {
    expect(isFull(creatureText(T.replace('this creature attacked', 'you attacked')))).toBe(false);
    expect(isFull(creatureText(T.replace('each player this creature attacked this turn', 'each player this creature attacked')))).toBe(false);
    expect(isFull(creatureText(T.replace('this turn', 'last turn')))).toBe(false);
    expect(isFull(creatureText(T.replace('loses the game', 'loses 3 life')))).toBe(true); // the same players, an ordinary instruction (the phrase is a player group)
  });
  it('a static ability never reads it (a rule effect would see nobody): the capability is advertised for steps only', () => {
    expect(ENGINE_CAPABILITIES.has('ref:attackedBySource')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('feature:player.controlsMost.static')).toBe(false);
  });
});

describe('edh-players-17: "that opponent has more life than another of your opponents" (parser/holes/cond.ts#opponentMoreLifeThanAnother, render/cond.ts; CR 119.1, 102.3, 603.4)', () => {
  const T = 'Whenever a player attacks one of your opponents, if that opponent has more life than another of your opponents, that attacking player draws a card.';
  it('is read and said back as at least one opponent with fewer life than the attacked one (the attacked opponent is not below themselves)', () => {
    expect(isFull(creatureText(T))).toBe(true);
    const json = jsonOf(creatureText(T));
    expect(json).toContain('"q":"countPlayers"');
    expect(json).toContain('"lifeVs":{"op":"<","than":{"ref":"event","role":"defender"}}');
  });
  it('"more life than you", an "each other" comparison, a player who is not an opponent, or fewer life are other texts', () => {
    expect(JSON.stringify(compileCard(creatureText(T.replace('another of your opponents', 'you'))).faces[0]!.abilities)).not.toContain('"lifeVs":{"op":"<","than":{"ref":"event"');
    expect(isFull(creatureText(T.replace('another of your opponents', 'each other opponent')))).toBe(false);
    expect(isFull(creatureText(T.replace('that opponent has more life', 'that player has more life')))).toBe(false);
    expect(isFull(creatureText(T.replace('more life', 'less life')))).toBe(false);
  });
});

describe('edh-players-17: "you put N counters on a creature you control" after another player\'s instruction (render/fold.ts#chooseThenCounters acts as you; CR 608.2c, 122.1)', () => {
  it('"Put N counters on a creature you control." is still read and said as before', () => {
    expect(isFull(spell('Put two +1/+1 counters on a creature you control.'))).toBe(true);
    expect(isFull(creatureText('When ~ enters, put two +1/+1 counters on a creature you control.'))).toBe(true);
  });
  it('after an instruction of another player the controller is said: "that player draws a card and you put ..."; the subject alone is not a reading of other texts', () => {
    expect(isFull(creatureText('When ~ enters, target opponent draws a card and you put two +1/+1 counters on a creature you control.'))).toBe(true);
    expect(isFull(creatureText('When ~ enters, target opponent draws a card and they put two +1/+1 counters on a creature you control.'))).toBe(false);
    expect(isFull(creatureText('When ~ enters, target opponent draws a card and you put two +1/+1 counters on a creature they control.'))).toBe(false);
  });
});

describe('edh-players-17: the voters of a vote, "for each money vote ... the voter" (types PlayerRef.votedFor, ApiStepResult.voters, effects/handlers/actions-native.ts#vote, render/fold-edhp17.ts; CR 701.38a, 701.38d)', () => {
  const V = 'Starting with you, each player votes for aid or profit. For each profit vote, choose a permanent owned by the voter and gain control of it.';
  it('is read and said back, with the voters of the vote before it', () => {
    expect(isFull(spell(V))).toBe(true);
    expect(jsonOf(spell(V))).toContain('"ref":"votedFor"');
  });
  it('without a vote before it, with a word that was not voted for, for a duration, or "an opponent controls" it is another text', () => {
    expect(isFull(spell('For each profit vote, choose a permanent owned by the voter and gain control of it.'))).toBe(false);
    expect(isFull(spell(V.replace('For each profit vote', 'For each grace vote')))).toBe(false);
    expect(isFull(spell(V.replace('gain control of it.', 'gain control of it until end of turn.')))).toBe(false);
    expect(isFull(spell(V.replace('owned by the voter', 'controlled by the voter')))).toBe(false);
  });
  it('the vote words that are also critical words ("each time vote") are consumed by the vote template', () => {
    expect(isFull(spell('Starting with you, each player votes for time or money. For each time vote, take an extra turn after this one.'))).toBe(true);
    expect(isFull(spell('Starting with you, each player votes for time or money. For each time you cast a spell, take an extra turn after this one.'))).toBe(false);
  });
  it('the capability is advertised for steps only', () => expect(ENGINE_CAPABILITIES.has('ref:votedFor')).toBe(true));
});

describe('edh-players-17: "only the color its controller chose" (types ObjectFilter.onlyColorChosenByController, rules/filter.ts, render/fold-edhp17.ts; CR 105.2a, 608.2d)', () => {
  const T = 'Each player chooses a color. Then exile each creature unless it\'s colorless or it\'s only the color its controller chose.';
  it('is read and said back, as a filter of the object\'s controller\'s own choice', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(jsonOf(spell(T))).toContain('"onlyColorChosenByController":"chosenColor"');
  });
  it('without the first sentence, with one player choosing, or with another condition it is another text', () => {
    expect(isFull(spell('Then exile each creature unless it\'s colorless or it\'s only the color its controller chose.'))).toBe(false);
    expect(isFull(spell(T.replace('Each player chooses', 'You choose')))).toBe(false);
    expect(isFull(spell(T.replace('only the color its controller chose', 'the color its controller chose')))).toBe(false);
    expect(isFull(spell(T.replace('unless it\'s colorless or ', '')))).toBe(false);
  });
  it('the filter is the engine\'s for steps only (a static ability does not read it)', () => {
    expect(ENGINE_CAPABILITIES.has('filter:onlyColorChosenByController')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('sfilter:onlyColorChosenByController')).toBe(false);
  });
});

describe('edh-players-17: "enchanted opponent" is the player an "Enchant opponent" Aura is attached to (parser/holes/player.ts, event.ts, render/refs.ts, render/evt.ts; CR 303.4, 702.5a)', () => {
  const A = 'Enchant opponent\nAt the beginning of enchanted opponent\'s end step, you and that player each draw a card.';
  it('is read and said back as the existing enchanted-player reference', () => {
    expect(isFull(auraText(A))).toBe(true);
    expect(jsonOf(auraText(A))).toContain('"ref":"enchantedPlayer"');
    expect(isFull(auraText(A.replace('opponent', 'player')))).toBe(true); // "Enchant player" says it as before
  });
  it('the attacks of the pair of declarations (trg.edhp17.when.attackEnchantedOpponentOrTheyAttackYou) are the two attack events with the Aura\'s player', () => {
    const t = auraText('Enchant opponent\nWhen you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, sacrifice this Aura.');
    expect(isFull(t)).toBe(true);
    const json = jsonOf(t);
    expect(json).toContain('"controller":"you"');
    expect(json).toContain('"controller":{"ref":"enchantedPlayer"}');
    expect(json).toContain('"orPlaneswalker":true');
  });
  it('one half of the pair, another subject, or another effect is another text', () => {
    const half = 'Enchant opponent\nWhen you attack enchanted opponent or a planeswalker they control, sacrifice this Aura.';
    expect(isFull(auraText(half))).toBe(false);
    expect(isFull(auraText('Enchant opponent\nWhen you attack enchanted opponent or a planeswalker they control or when they attack you, sacrifice this Aura.'))).toBe(false);
    // (another instruction after the same two declarations is the same trigger with other steps: fine)
    expect(isFull(auraText('Enchant opponent\nWhen you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control, you gain 2 life.'))).toBe(true);
  });
});

describe('edh-players-17: "you and that player each gain N life" is the controller\'s gain, then the other player\'s (render/fold-edhp17.ts#youAndPlayerEachGain; CR 119.1, 119.3, 101.4)', () => {
  const G = 'Whenever a creature you control deals combat damage to a player, you and that player each gain that much life.';
  it('is read and said back, for a fixed number and for the amount of the event', () => {
    expect(isFull(creatureText(G))).toBe(true);
    expect(isFull(creatureText(G.replace('that much life', '3 life')))).toBe(true);
    expect(isFull(spell('You and target opponent each gain 4 life.'))).toBe(true);
  });
  it('different amounts, losing life, a group in place of the player, and "each opponent" are other texts', () => {
    expect(isFull(spell('You and target opponent each gain 4 life and 3 life.'))).toBe(false);
    expect(isFull(spell('You and target opponent each lose 4 life.'))).toBe(false);
    expect(isFull(spell('You and each opponent each gain 4 life.'))).toBe(false);
  });
});

describe('edh-players-17: "they don\'t untap during their controller\'s next untap step" after a tap (eff.edhp17.untap.next.theirController; CR 502.3, 611.2a)', () => {
  const T = 'Tap up to two target nonland permanents. They don\'t untap during their controller\'s next untap step.';
  it('is read and said back (the plural wording of earlier rounds still is)', () => {
    expect(isFull(spell(T))).toBe(true);
    expect(isFull(spell('Tap up to two target nonland permanents. Those permanents don\'t untap during their controllers\' next untap steps.'))).toBe(true);
  });
  it('another step, a missing "next", or untapping are other texts', () => {
    expect(isFull(spell(T.replace('untap step', 'end step')))).toBe(false);
    expect(isFull(spell(T.replace('next untap step', 'untap step')))).toBe(false);
    expect(isFull(spell(T.replace('don\'t untap', 'untap')))).toBe(false);
  });
});
