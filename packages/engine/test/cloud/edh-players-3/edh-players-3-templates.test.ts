/**
 * edh-players-3 (Commander lane edh-players): the template data of parser/templates/zz-cloud/edh-players-3.json and the parser, lowering, renderer and engine changes of the
 * round. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every counter-example does not parse or parses
 * to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an automated card (G2); G3: a critical word a
 * pattern spells out is consumed. Examples are synthetic wordings (design 6.10), checked against the local index when it is present, where each template is also read
 * on the real cards that print its sentence. The behavior is in edh-players-3-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { compileCard, type OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import edhp3 from '../../../src/parser/templates/zz-cloud/edh-players-3.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const EP3 = edhp3 as Template[];
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

describe('edh-players-3 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/edh-players-3.json, path order: after edh-players-1, before look3) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/edh-players-3.json');
    expect(files.indexOf('zz-cloud/edh-players-3.json')).toBeGreaterThan(files.indexOf('zz-cloud/edh-players-1.json'));
    expect(files.indexOf('zz-cloud/edh-players-3.json')).toBeLessThan(files.indexOf('zz-cloud/look3.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are <kind>.edhp3.*', () => {
    for (const t of EP3) {
      expect(t.id, t.id).toMatch(/^(eff|sta|trg)\.edhp3\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of EP3) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'twice', 'double', 'prevent']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('edh-players-3 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of EP3) {
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

describe('edh-players-3 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of EP3) {
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

describe('edh-players-3 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of EP3) {
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

/**
 * The real cards that print each template's sentence and read it with the template (taken from the whole-index snapshot with `npm run cards`): FULL ones are fully
 * automated; the others have a sentence another slice owns (backlog/r4-owners.md) and are checked for this template's line only.
 */
const REAL: Readonly<Record<string, { full: readonly string[]; partial?: readonly string[] }>> = {
  'eff.edhp3.forEachOpponent.token.attacking.thatPlayerOrPlaneswalker': { full: ['Adeline, Resplendent Cathar'] },
  'eff.edhp3.becomes.xx.color.subtype.durFirst': { full: ['Lair of the Hydra'] },
  'eff.edhp3.cantLoseGame.oppsCantWin.thisTurn': { full: ["Angel's Grace"] },
  'eff.edhp3.lifeFloor.damageReducesTo1': { full: ["Angel's Grace"] },
  'eff.edhp3.double.powerOf.objs': { full: ['Thrakkus the Butcher'] },
  'eff.edhp3.double.itsPower': { full: ['Two-Handed Axe // Sweeping Cleave'] },
  'eff.edhp3.loselife.draw': { full: ['Rankle, Master of Pranks'] },
};

describe.skipIf(index === null)('edh-players-3 design 6.10 (local index): synthetic examples, real cards', () => {
  it('no edh-players-3 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a pattern with no hole is the rule's own words: its sentence alone is the one line an example can't avoid ("Combat damage can't be prevented."); a lone
    // keyword line ("Reach") is no card's text either
    const norm = (x: string): string => x.toLowerCase().replace(/\s+/g, ' ').replace(/ ([',.])/g, '$1').replace(/\.$/, '').trim();
    const own = (t: Template, l: string): boolean => /^[A-Z][a-z]+$/.test(l.trim()) || (!t.pattern.includes('{') && norm(l) === norm(t.pattern));
    const verbatim = EP3.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()) && !own(t, l))).map((x) => `${t.id}: ${x}`));
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
  it('every template of the file has its real cards listed (or is read by none yet, listed here with the reason)', () => {
    const none: Readonly<Record<string, string>> = {
    };
    for (const t of EP3) expect(REAL[t.id] !== undefined || none[t.id] !== undefined, t.id).toBe(true);
  });
});

// ---- the parser, lowering, renderer and engine changes of the round (each with its negative cases) ------------------------------------------------------------------------

const staticText = (text: string): OracleCard => card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
const landText = (text: string): OracleCard => card('Example Nexus', 'Land', text);
const isFull = (c: OracleCard): boolean => compileCard(c).automation.level === 'full';

