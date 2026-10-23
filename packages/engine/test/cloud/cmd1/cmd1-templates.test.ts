/**
 * Commander batch, slice cmd1 (partner variants and Backgrounds, CR 702.124): the template data of parser/templates/zz-cloud/cmd1.json and the keyword, lowering
 * and renderer support they needed. Guard G9 (design 6.8): every example lowers with its template, is automated and passes the exact render gate (G6); every
 * counter-example does not parse or parses to different JSON; near-miss mutations fail or differ; a nonsense word in place of any word of an example never leaves an
 * automated card (G2). Examples are synthetic wordings (design 6.10), checked against the local index when it is present. The behavior is in cmd1-scenarios.test.ts
 * and cmd1-attack-scenarios.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { OracleCard } from '../../../src/index';
import type { Template } from '../../../src/parser/types';
import { defaultParseOptions, parseCard } from '../../../src/parser/parse';
import { validateTemplates } from '../../../src/parser/chart';
import { TEMPLATE_FILES, TEMPLATE_SET } from '../../../src/parser/template-set';
import { ENGINE_CAPABILITIES } from '../../../src/model/capabilities';
import { keywordRegistry } from '../../../src/keywords/registry';
import cmd1 from '../../../src/parser/templates/zz-cloud/cmd1.json';
import { automated, bare, card, fullyAutomated, jsonKey } from '../../m5/templates/support';
import { localIndex } from '../../m5/parser/support';

const CMD1 = cmd1 as Template[];
const OPTS = defaultParseOptions({ templates: [...TEMPLATE_SET], capabilities: ENGINE_CAPABILITIES }); // what a decklist card gets (design 5.2; `needs`)

/** A synthetic card in which an example is an ability of the right kind: a spell on a sorcery, any other ability on a creature. */
function exampleCard(t: Template, text: string): OracleCard {
  if (t.kind === 'effect' && !text.includes(':') && !/^(When|Whenever|At)\b/.test(text) && !text.includes('\n')) return card('Example Volley', 'Sorcery', text);
  return card('Example Brute', 'Creature — Elf Warrior', text, { power: '3', toughness: '3' });
}
const parsedWith = (t: Template, text: string) => parseCard(exampleCard(t, text), OPTS).faces[0]!;
const face = (type: string, text: string) => parseCard(card('Example Brute', type, text, { power: '3', toughness: '3' }), OPTS).faces[0]!;

describe('cmd1 template file (design 6.3, 6.9; CONTRIBUTING "Adding a template")', () => {
  it('is loaded by the default compiler (zz-cloud/cmd1.json, after trigger.json, before zz-fast1/) and its ids are unique in the whole set', () => {
    const files = TEMPLATE_FILES.map((f) => f.file);
    expect(files).toContain('zz-cloud/cmd1.json');
    expect(files.indexOf('zz-cloud/cmd1.json')).toBeGreaterThan(files.indexOf('trigger.json'));
    expect(files.indexOf('zz-cloud/cmd1.json')).toBeLessThan(files.findIndex((f) => f.startsWith('zz-fast1/')));
    const ids = TEMPLATE_SET.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateTemplates([...TEMPLATE_SET])).toEqual([]);
  });
  it('design 6.9: every template cites rules, has at least two examples and two counter-examples, starts experimental (one promoted since), and is of version 8; ids are *.cmd1.*', () => {
    expect(CMD1.length).toBe(9);
    for (const t of CMD1) {
      expect(t.id, t.id).toMatch(/^(eff|trg|sta|rep|kw)\.cmd1\./);
      expect(t.cr.length, t.id).toBeGreaterThan(0);
      for (const cr of t.cr) expect(cr, t.id).toMatch(/^CR \d{3}(\.\d+[a-z]?)?$/);
      expect(t.examples.length, t.id).toBeGreaterThanOrEqual(2);
      expect(t.counterExamples.length, t.id).toBeGreaterThanOrEqual(2);
      // std-rx33 promoted sta.cmd1.self.pump.whereX on three tuning-half golden cards (Criminal Past, Greven, Predator Captain, Carrion Grub:
      // test/m5/golden/cards/cloud-std-rx33-review.json, checked in test/cloud/std-rx33/std-rx33-templates.test.ts); the others have no evidence yet (design 6.9)
      expect(t.status, t.id).toBe(t.id === 'sta.cmd1.self.pump.whereX' ? 'stable' : 'experimental');
      expect(t.since, t.id).toBe(8);
    }
  });
  it('guard G3: a critical word a pattern spells out is listed in `consumes`', () => {
    for (const t of CMD1) {
      const words = t.pattern.toLowerCase().replace(/\{[^}]*:[^}]*\}/g, ' ').split(/[^a-z']+/).filter(Boolean);
      for (const w of ['all', 'each', 'another', 'other', 'may', 'if', 'unless', 'until', 'instead', 'only', 'chosen', 'additional', 'except', "can't", 'would', 'next', 'then']) {
        if (words.includes(w)) expect(t.consumes ?? [], `${t.id}: ${w}`).toContain(w);
      }
    }
  });
});

