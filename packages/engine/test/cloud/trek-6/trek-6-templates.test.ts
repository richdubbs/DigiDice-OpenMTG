/**
 * Lane trek, round trek-6 (Star Trek: counters, Spacecraft and station): the template data of parser/templates/zz-cloud/trek-6.json, the Station row
 * lowering for a card whose Station line has no reminder text (parser/lower/ability.ts#stationAbilities), the intervening "if" of the object itself denied
 * (parser/lower/anaphora.ts#interveningSelf), a linked ability that is its own producer (parser/parse.ts#selfLinkable), "if you can't" after an assimilate
 * (parser/lower/conditions.ts), the quantity `countersPut` ("if you put two or more +1/+1 counters on creatures this way": parser/holes/cond.ts,
 * parser/lower/conditions.ts#resolveCountersPut, effects/eval.ts, render/cond.ts#compareIdiom) and the renderer's readings (render/np.ts "a historic
 * permanent", render/stat.ts "put twice that many ... on that <permanent>"). Guard G9 (design 6.8): every example lowers with its template, is automated and
 * passes the exact render gate (G6); every counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in
 * place of any word of an example never leaves an automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it
 * is present. The behavior is in trek-6-scenarios.test.ts. CR cites from memory, unverified (rules/cr/ is not in the cloud checkout).
 */
import { describe, expect, it } from 'vitest';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import round from '../../../src/parser/templates/zz-cloud/trek-6.json';
import review from '../../m5/golden/cards/trek-6-review.json';
import { automated, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const MECH = round as Template[];
const MECH_COUNT = 5;
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on an instant, a triggered, activated or static ability on a creature. */
function exampleCard(t: Template, text: string) {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text)) return card('Example Volley', 'Instant', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '1', toughness: '1' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const golden = review as { card: string; verified: string; expect?: string }[];
const evidence = (id: string): string[] => golden.filter((g) => g.verified.includes(`(${id}`) || g.verified.includes(` ${id}`) || g.verified.includes(`${id},`)).map((g) => g.card);
const creature = (text: string, name = 'Example Brute') => parseCard(card(name, 'Creature — Elf Warrior', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
const ship = (text: string, pt: [string, string] | null = ['4', '4'], type = 'Artifact — Spacecraft') => parseCard(card('Example Ship', type, text, pt ? { power: pt[0], toughness: pt[1] } : {}), OPTS).faces[0]!;

describe('trek-6 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/trek-6.json, after zz-cloud/trek-4.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/trek-6.json');
    expect(files.indexOf('zz-cloud/trek-6.json')).toBeGreaterThan(files.indexOf('zz-cloud/trek-4.json'));
    expect(files.indexOf('zz-cloud/trek-6.json')).toBeLessThan(files.indexOf('zz-fast1/t4.json'));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, a status, and is of version 8; ids are (rep|eff).trek6.*', () => {
    expect(MECH.length).toBe(MECH_COUNT);
    for (const t of MECH) {
      expect(t.id, t.id).toMatch(/^(rep|eff)\.trek6\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(['stable', 'experimental'], t.id).toContain(t.status);
      expect(t.since, t.id).toBe(8);
    }
  });
  it('design 6.9 DEVIATION (named in the round record): each wording is printed on one Star Trek card of the tuning or opened half, so each is stable on one hand-verified golden card', () => {
    expect(MECH.filter((x) => x.status === 'stable').map((t) => t.id).sort()).toEqual([
      'eff.trek6.assimilate.linkedCard', 'eff.trek6.counters.put.twoObjects.n', 'eff.trek6.put.bf.counters.n', 'rep.trek6.counters.double.byYou.eachKind', 'rep.trek6.counters.double.byYou.kind',
    ]);
    expect(evidence('rep.trek6.counters.double.byYou.kind')).toEqual(['Lt. Cmdr. Geordi La Forge']);
    expect(evidence('rep.trek6.counters.double.byYou.eachKind')).toEqual(["Dr. Joseph M'Benga"]);
    expect(evidence('eff.trek6.put.bf.counters.n')).toEqual(['Captain Jean-Luc Picard']);
    expect(evidence('eff.trek6.counters.put.twoObjects.n')).toEqual(['Jean-Luc Picard, Luminary']);
    expect(evidence('eff.trek6.assimilate.linkedCard')).toEqual(['Borg Cube']);
    for (const g of golden) expect(g.expect, g.card).toBe('full');
    expect(golden.map((g) => g.card).sort()).toEqual([
      'Borg Cube', 'Captain Jean-Luc Picard', "Dr. Joseph M'Benga", 'Guinan, Ancient Advisor', 'Jean-Luc Picard, Luminary', 'Lt. Cmdr. Geordi La Forge', 'Romulan Bird-of-Prey', 'U.S.S. Discovery, at Black Alert',
    ]);
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of MECH) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then', 'during', 'same', 'twice']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('trek-6 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of MECH) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed.includes(t.id), `${e.text}: ${f.templatesUsed.join(', ')}`).toBe(true);
        expect(automated(f.abilities), `${e.text}: ${JSON.stringify(f.abilities)} ${JSON.stringify(f.diagnostics)}`).toBe(true);
        expect(f.gate.every((g) => g.ok), `${e.text}: ${JSON.stringify(f.gate)}`).toBe(true);
        expect(f.diagnostics.filter((d) => d.level === 'manual'), e.text).toEqual([]);
      }
      for (const c of t.counterExamples) {
        const f = parsedWith(t, c);
        expect(fullyAutomated(f) && jsonKey(f.abilities) === jsonKey(first.abilities), c).toBe(false);
        expect(f.templatesUsed.includes(t.id) && fullyAutomated(f), `${c}: the counter-example is read by the template`).toBe(false);
      }
    });
  }
});

