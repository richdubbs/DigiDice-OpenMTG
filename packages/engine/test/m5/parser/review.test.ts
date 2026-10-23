/**
 * WP5 review fixes: each test is named after the rule it protects and was written before the fix (failing first). Wording is synthetic (design 6.10): the
 * SHAPES are the ones real Oracle text has (alternative costs, conditional cost changes, delayed triggers of a resolving spell), the words are invented.
 * The corpus guards at the end read the local Oracle index and are skipped when it is absent.
 */
import { describe, expect, it } from 'vitest';
import { ledgerProblems, normalizeText, originalRange, selfExtents } from '../../../src/parser/preprocess';
import type { AbilitySegment, SegmentedFace } from '../../../src/parser/segment';
import { tokenNorms, tokenize, type Token } from '../../../src/parser/tokenize';
import { SLOW, slowTitle } from '../../slow';
import { face, faceContexts, localIndex, segment } from './support';

const synth = (typeLine: string, text: string, name = 'Test Card'): SegmentedFace => segment(face(name, typeLine, text));
const shapes = (f: SegmentedFace): string[] => f.abilities.map((a) => a.shape);
const flags = (f: SegmentedFace): boolean[] => f.abilities.map((a) => a.spellStatic === true);

/** Every token of an ability, quoted sub-streams included. */
function tokensOf(a: AbilitySegment): Token[] {
  const out: Token[] = [];
  const walk = (ts: readonly Token[]): void => {
    for (const t of ts) {
      out.push(t);
      if (t.sub) walk(t.sub);
    }
  };
  for (const s of a.sentences) walk(s.tokens);
  for (const m of a.modal?.modes ?? []) for (const s of m.sentences) walk(s.tokens);
  for (const r of a.rollTable ?? []) {
    for (const s of r.sentences) walk(s.tokens);
    for (const m of r.more ?? []) for (const s of m.sentences) walk(s.tokens);
  }
  for (const k of a.keywordItems ?? []) walk(k.tokens);
  for (const c of a.children ?? []) out.push(...tokensOf(c));
  return out;
}

describe('CR 118.9, 601.2b, 113.6, 101.2: statics that work on the stack are not part of the spell ability (design 6.2 row 10)', () => {
  it('an alternative cost with a condition or a cost of its own is a static form (Force of Will / Daze / Trap shapes)', () => {
    const f = synth(
      'Instant',
      "You may pay 1 life and exile a blue card from your hand rather than pay this spell's mana cost.\nCounter target spell.\nIf an opponent searched their library this turn, you may pay {0} rather than pay this spell's mana cost.",
    );
    expect(shapes(f)).toEqual(['static', 'spell', 'static']);
    expect(flags(f)).toEqual([true, false, true]);
    expect(f.abilities[1]!.lines).toEqual([1]);
  });

  it('a Plains-discard alternative cost above the effect (Abolish shape) leaves the effect alone as the spell ability', () => {
    const f = synth('Instant', "You may discard a Plains card rather than pay this spell's mana cost.\nDestroy target artifact or enchantment.");
    expect(shapes(f)).toEqual(['static', 'spell']);
    expect(f.abilities[1]!.sentences.map((s) => tokenNorms(s.tokens))).toEqual(['destroy target artifact or enchantment .']);
  });

  it("a condition before the cost change: \"During your turn, this spell costs {2}{U} less to cast.\" (Discontinuity shape)", () => {
    const f = synth('Instant', 'During your turn, this spell costs {2}{U}{U} less to cast.\nCounter target spell.');
    expect(shapes(f)).toEqual(['static', 'spell']);
  });

  it('"If X is 5 or more, this spell can\'t be countered and the damage can\'t be prevented." (Banefire shape)', () => {
    const f = synth('Sorcery', "Test Card deals X damage to any target.\nIf X is 5 or more, this spell can't be countered and the damage can't be prevented.");
    expect(shapes(f)).toEqual(['spell', 'static']);
    expect(flags(f)).toEqual([false, true]);
  });

  it('"If ..., you may cast this spell without paying its mana cost." (Deadly Rollick shape)', () => {
    const f = synth('Instant', 'If you control a Bear, you may cast this spell without paying its mana cost.\nDestroy target creature.');
    expect(shapes(f)).toEqual(['static', 'spell']);
  });

  it('CR 113.6: "~ has flash as long as ...", "~ is colorless" and "you may cast ~ as though it had flash" stay out of the spell ability', () => {
    const f = synth(
      'Instant',
      'This spell has flash as long as you control a Merfolk.\nThis spell is colorless.\nYou may cast this spell as though it had flash.\nThis spell is all colors.\nDraw a card.',
    );
    expect(shapes(f)).toEqual(['static', 'static', 'static', 'static', 'spell']);
  });

  it('effects that only talk about other spells are not static forms (Quicken shape, a counter that costs mana)', () => {
    const f = synth(
      'Instant',
      'The next sorcery spell you cast this turn can be cast as though it had flash.\nYou may cast target card from your graveyard rather than pay its mana cost.\nCounter target spell unless its controller pays {1}.',
    );
    expect(shapes(f)).toEqual(['spell']);
    expect(f.abilities[0]!.lines).toEqual([0, 1, 2]);
  });

  it('on a permanent the same lines are plain static abilities and no spellStatic flag is set', () => {
    const f = synth('Creature — Bear', "You may pay {1} rather than pay this spell's mana cost.");
    expect(shapes(f)).toEqual(['static']);
    expect(flags(f)).toEqual([false]);
  });
});