describe('cmd1 guard G9 (design 6.8): examples and counter-examples', () => {
  for (const t of CMD1) {
    it(`${t.id} (${t.cr.join(', ')}): every example parses with it, is automated and passes the render gate; counter-examples do not give the same JSON`, () => {
      const first = parsedWith(t, t.examples[0]!.text);
      for (const e of t.examples) {
        const f = parsedWith(t, e.text);
        expect(f.templatesUsed, `${e.text}: ${f.templatesUsed.join(', ')}`).toContain(t.id);
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
  const out = [`${body} unless it is blue.`, `${body} instead.`, `${body} at random.`, `${body} twice.`, `${body} if able.`];
  const swaps: [RegExp, string][] = [
    [/\bonce for each\b/, 'twice for each'], [/\btapped\b/, 'untapped'], [/\buntil end of turn\b/, 'until your next turn'], [/\badditional\b/, 'extra'],
    [/\bgets \+X\/\+0\b/, 'gets +0/+X'], [/\banother card\b/, 'two cards'], [/\bother colors and types\b/, 'other types'], [/\btarget opponent\b/, 'each opponent'],
  ];
  for (const [re, by] of swaps) if (re.test(text)) out.push(text.replace(re, by));
  return out;
}

describe('cmd1 guard G9 (design 6.8): near-miss mutations fail or differ', () => {
  for (const t of CMD1) {
    it(`${t.id}: an appended "unless/instead/at random/twice/if able" or a swapped key word never gives the example's JSON`, () => {
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

describe('cmd1 guard G2 (design 6.8): a nonsense word never leaves an automated card', () => {
  for (const t of CMD1) {
    it(`${t.id}: replacing any one word of an example by an invented word makes the card not fully automated`, () => {
      for (const e of t.examples) {
        const words = e.text.split(' ');
        words.forEach((w, i) => {
          if (w === '~' || w === '~.' || /^"?\{/.test(w) || w.includes('\n')) return;
          // counter names are an open class (design 6.11, CR 122.1): "N <word> counters" accepts any word as the kind
          if (/^counters?[.,]?$/.test(words[i + 1] ?? '')) return;
          const end = w.match(/[.,"]+$/)?.[0] ?? '';
          const mutated = [...words.slice(0, i), `blorfty${end}`, ...words.slice(i + 1)].join(' ');
          expect(fullyAutomated(parsedWith(t, mutated)), mutated).toBe(false);
        });
      }
    });
  }
});

describe('cmd1 partner variants (CR 702.124a): keywords with no game effect', () => {
  it('CR 702.124k, 702.124m: "choose a background" and "doctor\'s companion" are keywords of the library with no mechanism (as partner), so nothing in a game reads them', () => {
    for (const name of ['choose a background', "doctor's companion", 'partner']) {
      const d = keywordRegistry.get(name)!;
      expect(d.rule, name).toBe('702.124');
      expect(d.mechanisms, name).toEqual([]);
      expect(d.status, name).toBe('implemented');
      expect(ENGINE_CAPABILITIES.has(`keyword:${name}`), name).toBe(true);
    }
  });
  it('CR 702.124m: the possessive keyword name is read as the tokenizer splits it ("doctor", "\'s", "companion"), and rendered with its apostrophe', () => {
    const f = face('Legendary Creature — Human', "Doctor's companion (You can have two commanders if the other is the Doctor.)");
    expect(fullyAutomated(f)).toBe(true);
    expect(f.abilities[0]).toMatchObject({ kind: 'keyword', keyword: "doctor's companion" });
  });
  it('CR 702.124i: "Partner--[text]" is the partner keyword with its text as a label, one of the printed variants (a closed list, guard G2)', () => {
    for (const [line, text] of [['Partner—Friends forever', 'friends forever'], ['Partner—Character select', 'character select'], ['Partner—Survivors', 'survivors'], ['Partner—Father & son', 'father & son']] as const) {
      const f = face('Legendary Creature — Human', `${line} (You can have two commanders if both have this ability.)`);
      expect(fullyAutomated(f), line).toBe(true);
      expect(f.abilities[0], line).toMatchObject({ kind: 'keyword', keyword: 'partner', quality: text });
    }
    // only on a keyword line of its own, never in a list of granted abilities, and only words after the dash
    expect(fullyAutomated(face('Creature — Elf', 'Creatures you control have partner—friends forever.'))).toBe(false);
    expect(fullyAutomated(face('Legendary Creature — Human', 'Partner—{2}'))).toBe(false);
    expect(fullyAutomated(face('Legendary Creature — Human', 'Partner—& son'))).toBe(false);
    // wave-4 review (guard G2): a label Oracle does not print is not understood, with or without its reminder text
    expect(fullyAutomated(face('Legendary Creature — Human', 'Partner—Blorfty forever (You can have two commanders if both have this ability.)'))).toBe(false);
    expect(fullyAutomated(face('Legendary Creature — Human', 'Partner—Friends blorfty'))).toBe(false);
    // plain partner is unchanged (CR 702.124h)
    expect(face('Legendary Creature — Human', 'Partner').abilities[0]).toMatchObject({ kind: 'keyword', keyword: 'partner' });
    expect(JSON.stringify(face('Legendary Creature — Human', 'Partner').abilities[0])).not.toContain('quality');
  });
});

describe('cmd1 quoted (granted) abilities', () => {
  it('CR 603.4: an intervening "if" in a quoted trigger is the granted ability\'s interveningIf, with its pronouns bound to the event (the attacked player)', () => {
    const f = face('Legendary Enchantment — Background', 'Commander creatures you own have "Whenever this creature attacks a player, if no opponent has more life than that player, you create two Treasure tokens."');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"than":{"ref":"event","role":"defender"}');
  });
  it('CR 603.2h: "This ability triggers only once each turn." inside the quotes is the granted trigger\'s limit; another restriction keeps it manual', () => {
    const ok = face('Enchantment', 'Creatures you control have "Whenever you cast a spell that shares a creature type with this creature, draw a card. This ability triggers only once each turn."');
    expect(fullyAutomated(ok)).toBe(true);
    expect(JSON.stringify(ok.abilities)).toContain('"limit":{"per":"turn","max":1}');
    expect(fullyAutomated(face('Enchantment', 'Creatures you control have "Whenever this creature attacks, draw a card. This ability triggers only during your turn."'))).toBe(false);
  });
  it('CR 113.1c, 109.2: inside the quotes "another target creature" is other than the creature that has the ability, even on an enchantment that prints it', () => {
    const f = face('Legendary Enchantment — Background', 'Commander creatures you own have "Whenever this creature attacks, another target creature you control gets +2/+2 until end of turn."');
    expect(fullyAutomated(f)).toBe(true);
    // a quote whose own object is a land is not a creature's ability: "another target creature" there still says nothing it can exclude
    expect(fullyAutomated(face('Enchantment', 'Lands you control have "{T}: Another target creature gets +1/+1 until end of turn."'))).toBe(false);
  });
  it('CR 702.21a: a ward keyword with a dash cost is quoted in a list of granted abilities ("Ward--Pay 3 life,")', () => {
    const f = face('Legendary Enchantment — Background', 'Commander creatures you own get +1/+1 and have menace, "Ward—Pay 2 life," and "At the beginning of your upkeep, draw a card."');
    expect(fullyAutomated(f)).toBe(true);
  });
});

describe('cmd1 lowering and renderer support', () => {
  it('CR 201.5: "~ deals 1 damage to target creature. Tap that creature." names the target ("that creature" is never ~ while it has not moved)', () => {
    expect(fullyAutomated(face('Creature — Human', '{T}: ~ deals 1 damage to target creature. Tap that creature.'))).toBe(true);
  });
  it('CR 508.1, 109.5: in "Whenever ~ attacks a player", "that player" is the defending player (the attacking player is "you")', () => {
    const f = face('Creature — Human', 'Whenever ~ attacks a player, that player loses 1 life.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"who":{"ref":"event","role":"defender"}');
  });
  it('CR 608.2f: inside "for each opponent, ..." "that opponent" is the opponent of the iteration, even after another player was named', () => {
    const f = face('Creature — Human', "Whenever ~ attacks a player, for each opponent, create a 1/1 white Soldier creature token that's tapped and attacking that opponent.");
    expect(automated(f.abilities)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"attacking":{"defender":{"ref":"bound","name":"each"}}');
  });
  it('CR 701.21a: "Sacrifice another creature or an artifact" is one sacrifice of either; "Sacrifice a creature or an artifact" too', () => {
    const f = face('Creature — Human', '{1}, Sacrifice another creature or an artifact: Draw a card.');
    expect(fullyAutomated(f)).toBe(true);
    expect(JSON.stringify(f.abilities)).toContain('"filter":{"anyOf":[{"types":["Creature"],"other":true},{"types":["Artifact"]}]}');
  });
  it('CR 406.1: "cast a spell from exile" names exile without an article', () => {
    expect(fullyAutomated(face('Creature — Human', 'Whenever you cast a spell from exile, draw a card.'))).toBe(true);
  });
});

const index = localIndex();

describe.skipIf(index === null)('cmd1 design 6.10 (local index): synthetic examples', () => {
  it('no cmd1 line of an example or counter-example is a line of a real card (with the card\'s own name or "this <type>" read as "~")', () => {
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
    // a bare keyword line ("Trample") is a rules term, not card text (as test/m5/templates/templates.test.ts#verbatim reads it)
    const verbatim = CMD1.flatMap((t) => [...t.examples.map((e) => e.text), ...t.counterExamples].filter((x) => x.split('\n').some((l) => l.trim().includes(' ') && lines.has(l.trim()))).map((x) => `${t.id}: ${x}`));
    expect(verbatim).toEqual([]);
  }, 120_000);
});