describe('edh-players-3: "A and nonbasic B" (parser/holes/filter.ts#andPhrases, render/np.ts; family plural-and-nonbasic)', () => {
  it('reads "creatures and nonbasic lands your opponents control" as the creatures or the nonbasic lands they control, and says it back the same way', () => {
    expect(isFull(staticText('Creatures and nonbasic lands your opponents control enter tapped.'))).toBe(true);
    expect(isFull(staticText('Artifacts and nonbasic lands you control enter tapped.'))).toBe(true);
  });
  it('a modifier on the first half, a third description and a half that is a word alone are not read', () => {
    expect(isFull(staticText('Tapped creatures and nonbasic lands your opponents control enter tapped.'))).toBe(false);
    expect(isFull(staticText('Creatures and nonbasic lands and artifacts your opponents control enter tapped.'))).toBe(false);
    expect(isFull(staticText('Creatures and nonbasic your opponents control enter tapped.'))).toBe(false);
  });
});

describe('edh-players-3: a creature land with abilities or an X/X size (render/mods.ts; families still-land-sized-artifact-creature, becomes-x-over-x)', () => {
  it('"becomes a 1/1 Bird artifact creature with flying and infect until end of turn. It\'s still a land." is read, and said back with the rider', () => {
    expect(isFull(landText("{1}: This land becomes a 1/1 Bird artifact creature with flying and infect until end of turn. It's still a land."))).toBe(true);
    expect(isFull(landText("{1}: This land becomes a 1/1 Bird artifact creature with flying until end of turn. It's still a land."))).toBe(true);
  });
  it('without the duration or with a color of its own it is not read as the same change', () => {
    // edh-c-110 (CR 611.2a, 205.1b): with no duration the change is for good (Kenku Artificer's "becomes a 0/0 Homunculus artifact creature with flying"), and the land keeps its land type
    // ("It's still a land." says nothing new), so this wording is read now (eff.edhv110.becomes.basept.subtype.artifactCreature.permanent); the older negative is updated
    expect(isFull(landText("{1}: This land becomes a 1/1 Bird artifact creature with flying. It's still a land."))).toBe(true);
    expect(isFull(landText("{1}: This land becomes a 1/1 white Bird artifact creature with flying until end of turn. It's still a land."))).toBe(false);
  });
  it('"Until end of turn, this land becomes an X/X green Hydra creature. It\'s still a land." reads the X the ability announced', () => {
    expect(isFull(landText("{X}{G}: Until end of turn, this land becomes an X/X green Hydra creature. It's still a land. X can't be 0."))).toBe(true);
  });
  it('an X/X size with another number, a computed X and the duration after the size are other wordings (not this one)', () => {
    expect(isFull(landText("{X}{G}: Until end of turn, this land becomes an X/Y green Hydra creature. It's still a land."))).toBe(false);
    expect(isFull(landText("{X}{G}: Until end of turn, this land becomes an X/X Hydra creature and a green creature. It's still a land."))).toBe(false);
  });
});

describe('edh-players-3: "for each opponent, ... tapped and attacking that player or a planeswalker they control" (render/steps-zones.ts, render/refs.ts)', () => {
  it('is read, in a trigger and in a spell, and the iterated opponent is "that player" there too', () => {
    expect(isFull(staticText("Whenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control."))).toBe(true);
    expect(isFull(staticText("Whenever this creature attacks, for each opponent, create two 1/1 red Goblin creature tokens that are tapped and attacking that player or a planeswalker they control."))).toBe(true);
  });
  it('the player alone (read since edh-players-11), a planeswalker of yours, no tapped and another player are not read by this template', () => {
    // edh-players-11 reads "tapped and attacking that player" (the player alone, CR 508.4: the token attacks exactly that player) as a full reading of its own;
    // before it the player alone was this file's experimental wording. The wording with "or a planeswalker they control" is still this template's.
    expect(isFull(staticText("Whenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player."))).toBe(true);
    expect(isFull(staticText("Whenever you attack, for each opponent, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker you control."))).toBe(false);
    expect(isFull(staticText("Whenever you attack, for each opponent, create a 1/1 white Human creature token that's attacking that player or a planeswalker they control."))).toBe(false);
    expect(isFull(staticText("Whenever you attack, for each player, create a 1/1 white Human creature token that's tapped and attacking that player or a planeswalker they control."))).toBe(false);
  });
});

describe('edh-players-3: the life loss damage causes (types/ability.ts life.fromDamage, effects/replacements.ts#matchProposed, triggers/forms.ts)', () => {
  it('the engine advertises the form', () => {
    expect(ENGINE_CAPABILITIES.has('feature:ev.life.fromDamage')).toBe(true);
  });
  it('"Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead" is read for you only and with that number only', () => {
    const spell = (text: string): OracleCard => card('Example Volley', 'Instant', text);
    expect(isFull(spell('Until end of turn, damage that would reduce your life total to less than 1 reduces it to 1 instead.'))).toBe(true);
    expect(isFull(spell('Until end of turn, damage that would reduce target player\'s life total to less than 1 reduces it to 1 instead.'))).toBe(false);
    expect(isFull(spell('Until end of turn, damage that would reduce your life total to less than 1 reduces it to 2 instead.'))).toBe(false);
    expect(isFull(spell('Until end of turn, damage that would reduce your life total to less than 2 reduces it to 1 instead.'))).toBe(false);
    expect(isFull(spell('Until end of turn, life loss that would reduce your life total to less than 1 reduces it to 1 instead.'))).toBe(false);
  });
});