describe('CR 603.7, 113.3a, 608.2: a trigger that the spell itself creates is part of the spell ability (design 6.2 rows 8 and 10)', () => {
  it('Pact shape: the delayed "At the beginning of your next upkeep" line belongs to the one spell ability', () => {
    const f = synth('Instant', "Counter target spell.\nAt the beginning of your next upkeep, pay {3}{U}{U}. If you don't, you lose the game.");
    expect(shapes(f)).toEqual(['spell']);
    expect(f.abilities[0]!.lines).toEqual([0, 1]);
  });

  it('"When you next cast an instant or sorcery spell this turn, copy that spell." alone is a spell ability, not a trigger', () => {
    const f = synth('Instant', 'When you next cast an instant or sorcery spell this turn, copy that spell. You may choose new targets for the copy.');
    expect(shapes(f)).toEqual(['spell']);
  });

  it('"Whenever a creature blocks this turn, it gets +0/+1" after an effect line (Battle Cry shape)', () => {
    const f = synth('Instant', 'Creatures you control get +1/+0 until end of turn.\nWhenever a creature blocks this turn, it gets +0/+1 until end of turn.');
    expect(shapes(f)).toEqual(['spell']);
  });

  it('"This combat" and "next end step" delay the same way', () => {
    expect(shapes(synth('Sorcery', 'Whenever a creature deals combat damage this combat, draw a card.'))).toEqual(['spell']);
    expect(shapes(synth('Sorcery', 'Exile target creature.\nAt the beginning of the next end step, return it to the battlefield.'))).toEqual(['spell']);
  });

  it('CR 603.2: a trigger that functions outside the stack stays a triggered ability', () => {
    const f = synth('Instant', 'When you cast this spell, draw a card.\nWhenever you discard a card, gain 1 life.\nDestroy target creature.');
    expect(shapes(f)).toEqual(['triggered', 'triggered', 'spell']);
  });

  it('a permanent keeps its trigger even when it mentions this turn after the comma', () => {
    const f = synth('Enchantment', 'Whenever you cast a spell, it gains flash this turn.\nAt the beginning of your next upkeep, draw a card.');
    expect(shapes(f)).toEqual(['triggered', 'triggered']);
  });
});