/** Near-miss mutations of one example (design 6.8 G9): each must not parse, or parse to different JSON. */
function nearMisses(text: string): string[] {
  const body = text.replace(/\.$/, '');
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} this turn.`];
  const swaps: [RegExp, string][] = [
    [/\btwice\b/, 'three times'], [/\bIf you would\b/, 'If an opponent would'], [/\bput twice\b/, 'remove twice'], [/\bone or more\b/, 'two or more'], [/\bthat many\b/, 'that much'],
    [/\bon that (\w+) instead\b/, 'on target $1 instead'], [/\bassimilate\b/i, 'exile'], [/\bexiled with\b/, 'exiled by'], [/\bwith (a|two|three) (\S+) counters? on it\b/, 'with $1 $2 counters on each creature'],
    [/ and (a|two|three) /, ' or $1 '], [/\bup to one\b/, 'two'], [/\btarget\b/, 'each'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('trek-6 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of MECH) {
    it(`${t.id}: an appended "unless/instead/at random/twice/this turn" or a swapped key word never gives the example's JSON`, () => {
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

describe('trek-6 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of MECH) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (/^"?~/.test(w) || /^\{/.test(w)) return;
          // a counter's kind is an open class (design 6.11: the word before "counter(s)" is any word, weak when it is not in the lexicon): not a G2 word here
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const lead = w.match(/^["\n]+/)?.[0] ?? '';
          const end = w.match(/[.,:"\n]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `${lead}blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

// ---- the Station row of a card whose Station line has no reminder text ----------------------------------------------------------------------------------

describe('trek-6 lowering (parser/lower/ability.ts#stationAbilities, CR 721.2b): the power and toughness box of a card with one station symbol', () => {
  const STATION = 'Station';
  const REMINDER = "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)";
  const rowsOf = (f: ReturnType<typeof ship>) => f.abilities.filter((a) => (a as { station?: boolean }).station === true) as unknown as { effects: { mods: { layer: unknown; power?: number; toughness?: number }[] }[] }[];

  it('one symbol, no reminder, a printed box: the row is understood and holds the box (a creature with the printed power and toughness at the threshold)', () => {
    const f = ship(`${STATION}\n8+ | Flying`, ['4', '4']);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(rowsOf(f)).toHaveLength(1);
    expect(rowsOf(f)[0]!.effects[0]!.mods.map((m) => m.layer)).toEqual([4, '7b', 6]);
    expect(rowsOf(f)[0]!.effects[0]!.mods[1]).toMatchObject({ power: 4, toughness: 4 });
    expect(f.gate.every((g) => g.ok)).toBe(true);
  });
  it('the row may print any ability, a line below the symbol too', () => {
    const f = ship(`${STATION}\n12+ | Artifact creatures you control have flying.`, ['6', '6']);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    const g = ship(`${STATION}\n9+ | Flying\nWhenever ~ attacks, you gain 1 life.`, ['3', '3']);
    expect(fullyAutomated(g), JSON.stringify(g.diagnostics)).toBe(true);
  });
  it('two symbols and no reminder: the symbol of the box cannot be told, every row stays manual (CR 721.2b, fail closed)', () => {
    const f = ship(`${STATION}\n3+ | Other creatures you control get +1/+1.\n8+ | Flying`, ['4', '4']);
    expect(fullyAutomated(f)).toBe(false);
    expect(f.abilities.filter((a) => a.kind === 'manual')).toHaveLength(2);
  });
  it('a reminder that names a threshold is read as before: the named symbol, never the only one by default', () => {
    expect(fullyAutomated(ship(`${REMINDER}\n8+ | Flying`, ['4', '4']))).toBe(true);
    expect(fullyAutomated(ship(`${REMINDER}\n7+ | Flying`, ['4', '4']))).toBe(false); // the named threshold 8+ is not a row
    expect(fullyAutomated(ship(`${REMINDER.replace('creature at 8+', 'creature at 6+')}\n8+ | Flying`, ['4', '4']))).toBe(false);
  });
  it('a Station reminder that leaves out the threshold of the box is not made up for: the rows stay manual (T35)', () => {
    expect(fullyAutomated(ship(`${REMINDER.replace(" It's an artifact creature at 8+.", '')}\n8+ | Flying`, ['4', '4']))).toBe(false);
  });
  it('no printed box (a Planet, an Elevator): no creature row is made, as before', () => {
    const f = ship(`${STATION}\n12+ | {G}, {T}: Add {G}.`, null, 'Land — Planet');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(rowsOf(f)[0]!.effects[0]!.mods.map((m) => m.layer)).toEqual([6]);
  });
  it('a box that is not a number keeps the row manual', () => {
    expect(fullyAutomated(ship(`${STATION}\n8+ | Flying`, ['*', '4']))).toBe(false);
  });
  it('a threshold that is not "N+" keeps the row manual', () => {
    expect(fullyAutomated(ship(`${STATION}\n1-8 | Flying`, ['4', '4']))).toBe(false);
  });
});

// ---- the intervening "if" of the object itself, denied -------------------------------------------------------------------------------------------------

describe('trek-6 lowering (parser/lower/anaphora.ts#interveningSelf, CR 603.4, 608.2c): "it" after "if this Spacecraft isn\'t a creature"', () => {
  const cast = (text: string) => parseCard(card('Example Ship', 'Artifact — Spacecraft', text, { power: '1', toughness: '1' }), OPTS).faces[0]!;
  it('is the object the condition names, as for the condition without the denial', () => {
    const f = cast("Whenever you cast a noncreature spell, if this Spacecraft isn't a creature, put two charge counters on it.");
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities[0])).toContain('"op":"putCounters","on":{"ref":"self"}');
    const g = cast('Whenever you cast a noncreature spell, if this Spacecraft is tapped, put two charge counters on it.');
    expect(fullyAutomated(g), JSON.stringify(g.diagnostics)).toBe(true);
  });
  it('a condition about something else leaves the pronoun as it was (not about the object alone: no tie-break, "it" is still the spell)', () => {
    const f = cast('Whenever you cast a noncreature spell, if you control a creature, put two charge counters on it.');
    expect(JSON.stringify(f.abilities[0] ?? {})).toContain('"op":"putCounters","on":{"ref":"event","role":"spell"}');
    expect(JSON.stringify(f.abilities[0] ?? {})).not.toContain('"op":"putCounters","on":{"ref":"self"}');
  });
});

// ---- a linked ability that is its own producer -----------------------------------------------------------------------------------------------------------

describe('trek-6 lowering (parser/parse.ts#selfLinkable, CR 607.2a): the ability that exiles also reads "exiled with ~"', () => {
  const ASSIM = 'Whenever ~ attacks, assimilate a creature card exiled with it. If you can\'t, exile up to one target creature.';
  it('alone on a face it is its own producer: the exile records what it exiled under the link, and the card is automated', () => {
    const f = creature(ASSIM);
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"to":{"zone":"exile"},"link":"exiled"');
  });
  it('another ability of the face that exiles makes the producer ambiguous: fail closed (the whole ability is manual, as before)', () => {
    const f = creature(`${ASSIM}\nWhen ~ dies, exile target card from a graveyard.`);
    expect(fullyAutomated(f)).toBe(false);
    expect(JSON.stringify(f.abilities[0])).toContain('"op":"manual"'); // the trigger stays, its instructions are one manual step
    expect(JSON.stringify(f.abilities[0])).not.toContain('"action":"assimilate"');
    expect(JSON.stringify(f.abilities)).not.toContain('"link":"exiled"');
  });
  it('an exile cost on the face does too', () => {
    const f = creature(`${ASSIM}\nExile a card from your hand: ~ gets +1/+1 until end of turn.`);
    expect(fullyAutomated(f)).toBe(false);
  });
  it('a card exiled face down has no characteristics (CR 406.3a): a choice among the cards exiled with it by type would see them all, so that exile is never read here (Scarlet Witch, review finding 1)', () => {
    const down = creature('Whenever ~ attacks, exile the top two cards of your library face down. Then you may cast a noncreature spell from among cards exiled with ~ without paying its mana cost.');
    expect(fullyAutomated(down)).toBe(false);
    expect(JSON.stringify(down.abilities)).not.toContain('"link":"exiled"');
    // the same ability with the cards exiled face up is understood: they have their characteristics
    const up = creature('Whenever ~ attacks, exile the top two cards of your library. Then you may cast a noncreature spell from among cards exiled with ~ without paying its mana cost.');
    expect(fullyAutomated(up), JSON.stringify(up.diagnostics)).toBe(true);
  });
  it('"the exiled card" read by the ability that exiles is still never linked (the older rule stands)', () => {
    const f = creature('When ~ enters, exile target creature. Return the exiled card to the battlefield under its owner\'s control at the beginning of the next end step.');
    expect(JSON.stringify(f.abilities)).not.toContain('"link":"exiled"');
  });
  it('"If you can\'t" after an assimilate reads whether a card was assimilated; after anything else but a move it is still not read', () => {
    const f = creature(ASSIM);
    expect(JSON.stringify(f.abilities)).toMatch(/"action":"assimilate".*"as":"did".*"cond":"did","step":"did","not":true/);
    const g = creature("Whenever ~ attacks, draw a card. If you can't, exile up to one target creature.");
    expect(fullyAutomated(g)).toBe(false);
  });
});

// ---- the counters you put this way ----------------------------------------------------------------------------------------------------------------------

describe('trek-6 holes and lowering (parser/holes/cond.ts#countersPutThisWay, lower/conditions.ts#resolveCountersPut): "if you put N or more <kind> counters on <nouns> this way"', () => {
  const act = (rest: string) => creature(`{1}, {T}: Put a +1/+1 counter on each creature you control that entered this turn. ${rest}`);
  it('reads the counters the instruction right before it put, of that kind', () => {
    const f = act('If you put two or more +1/+1 counters on creatures this way, draw a card.');
    expect(fullyAutomated(f), JSON.stringify(f.diagnostics)).toBe(true);
    expect(JSON.stringify(f.abilities)).toMatch(/"as":"put".*"left":\{"q":"countersPut","step":"put","kind":"\+1\/\+1"\},"op":">=","right":2/);
    const g = act('If you put one or more +1/+1 counters on creatures this way, draw a card.');
    expect(fullyAutomated(g), JSON.stringify(g.diagnostics)).toBe(true);
    const h = act('If you put three or more counters on creatures this way, draw a card.');
    expect(fullyAutomated(h), JSON.stringify(h.diagnostics)).toBe(true);
  });
  it('the objects named must be what the instruction put them on (the render gate says them from the instruction)', () => {
    expect(fullyAutomated(act('If you put two or more +1/+1 counters on lands this way, draw a card.'))).toBe(false);
    expect(fullyAutomated(act('If you put two or more +1/+1 counters on permanents this way, draw a card.'))).toBe(false); // true of every creature, but not how Oracle says it: only the narrowest noun is read
  });
  it('a kind that is not the kind put, or an instruction that puts nothing, leaves the sentence manual', () => {
    expect(fullyAutomated(act('If you put two or more -1/-1 counters on creatures this way, draw a card.'))).toBe(false);
    const f = creature('{1}, {T}: Draw a card. If you put two or more +1/+1 counters on creatures this way, draw a card.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('counters put on a target have no named group to say: the gate refuses the sentence', () => {
    const f = creature('{1}, {T}: Put a +1/+1 counter on target creature. If you put two or more +1/+1 counters on creatures this way, draw a card.');
    expect(fullyAutomated(f)).toBe(false);
  });
  it('a count of nothing, or "up to", is not read', () => {
    expect(fullyAutomated(act('If you put no +1/+1 counters on creatures this way, draw a card.'))).toBe(false);
  });
});

// ---- the renderer's readings ------------------------------------------------------------------------------------------------------------------------------

describe('trek-6 renderer: "a historic permanent you control" and "put twice that many ... on that <permanent> instead"', () => {
  const gated = (text: string) => { const f = creature(text); return fullyAutomated(f) && f.gate.every((g) => g.ok); };
  it('CR 700.6 (render/np.ts): one historic permanent after "a" or "another", with its controller and mana value', () => {
    expect(gated('Whenever a historic permanent you control enters, draw a card.')).toBe(true);
    expect(gated('Whenever another historic permanent you control with mana value 3 or greater enters, draw a card.')).toBe(true);
    expect(gated('Whenever another historic permanent enters, draw a card.')).toBe(true);
  });
  it('the other determiners keep their readings, and a near miss is refused', () => {
    expect(gated('Whenever you cast a historic spell, draw a card.')).toBe(true);
    expect(gated('Other historic permanents you control have hexproof.')).toBe(true);
    expect(gated('Whenever another artifact or legendary permanent you control enters, draw a card.')).toBe(false); // not "historic" (the Saga option is missing)
    expect(gated('Whenever another historic permanent an opponent controls enters, draw a card.')).toBe(true); // a different filter, still read as written
  });
  it('CR 614.1a, 122.6 (render/stat.ts): the object said again is "it", "that permanent" or "that <its card type>", and only that', () => {
    const w = (to: string) => gated(`If you would put one or more charge counters on an artifact you control, put twice that many charge counters on ${to} instead.`);
    expect(w('that artifact')).toBe(true);
    expect(w('that permanent')).toBe(true);
    expect(w('it')).toBe(true);
    expect(w('that creature')).toBe(false); // the filter is an artifact
    const e = (to: string) => gated(`If you would put one or more counters on a creature you control, put twice that many of each of those kinds of counters on ${to} instead.`);
    expect(e('that creature')).toBe(true);
    expect(e('that permanent')).toBe(true);
    expect(e('that artifact')).toBe(false);
  });
  it('a creature or an artifact is one permanent of either type: only "that permanent" repeats it', () => {
    const e = (to: string) => gated(`If you would put one or more counters on a creature or artifact you control, put twice that many of each of those kinds of counters on ${to} instead.`);
    expect(e('that permanent')).toBe(true);
    expect(e('that creature')).toBe(false);
  });
});

describe('trek-6 engine capabilities (effects/eval.ts, effects/handlers/counters.ts): registered by the code that honors them', () => {
  it('`q:countersPut` is an engine capability, and so is the action assimilate it reads', () => {
    expect(ENGINE_CAPABILITIES.has('q:countersPut')).toBe(true);
    expect(ENGINE_CAPABILITIES.has('action:assimilate')).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('trek-6 review finding 1 (local index): Scarlet Witch, Chaotic Avenger stays partial', () => {
  it('her trigger exiles the cards face down and chooses among them by type: not understood in full (as on a0b319ba)', () => {
    const c = (index ?? []).find((x) => x.name === 'Scarlet Witch, Chaotic Avenger');
    expect(c).toBeDefined();
    const f = parseCard(c!, OPTS).faces[0]!;
    expect(fullyAutomated(f)).toBe(false);
    expect(f.abilities.some((a) => a.kind === 'triggered')).toBe(true);
    expect(JSON.stringify(f.abilities)).not.toContain('"link":"exiled"');
  });
});

describe.skipIf(index === null)('trek-6 design 6.10 (local index): synthetic examples', () => {
  it('no trek-6 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
    const lines = new Set<string>();
    for (const c of index ?? []) {
      for (const text of [c.oracle_text, ...(c.card_faces ?? []).map((x) => x.oracle_text)]) {
        if (typeof text !== 'string') continue;
        for (const l of text.split('\n')) {
          lines.add(l.trim());
          lines.add(l.replaceAll(c.name, '~').replace(/\bthis (creature|land|artifact|enchantment|Aura|spell|card|Equipment|Spacecraft)\b/gi, '~').trim());
        }
      }
    }
    const verbatim = MECH.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