describe('edh-players-3: "You can\'t lose the game this turn and your opponents can\'t win the game this turn" (render/steps-lasting.ts#cantLoseOppsCantWinThisTurn)', () => {
  it('is read in that order with both durations; one half, another order or no duration is not', () => {
    const spell = (text: string): OracleCard => card('Example Volley', 'Instant', text);
    expect(isFull(spell("You can't lose the game this turn and your opponents can't win the game this turn."))).toBe(true);
    expect(isFull(spell("You can't lose the game this turn."))).toBe(false);
    expect(isFull(spell("Your opponents can't win the game this turn and you can't lose the game this turn."))).toBe(false);
    expect(isFull(spell("You can't lose the game and your opponents can't win the game."))).toBe(false);
    expect(isFull(spell("You can't lose the game this turn and your opponents can't lose the game this turn."))).toBe(false);
  });
});

describe('edh-players-3: "double the power of <objects> / double its power" (templates eff.edhp3.double.*)', () => {
  it('are read with their duration (the toughness too since edh-b-4); both statistics and no duration are other wordings', () => {
    const trig = (t: string): OracleCard => staticText(`Whenever this creature attacks, ${t}`);
    expect(isFull(trig('double the power of each Dragon you control until end of turn.'))).toBe(true);
    expect(isFull(trig('double the power of target creature you control until end of turn.'))).toBe(true); // the existing reading (eff.t41.double.thePowerOf), unchanged: no second reading
    expect(isFull(trig('double the toughness of each Dragon you control until end of turn.'))).toBe(true); // since edh-b-4 (eff.edhb4.double.toughness.objs): the toughness is read too
    expect(isFull(trig('double the power of each Dragon you control.'))).toBe(false);
    expect(isFull(trig('double its power.'))).toBe(false);
  });
});

describe('edh-players-3: "choose any number --" (parser/lower/ability.ts#modalHeaderWords, render/program.ts#modeHeader)', () => {
  const modal = (head: string, ...modes: string[]): OracleCard => staticText(`Whenever this creature deals combat damage to a player, ${head} --\n${modes.map((m) => `\u2022 ${m}`).join('\n')}`);
  it('is read with two or more modes of a triggered ability, and says it back; not for a spell', () => {
    expect(isFull(modal('choose any number', 'You gain 2 life.', 'You draw a card.'))).toBe(true);
    expect(isFull(modal('choose any number', 'You gain 2 life.', 'You draw a card.', 'Each opponent loses 1 life.'))).toBe(true);
    expect(isFull(card('Example Volley', 'Sorcery', 'Choose any number --\n\u2022 You gain 2 life.\n\u2022 You draw a card.'))).toBe(false); // a spell's modes are chosen as it is cast: not read
  });
  it('one mode alone, a mode count that is not "any number" for the same words and a reflexive "choose any number" are not read', () => {
    expect(isFull(modal('choose any number', 'You gain 2 life.'))).toBe(false);
    expect(isFull(modal('choose any amount', 'You gain 2 life.', 'You draw a card.'))).toBe(false);
    expect(isFull(staticText('When this creature enters, you may pay {1}. When you do, choose any number --\n\u2022 You gain 2 life.\n\u2022 You draw a card.'))).toBe(false);
  });
});

describe('edh-players-3: "<player> loses N life and draws N cards" (template eff.edhp3.loselife.draw)', () => {
  it('is read in that order; the reverse order and a different second instruction are other wordings', () => {
    expect(isFull(card('Example Volley', 'Sorcery', 'Each player loses 2 life and draws a card.'))).toBe(true);
    // (edh-c-17: "loses N life and discards a card" is its template eff.edhv17.player.lose.discard, not this one)
    expect(isFull(card('Example Volley', 'Sorcery', 'Each player loses 2 life and discards a card.'))).toBe(true);
    expect(isFull(card('Example Volley', 'Sorcery', 'Each player loses 2 life, then draws a card.'))).toBe(false);
  });
});