describe('structure ranges stop at the first character of the card name (design 6.2 step 7, the SELF contract)', () => {
  const ownStructure = (f: SegmentedFace): string[] => f.ledger.filter((e) => e.status === 'structure').map((e) => f.pre.normalized.slice(...e.range));

  function checkSelf(f: SegmentedFace): void {
    const labelled = f.ledger.filter((e) => e.status === 'label' || e.status === 'reminder');
    const tokens = f.abilities.flatMap(tokensOf).filter((t) => t.kind === 'SELF');
    for (const r of f.pre.selfRefs) {
      if (labelled.some((e) => e.range[0] < r.range[1] && e.range[1] > r.range[0])) continue;
      expect(tokens.some((t) => t.range[0] === r.range[0] && t.range[1] === r.range[1]), `SELF token for ${JSON.stringify(r.text)}`).toBe(true);
      for (const e of f.ledger) {
        if (e.status === 'structure') expect(e.range[1] <= r.range[0] || e.range[0] >= r.range[1], `structure ${JSON.stringify(f.pre.normalized.slice(...e.range))} overlaps ${r.text}`).toBe(true);
      }
    }
    expect(ledgerProblems(f.pre.normalized, f.ledger)).toEqual([]);
  }

  it('CR 606.4: a loyalty cost is "+2:" and the name after it stays whole', () => {
    const f = synth('Legendary Planeswalker — Testwalker', '+2: Test Card deals 1 damage to any target.\n-3: Draw a card.', 'Test Card');
    expect(ownStructure(f)).toEqual(['+2:', '-3:']);
    checkSelf(f);
  });

  it('CR 714.2: a chapter numeral is "I --" and "This Saga" after it stays whole', () => {
    const f = synth('Enchantment — Saga', 'I -- This Saga deals 1 damage to each creature.\nII, III -- Draw a card.');
    expect(ownStructure(f)).toEqual(['I --', 'II, III --']);
    checkSelf(f);
  });

  it('CR 706.2: a die-roll row prefix is "1-9 |" and the name after it stays whole', () => {
    const f = synth('Creature — Bear', 'When ~ enters, roll a d20.\n1-9 | Test Card gets +1/+1 until end of turn.\n10-20 | Draw a card.');
    expect(ownStructure(f)).toEqual(['1-9 |', '10-20 |']);
    checkSelf(f);
  });

  it('CR 700.2: a bullet and the name after it', () => {
    const f = synth('Instant', 'Choose one --\n• Test Card deals 3 damage to any target.\n• Draw a card.');
    expect(ownStructure(f)).toEqual(['•', '•']);
    checkSelf(f);
  });

  it('CR 702.172: a Spree line "+ {1} --" and the name after it', () => {
    const f = synth('Instant', 'Spree\n+ {1} -- Test Card deals 2 damage to any target.');
    expect(ownStructure(f)).toEqual(['+', '--']);
    checkSelf(f);
  });

  it('a self reference at the start of a line is a SELF token over the whole name', () => {
    const f = synth('Creature — Bear', 'Test Card gets +1/+1 as long as you control a Bear.\nWhenever Test Card attacks, it gets +1/+1.');
    checkSelf(f);
  });
});

describe('CR 107.4: a brace group is a MANA token only when it is a mana symbol of the rules (guard G2)', () => {
  const bad = ['{ZZ}', '{TK}', '{CHAOS}', '{L}', '{H}', '{D}', '{P}', '{W/W}', '{2/2}', '{W/U/B}', '{C/P}', '{PW}'];

  it.each(bad)('%s is an ERR, never a mana symbol', (sym) => {
    const [t] = tokenize(sym);
    expect(t!.kind).toBe('ERR');
    expect(t!.reason).toMatch(/symbol/);
  });

  it('every symbol family of CR 107.4 is still MANA: numbers, colors, hybrid, monocolored hybrid, Phyrexian, hybrid Phyrexian, snow, X, Y, energy', () => {
    const ok = ['{0}', '{1}', '{15}', '{W}', '{U}', '{B}', '{R}', '{G}', '{C}', '{X}', '{Y}', '{S}', '{E}', '{W/U}', '{G/U}', '{R/W}', '{2/W}', '{2/G}', '{C/W}', '{C/G}', '{W/P}', '{G/P}', '{W/U/P}', '{G/U/P}'];
    for (const sym of ok) expect(tokenize(sym).map((t) => t.kind), sym).toEqual(['MANA']);
  });

  it('a bad symbol inside a granted ability is reported by the segmenter', () => {
    const f = synth('Instant', 'Target creature gains "{ZZ}: Draw a card." until end of turn.');
    expect(f.diagnostics.map((d) => d.message)).toEqual(['unknown symbol {ZZ}']);
  });
});

describe('normalizeText: one offset per UTF-16 code unit (the contract "offsets[i] belongs to text[i]")', () => {
  it('an astral character does not shift the offsets after it', () => {
    const original = 'a\u{1F600}b c';
    const { text, offsets } = normalizeText(original);
    expect(offsets).toHaveLength(text.length + 1);
    const b = text.indexOf('b');
    expect(originalRange(offsets, [b, b + 1])).toEqual([3, 4]);
    expect(original.slice(...originalRange(offsets, [b, b + 3]))).toBe('b c');
  });

  it('holds for any mix of astral characters, dashes and spaces (property)', () => {
    const pieces = ['a', ' ', '  ', '\u{1F600}', '—', '\n', ' ', 'ö', '\u{10348}', '‘'];
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let k = 0; k < 300; k++) {
      let s = '';
      for (let i = rnd(12); i > 0; i--) s += pieces[rnd(pieces.length)];
      const { text, offsets } = normalizeText(s);
      expect(offsets, JSON.stringify(s)).toHaveLength(text.length + 1);
      expect(offsets[text.length]).toBe(s.length);
      for (let i = 1; i < offsets.length; i++) expect(offsets[i]! >= offsets[i - 1]!, JSON.stringify(s)).toBe(true);
    }
  });
});

describe('CR 201.2: names are compared as normalized text (a name with a dash, a curly quote or a no-break space)', () => {
  it('a face name with an em dash is replaced by "~" in the normalized text', () => {
    const f = synth('Phenomenon', 'When you encounter Human—Time Lord Meta-Crisis, draw a card.', 'Human—Time Lord Meta-Crisis');
    expect(f.pre.selfRefs.map((r) => r.via)).toEqual(['name']);
    expect(f.abilities[0]!.text).toBe('When you encounter ~, draw a card.');
  });

  it('a curly apostrophe or a no-break space in the name is normalized the same way as the text', () => {
    const f = synth('Creature — Bear', 'Whenever Bear’s Den attacks, draw a card.', 'Bear’s Den');
    expect(f.pre.selfRefs).toHaveLength(1);
    const g = synth('Creature — Bear', 'Whenever Test Card attacks, draw a card.', 'Test Card');
    expect(g.pre.selfRefs).toHaveLength(1);
  });

  it('the names of the other faces are normalized too (CR 201.5b)', () => {
    const ctx = face('Front Face', 'Creature — Bear', 'Transform Back—Face when you draw.', { otherNames: ['Back—Face'] });
    expect(segment(ctx).pre.selfRefs.map((r) => r.via)).toEqual(['other-face']);
  });
});

describe('the comma-name index follows the name set it is given (pure: no hidden call history)', () => {
  it('names added to the same Set between calls are seen by the next call', () => {
    const names = new Set(['Alpha, the First']);
    const text = 'Meld them into Beta, the Second now.';
    expect(tokenNorms(tokenize(text, { cardNames: names }))).toBe('meld them into beta , the second now .');
    names.add('Beta, the Second');
    expect(tokenNorms(tokenize(text, { cardNames: names }))).toBe('meld them into Beta, the Second now .');
    expect(tokenNorms(tokenize(text, { cardNames: new Set(names) }))).toBe('meld them into Beta, the Second now .');
  });
});

describe('nested single quotes: a plural possessive is an apostrophe, not a closing quote', () => {
  it("opponents' and players' inside a nested ability (latent: no card has it yet)", () => {
    const text = `Target creature gains "{T}: Exile target card from your opponents' graveyards. 'Sacrifice this: players' hands are shuffled.' Draw a card." until end of turn.`;
    const t = tokenize(text);
    const quote = t.find((x) => x.kind === 'QUOTE')!;
    expect(t.some((x) => x.kind === 'ERR')).toBe(false);
    const norms = tokenNorms(quote.sub!);
    expect(norms).toContain("opponents'");
    expect(norms).toContain("players'");
    const nested = quote.sub!.find((x) => x.kind === 'QUOTE')!;
    expect(tokenNorms(nested.sub!)).toBe("sacrifice this : players' hands are shuffled .");
    expect(tokenNorms(quote.sub!.slice(quote.sub!.indexOf(nested) + 1))).toBe('draw a card .');
  });

  it('a nested quote that really ends in a plural still closes', () => {
    const t = tokenize(`Creatures gain "Whenever this attacks, target player gains 'Draw two cards' now." until end of turn.`);
    const quote = t.find((x) => x.kind === 'QUOTE')!;
    expect(quote.sub!.some((x) => x.kind === 'QUOTE')).toBe(true);
  });
});

describe('CR 114: "this emblem" inside a quoted ability is the emblem', () => {
  it('a quoted ability that sacrifices "this emblem" gets a self reference', () => {
    const f = synth('Instant', 'You get an emblem with "At the beginning of your upkeep, this emblem deals 1 damage to each opponent."');
    expect(f.pre.selfRefs.map((r) => [r.via, r.scope, r.text])).toEqual([['this-noun', 'quote', 'this emblem']]);
  });
});

const refs = (f: SegmentedFace): string[] => f.pre.selfRefs.map((r) => `${r.via}:${r.text}`);

describe('CR 201.5c: a card is known by a shortened name (legendary cards and planeswalkers; other cards by the part before a comma)', () => {
  it('"Acererak the Archlich" is "Acererak": the part before " the "', () => {
    const f = synth('Legendary Creature — Lich', 'When Acererak enters, draw a card.', 'Acererak the Archlich');
    expect(refs(f)).toEqual(['short-name:Acererak']);
  });

  it('"Gideon of the Trials" is "Gideon": the part before " of "', () => {
    expect(refs(synth('Legendary Planeswalker — Gideon', '+1: Gideon deals 1 damage to any target.', 'Gideon of the Trials'))).toEqual(['short-name:Gideon']);
  });

  it('a planeswalker without a comma is known by its first word, which is also its planeswalker type', () => {
    const f = synth('Legendary Planeswalker — Ajani', '-2: Ajani deals 3 damage to any target.', 'Ajani Testing');
    expect(refs(f)).toEqual(['short-name:Ajani']);
  });

  it('a title and the last word: "Captain Kirk"', () => {
    const f = synth('Legendary Creature — Human', 'Whenever Captain Kirk attacks, draw a card.', 'Captain James T. Kirk');
    expect(refs(f)).toEqual(['short-name:Captain Kirk']);
  });

  it('a card that is not legendary is known by the part before a comma when it is not a word of the rules ("Alberix, the Trade Planet")', () => {
    const f = synth('World Enchantment', "Alberix's resources are limited.", 'Alberix, the Trade Planet');
    expect(refs(f)).toEqual(['short-name:Alberix']);
  });

  it('never a word the rules use: a Sliver Queen is not "Sliver", a Mountain Goat is not "Mountain", "The Great Henge" is not "The"', () => {
    expect(refs(synth('Legendary Creature — Sliver', 'Sliver creatures you control have haste.', 'Sliver Queen'))).toEqual([]);
    expect(refs(synth('Creature — Goat', 'Mountain Goat gets +1/+1.', 'Mountain Goat'))).toEqual(['name:Mountain Goat']);
    expect(refs(synth('Legendary Artifact', 'The Great Henge costs less.', 'The Great Henge'))).toEqual(['name:The Great Henge']);
    expect(refs(synth('Legendary Creature — Human', 'Captain deals damage.', 'Captain Sisay'))).toEqual([]);
  });
});

describe('CR 201.5c: a short name that starts another name is not a self reference', () => {
  it('"Syr Joshua and Syr Saxon": the second "Syr" starts a different name', () => {
    const f = synth('Legendary Creature — Knight', 'Creatures named Syr Joshua and Syr Saxon have haste.', 'Syr Joshua and Syr Saxon');
    expect(refs(f)).toEqual([]); // "named" compares names (CR 201.2) and the second "Syr" must not become "~ Saxon"
  });

  it('"Tuktuk the Returned" is another creature than "Tuktuk the Explorer"', () => {
    const f = synth('Legendary Creature — Golem', 'When Tuktuk the Explorer dies, create Tuktuk the Returned.', 'Tuktuk the Explorer');
    expect(refs(f)).toEqual(['name:Tuktuk the Explorer']);
  });

  it('a possessive name is a thing of somebody, not a person: "Marit Lage\'s Slumber" is not "Marit"', () => {
    expect(refs(synth('Legendary Enchantment', 'Create Marit Lage, a legendary 20/20 black Avatar creature token.', "Marit Lage's Slumber"))).toEqual([]);
  });

  it('a title with a dot: "Dr. Beverly Crusher" is "Dr. Crusher"', () => {
    expect(refs(synth('Legendary Creature — Human', 'Whenever Dr. Crusher attacks, draw a card.', 'Dr. Beverly Crusher'))).toEqual(['short-name:Dr. Crusher']);
  });
});

describe('CR 205.3m vs 201.5: a name that is also a creature type is the object, not the type', () => {
  it('"for each other attacking Aurochs" and "becomes a Coward" are type words and stay words; the rest is the object', () => {
    const a = synth('Creature — Aurochs', 'Whenever Aurochs attacks, it gets +1/+0 for each other attacking Aurochs.', 'Aurochs');
    expect(a.pre.selfRefs.map((r) => r.range[0])).toEqual([9]);
    const c = synth('Creature — Coward', 'Target creature becomes a Coward in addition to its other types. Coward gets +1/+1.', 'Coward');
    expect(refs(c)).toEqual(['name:Coward']);
    expect(c.pre.selfRefs[0]!.range[0]).toBe(c.pre.normalized.indexOf('Coward gets'));
  });

  it('"Target Assembly-Worker creature" and "a green Lizard creature" are types', () => {
    expect(refs(synth('Artifact Creature — Assembly-Worker', '{T}: Target Assembly-Worker creature gets +1/+1 until end of turn.', 'Assembly-Worker'))).toEqual([]);
    expect(refs(synth('Legendary Creature — Lizard', 'Target creature becomes a green Lizard creature with base power and toughness 4/4.', 'Lizard, Connors’s Curse'))).toEqual([]);
  });
});

describe('CR 201.5 and 712: a short name yields to a longer card name that starts with it (meld results, other cards)', () => {
  const names = new Set(['Mishra, Lost to Phyrexia', 'Mishra, Claimed by Gix']);
  const ctx = face('Mishra, Claimed by Gix', 'Legendary Creature — Phyrexian Human', 'Whenever Mishra attacks, meld them into Mishra, Lost to Phyrexia.');

  it('the second "Mishra" is part of the name of the meld result', () => {
    const f = segment(ctx, { cardNames: names });
    expect(f.pre.selfRefs.map((r) => [r.via, r.range[0]])).toEqual([['short-name', 9]]);
    expect(tokenNorms(f.abilities[0]!.sentences[0]!.tokens)).toBe('whenever ~ attacks , meld them into Mishra, Lost to Phyrexia .');
  });

  it('without the name index nothing is known about the longer name', () => {
    expect(segment(ctx).pre.selfRefs).toHaveLength(2);
  });
});

describe('CR 207.2c-d: a label cannot hide a keyword that has parameters (design 6.2 step 4)', () => {
  const label = (text: string) => segment(face('Test Card', 'Creature — Bear', text)).pre.lines[0]!.label?.kind;

  it('a cost or number after a keyword name inside the prefix is rules text, not a flavor word', () => {
    expect(label('Commander Suspend 4 -- {B}{G}')).toBeUndefined();
    expect(label('Fixed commander ninjutsu -- {B}{B}, Discard a card')).toBeUndefined();
    expect(label('Thing Kicker {2} -- Draw a card.')).toBeUndefined();
  });

  it('such a line stays an ordinary, unlabeled line (manual later), never understood as a label', () => {
    const f = synth('Creature — Bear', 'Fixed commander ninjutsu -- {B}{B}, Discard a card');
    expect(f.ledger.some((e) => e.status === 'label')).toBe(false);
    expect(f.abilities.map((a) => a.shape)).toEqual(['static']);
  });

  it('a title that merely contains a keyword word is still a flavor word ("Gift of Chaos", "Wild Magic Surge", "Stage 2")', () => {
    expect(label('Gift of Chaos -- Whenever ~ attacks, draw a card.')).toBe('flavor-word');
    expect(label('Wild Magic Surge -- Whenever ~ attacks, draw a card.')).toBe('flavor-word');
    expect(label('Stage 2 -- Whenever ~ attacks, draw a card.')).toBe('flavor-word');
  });

  it('a listed ability word is still an ability word', () => {
    expect(label('Landfall -- Whenever a land enters, draw a card.')).toBe('ability-word');
  });
});

describe("design 6.2 step 2: a keyword line's reminder text is compared with the registry's (errata flag, info)", () => {
  const keywords = [
    { name: 'Flying', aliases: [], params: [], reminder: 'This creature can only be blocked by creatures with flying or reach.' },
    { name: 'Kicker', aliases: [], params: ['cost'], reminder: 'You may pay an additional {cost} as you cast this spell.' },
    { name: 'Vigilance', aliases: [], params: [], reminder: '' },
  ];
  const run = (text: string, typeLine = 'Creature — Bear') => segment(face('Test Card', typeLine, text), { keywords });
  const infos = (f: SegmentedFace) => f.diagnostics.filter((d) => d.level === 'info');

  it('the same wording is not flagged, whitespace and a final period do not matter', () => {
    expect(infos(run('Flying (This creature can only be   blocked by creatures with flying or reach.)'))).toEqual([]);
    expect(infos(run('Flying (This creature can only be blocked by creatures with flying or reach)'))).toEqual([]);
  });

  it('a placeholder stands for the cost, number or quality as written', () => {
    expect(infos(run('Kicker {1}{G} (You may pay an additional {1}{G} as you cast this spell.)', 'Sorcery'))).toEqual([]);
  });

  it('a different wording is an info diagnostic on the reminder range (code lint)', () => {
    const f = run('Flying (This creature cannot be blocked at all.)');
    expect(infos(f)).toHaveLength(1);
    expect(infos(f)[0]).toMatchObject({ level: 'info', code: 'lint' });
    expect(f.pre.normalized.slice(...infos(f)[0]!.range!)).toBe('(This creature cannot be blocked at all.)');
  });

  it('the name of the object is "~" on both sides ("Test Card" and "this creature")', () => {
    const k = [{ name: 'Flying', aliases: [], params: [], reminder: '~ can only be blocked by creatures with flying or reach.' }];
    const f = segment(face('Test Card', 'Creature — Bear', 'Flying (This creature can only be blocked by creatures with flying or reach.)'), { keywords: k });
    expect(infos(f)).toEqual([]);
  });

  it('nothing to compare with: no registry entry, an empty registry reminder, no reminder, or no registry at all', () => {
    expect(infos(run('Haste (Whatever.)'))).toEqual([]);
    expect(infos(run("Vigilance (Attacking doesn't cause this creature to tap.)"))).toEqual([]);
    expect(infos(run('Flying'))).toEqual([]);
    expect(infos(synth('Creature — Bear', 'Flying (Anything.)'))).toEqual([]);
  });

  it('reminder text of a line that is not a keyword line is never compared', () => {
    expect(infos(run('Draw a card. (Anything.)', 'Sorcery'))).toEqual([]);
  });
});

// QT: whole-index guards are a slow suite (npm run test:all); the index is read only when they run (Vitest runs a skipped describe's body).
describe.skipIf(!SLOW)(slowTitle('guards over the local Oracle index'), () => {
  const cards = SLOW ? localIndex() : null;
  const contexts = cards ? cards.flatMap((c) => faceContexts(c)) : [];

  it.skipIf(!cards)('CR 113.6 guard: no spell ability of an instant or sorcery holds a static form that works on the stack', () => {
    const bad: string[] = [];
    const forms = [/rather than pay ~/, /~ costs? [^.]*\b(?:less|more)\b/, /~ can't be countered/, /you may cast ~/, /as an additional cost to cast ~/, /~ has [^.]* as long as/, /~ is (?:colorless|all colors)/];
    for (const ctx of contexts) {
      if (!ctx.types.some((t) => t === 'instant' || t === 'sorcery')) continue;
      const f = segment(ctx);
      for (const a of f.abilities) {
        if (a.shape !== 'spell') continue;
        for (const l of a.lines) {
          const line = f.pre.parse.slice(...f.pre.lines[l]!.body).replace(/"[^"]*"/g, '""');
          if (forms.some((re) => re.test(line.split(/\.\s/)[0]!))) bad.push(`${ctx.name}: ${line.slice(0, 80)}`);
        }
      }
    }
    expect(bad.slice(0, 10), `${bad.length} lines`).toEqual([]);
  });

  it.skipIf(!cards)('CR 603.7 guard: every printed trigger of an instant or sorcery works outside the stack (no "this turn", "this combat" or "next" in its condition)', () => {
    const bad: string[] = [];
    for (const ctx of contexts) {
      if (!ctx.types.some((t) => t === 'instant' || t === 'sorcery')) continue;
      for (const a of segment(ctx).abilities) {
        if (a.shape !== 'triggered') continue;
        const clause = a.text.split(',')[0]!;
        if (/\b(?:this turn|this combat|next)\b/.test(clause)) bad.push(`${ctx.name}: ${a.text.slice(0, 80)}`);
      }
    }
    expect(bad.slice(0, 10), `${bad.length} abilities`).toEqual([]);
  });

  // FAST5X E24 (INTERFACE CHANGE of SelfRef.as, parser/front/types.ts; CR 201.5, design 6.4): a gendered pronoun replaced with text of its own ("his" ->
  // "~'s", "he's" -> "~ is") has its SELF token only up to the "~" (preprocess.ts#selfExtents, what the tokenizer is given); the rest of the words is the
  // token of the rest of the replacement ("'s", "is"), which must end exactly where the words end. Every other reference: the SELF token has its whole range.
  it.skipIf(!cards)('SELF contract guard: every self reference has a SELF token with exactly its range (its extent, for a replacement with text of its own), and no structure entry overlaps it', () => {
    const bad: string[] = [];
    for (const ctx of contexts) {
      const f = segment(ctx);
      const tokens = f.abilities.flatMap(tokensOf);
      const selfTokens = tokens.filter((t) => t.kind === 'SELF');
      const grantorTokens = tokens.filter((t) => t.kind === 'GRANTOR');
      const extents = selfExtents(f.pre);
      for (const r of f.pre.selfRefs) {
        if (f.ledger.some((e) => (e.status === 'label' || e.status === 'reminder') && e.range[0] < r.range[1] && e.range[1] > r.range[0])) continue;
        const want = r.as === undefined ? r.range : (extents.get(r.range[0] + r.as.indexOf('~')) ?? r.range);
        // r4-static (wave 7): the outer card's name inside a quoted ability is marked '¤' and read as a GRANTOR token, with the same range contract
        const kind = r.mark === '¤' ? 'GRANTOR' : 'SELF';
        if (!(kind === 'GRANTOR' ? grantorTokens : selfTokens).some((t) => t.range[0] === want[0] && t.range[1] === want[1])) bad.push(`${ctx.name}: no ${kind} token for ${JSON.stringify(r.text)}`);
        else if (want[1] < r.range[1] && !tokens.some((t) => t.kind !== 'SELF' && t.kind !== 'GRANTOR' && t.range[0] >= want[1] && t.range[1] === r.range[1])) bad.push(`${ctx.name}: the rest of ${JSON.stringify(r.text)} has no token`);
        for (const e of f.ledger) if (e.status === 'structure' && e.range[0] < r.range[1] && e.range[1] > r.range[0]) bad.push(`${ctx.name}: structure overlaps ${JSON.stringify(r.text)}`);
      }
    }
    expect(bad.slice(0, 10), `${bad.length} problems`).toEqual([]);
  }, 120_000); // about 3 s alone: the whole index is segmented, which can pass the default 5 s timeout on a loaded machine
});
