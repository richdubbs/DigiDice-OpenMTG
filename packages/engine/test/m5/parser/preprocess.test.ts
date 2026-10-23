/**
 * WP5, parser front end step 1 (design 6.2): normalization with an offset map, reminder text (CR 207.2a), self reference (CR 201.5), labels (CR 207.2c-d).
 * Wording in this file is synthetic: invented card names and minimal rules text (design 6.10).
 */
import { describe, expect, it } from 'vitest';
import { collapse, normalizeText, originalRange, selfExtents } from '../../../src/parser/preprocess';
import { face, oracle, faceContexts, pre } from './support';

describe('normalizeText (design 6.2 step 1)', () => {
  it('curly quotes and apostrophes become ASCII', () => {
    expect(normalizeText('It’s “quoted” ‘here’').text).toBe('It\'s "quoted" \'here\'');
  });

  it('minus, en and em dashes: "-" between digits and for U+2212, "--" elsewhere', () => {
    expect(normalizeText('−2: draw').text).toBe('-2: draw');
    expect(normalizeText('1—9 | x').text).toBe('1-9 | x');
    expect(normalizeText('Landfall — draw').text).toBe('Landfall -- draw');
    expect(normalizeText('Ward—{2}').text).toBe('Ward--{2}');
    expect(normalizeText('a – b').text).toBe('a -- b');
  });

  it('non-breaking and repeated spaces collapse, spaces next to line breaks disappear, CRLF becomes LF', () => {
    expect(normalizeText('a  b   c').text).toBe('a b c');
    expect(normalizeText('a  \n  b\r\nc\rd').text).toBe('a\nb\nc\nd');
    expect(normalizeText('end   ').text).toBe('end');
  });

  it('zero-width characters disappear, bullets and symbols stay', () => {
    expect(normalizeText('a​b • {T}').text).toBe('ab • {T}');
  });

  it('keeps an offset map to the original text (the UI paints the original)', () => {
    const original = 'Landfall — draw';
    const { text, offsets } = normalizeText(original);
    expect(offsets).toHaveLength(text.length + 1);
    expect(offsets[text.length]).toBe(original.length);
    const i = text.indexOf('--');
    expect(originalRange(offsets, [i, i + 2])).toEqual([original.indexOf('—'), original.indexOf('—') + 1]);
    const j = text.indexOf('draw');
    expect(original.slice(...originalRange(offsets, [j, j + 4]))).toBe('draw');
  });
});

describe('CR 207.2a: reminder text is never parsed for behavior', () => {
  const ctx = face('Test Drake', 'Creature — Drake', 'Flying (This creature can only be blocked by creatures with flying.)\n(Reminder on its own line.)\nWhen ~ dies, draw a card. (Draws are cheap.)');

  it('a balanced parenthesised span is blanked in the parse text, so no token can come from it', () => {
    const p = pre(ctx);
    expect(p.parse).toHaveLength(p.normalized.length);
    expect(p.parse).not.toMatch(/blocked|Reminder|cheap/);
    expect(p.parse.split('\n')[0]!.trim()).toBe('Flying');
  });

  it('the spans are recorded as reminder entries of the ledger', () => {
    const p = pre(ctx);
    expect(p.reminders).toHaveLength(3);
    const entries = p.ledger.filter((e) => e.status === 'reminder');
    expect(entries.map((e) => p.normalized.slice(...e.range))).toEqual([
      '(This creature can only be blocked by creatures with flying.)',
      '(Reminder on its own line.)',
      '(Draws are cheap.)',
    ]);
  });

  it('a line that is only reminder text is flagged and has no body', () => {
    const lines = pre(ctx).lines;
    expect(lines[1]!.reminderOnly).toBe(true);
    expect(lines[0]!.reminderOnly).toBe(false);
    expect(lines[1]!.body[0]).toBe(lines[1]!.body[1]);
  });

  it('nested parentheses are one reminder', () => {
    const p = pre(face('Test', 'Creature — Bear', 'Haste (Outer (inner) text.)'));
    expect(p.reminders).toHaveLength(1);
    expect(p.parse.trim()).toBe('Haste');
  });

  it('an unbalanced parenthesis is kept as text and warned about, never guessed', () => {
    const p = pre(face('Test', 'Creature — Bear', 'Haste (never closed'));
    expect(p.reminders).toHaveLength(0);
    expect(p.parse).toContain('(never closed');
    expect(p.diagnostics.map((d) => d.code)).toContain('leftover-text');
  });

  it('reminder text inside a quoted ability is blanked too', () => {
    const p = pre(face('Test', 'Instant', 'Target creature gains "Haste (fast)" until end of turn.'));
    expect(p.parse).toContain('"Haste ');
    expect(p.parse).not.toContain('fast');
  });
});

describe('CR 201.5: self reference becomes "~" (design 6.2 step 3)', () => {
  const refs = (c: ReturnType<typeof face>) => pre(c).selfRefs.map((r) => `${r.via}:${r.text}:${r.scope}`);

  it('the face name, whole words only, and the parse text keeps its length', () => {
    const c = face('Sol Gem', 'Artifact', '{T}: Add {C}. Sol Gem deals 1 damage to you. Sol Gems are great.');
    const p = pre(c);
    expect(refs(c)).toEqual(['name:Sol Gem:face']);
    expect(p.parse).toHaveLength(p.normalized.length);
    expect(p.parse.replace(/\s+/g, ' ')).toBe('{T}: Add {C}. ~ deals 1 damage to you. Sol Gems are great.');
  });

  it('the "~" sits on the last character of the replaced words, so a possessive stays attached', () => {
    const c = face('Sol Gem', 'Artifact', 'Sol Gem\'s power is low. This artifact\'s cost is 1.');
    const p = pre(c);
    expect(p.parse).toMatch(/~'s power/);
    expect(p.parse).toMatch(/~'s cost/);
    const ext = selfExtents(p);
    expect([...ext.values()].map((r) => p.normalized.slice(...r))).toEqual(["Sol Gem", 'This artifact']);
  });

  it('CR 201.5c: the short name before the comma of a legendary name', () => {
    const c = face('Brunhild, the Pale Queen', 'Legendary Creature — Human Noble', 'Whenever Brunhild attacks, draw a card. Brunhild, the Pale Queen is legendary.');
    expect(refs(c)).toEqual(['short-name:Brunhild:face', 'name:Brunhild, the Pale Queen:face']);
  });

  it('a card that is not legendary is not known by a short name ("Elemental, My Dear" is not the creature type Elemental)', () => {
    const c = face('Elemental, My Dear', 'Sorcery', 'Create a 0/0 blue Elemental creature token. Elemental, My Dear deals 1 damage to you.');
    expect(refs(c)).toEqual(['name:Elemental, My Dear:face']);
  });

  it('the literal CARDNAME of templated text', () => {
    expect(refs(face('Wall of Test', 'Creature — Wall', 'CARDNAME can block.'))).toEqual(['cardname:CARDNAME:face']);
  });

  it('CR 201.5b: the names of the other faces of the same card mean this object', () => {
    const card = oracle('transform', [
      { name: 'Day Watcher', type_line: 'Creature — Human', oracle_text: 'At night, transform Day Watcher.' },
      { name: 'Night Stalker', type_line: 'Creature — Werewolf', oracle_text: 'Night Stalker returns as Day Watcher.' },
    ]);
    const [front, back] = faceContexts(card);
    expect(front!.otherNames).toEqual(['Night Stalker']);
    expect(refs(front!)).toEqual(['name:Day Watcher:face']);
    expect(refs(back!)).toEqual(['name:Night Stalker:face', 'other-face:Day Watcher:face']);
  });

  it('meld partners are other cards, not other faces', () => {
    const card = oracle('meld', [{ name: 'Half One', type_line: 'Creature — Angel', oracle_text: 'Melds with Half Two.' }]);
    const [f] = faceContexts(card);
    expect(f!.otherNames).toEqual([]);
    expect(refs(f!)).toEqual([]);
  });

  describe('"this <noun>"', () => {
    it('is the object when the noun is one of the face\'s types or subtypes', () => {
      expect(refs(face('Test Bear', 'Creature — Bear', 'When this creature dies, draw. Sacrifice this permanent. Return this card to your hand.'))).toEqual([
        'this-noun:this creature:face',
        'this-noun:this permanent:face',
        'this-noun:this card:face',
      ]);
      expect(refs(face('Test Blade', 'Artifact — Equipment', 'This Equipment is attached. This artifact can\'t be countered.'))).toEqual(['this-noun:This Equipment:face', 'this-noun:This artifact:face']);
    });

    it('"this creature" on a face that is not a creature stays words (it is not this object yet)', () => {
      expect(refs(face('Test Totem', 'Artifact', 'This creature gets +1/+1.'))).toEqual([]);
    });

    it('"this spell" is the spell that is this card on any face, "this permanent" only on a permanent face', () => {
      expect(refs(face('Test Bolt', 'Instant', 'This spell costs {1} less. Exile this permanent.'))).toEqual(['this-noun:This spell:face']);
      expect(refs(face('Test Bear', 'Creature — Bear', 'This spell costs {1} less.'))).toEqual(['this-noun:This spell:face']);
    });

    it('"this turn", "this way", "this combat", "this ability" are never the object', () => {
      expect(refs(face('Test Bear', 'Creature — Bear', 'Until end of turn, this creature gets +1/+0 this turn. This ability triggers this way.'))).toEqual(['this-noun:this creature:face']);
    });

    it('a noun followed by turn/way/combat/phase/step/game/ability is something else ("this permanent step")', () => {
      expect(refs(face('Test Bear', 'Creature — Bear', 'this creature turn'))).toEqual([]);
    });

    it('a Room\'s halves say "this door"; a token face says "this token"', () => {
      expect(refs(face('Test Door', 'Enchantment — Room', 'When you unlock this door, draw.'))).toEqual(['this-noun:this door:face']);
      expect(refs(face('Test Spirit', 'Token Creature — Spirit', 'Sacrifice this token.', { isToken: true }))).toEqual(['this-noun:this token:face']);
    });
  });

  describe('quoted abilities have a fresh self scope (CR 201.5a)', () => {
    const c = face('Test Maker', 'Sorcery', 'Create a token with "Sacrifice this artifact: Draw a card." Test Maker deals 1 damage. Create a token with "Test Maker deals 2 damage to you."');

    it('"this <noun>" inside the quote is the object that has the ability, whatever the noun', () => {
      expect(refs(c)).toContain('this-noun:this artifact:quote');
    });

    it('the OUTER card\'s name inside a quote is never "~": it names another object there (r4-static: the granting object, mark "¤", CR 201.5a)', () => {
      const r = refs(c);
      expect(r.filter((x) => x.startsWith('name:'))).toEqual(['name:Test Maker:face']);
      // r4-static: the mark "¤" (a GRANTOR token, `{ref:'grantor'}`); only an ability a static ability grants may use it (model/lint.ts), so this token's
      // ability stays manual
      expect(r.filter((x) => x.startsWith('grantor:'))).toEqual(['grantor:Test Maker:quote']);
      expect(pre(c).parse).toContain('"         ¤ deals 2 damage to you."');
    });

    it('an Aura-style grant: the quote\'s "this creature" is the grantee although the face is not a creature', () => {
      expect(refs(face('Test Aura', 'Enchantment — Aura', 'Enchanted creature has "This creature can\'t block."'))).toEqual(['this-noun:This creature:quote']);
    });
  });

  it('"named X" compares names: the card\'s own name after "named" is not a self reference', () => {
    const c = face('Test Elf', 'Creature — Elf', 'Search for a card named Test Elf. Other creatures named Test Elf get +1/+1. Test Elf can block.');
    expect(refs(c)).toEqual(['name:Test Elf:face']);
    expect(pre(c).parse).toContain('named Test Elf.');
  });
});

describe('labels (design 6.2 step 4, CR 207.2c-d)', () => {
  const lead = (text: string, c = face('Test Bear', 'Creature — Bear', text)) => {
    const p = pre(c);
    const l = p.lines[0]!;
    return { label: l.label ? { text: l.label.text, kind: l.label.kind } : undefined, dash: l.keywordDash?.name, body: p.parse.slice(...l.body) };
  };

  it('an ability word is a label, and the body starts after the dash', () => {
    expect(lead('Landfall — Whenever a land enters, draw.')).toEqual({ label: { text: 'Landfall', kind: 'ability-word' }, dash: undefined, body: 'Whenever a land enters, draw.' });
  });

  it('an unknown prefix that reads like a name is a flavor word', () => {
    expect(lead('Mind Swap — {2}, {T}: Draw a card.').label).toEqual({ text: 'Mind Swap', kind: 'flavor-word' });
    expect(lead('A Thousand Souls Die Every Day — {T}: Add {B}.').label?.kind).toBe('flavor-word');
  });

  it('labels never hide rules text: a prefix with game words or a digit is not a title', () => {
    expect(lead('Each opponent faces a choice — They lose 4 life.').label).toBeUndefined();
    expect(lead('When you win — Draw.').label).toBeUndefined();
    expect(lead('1 or 2 — Draw.').label).toBeUndefined();
    expect(lead('This is a very long prefix of far too many words to be a title — Draw.').label).toBeUndefined();
  });

  it('a keyword written with a dash is not a label: its text is part of the ability', () => {
    expect(lead('Ward—Pay 3 life.')).toMatchObject({ label: undefined, dash: 'Ward' });
    expect(lead('Escape—{3}{R}{R}, Exile four other cards from your graveyard.')).toMatchObject({ label: undefined, dash: 'Escape' });
    expect(lead('Boast — {1}: Draw a card.')).toMatchObject({ label: undefined, dash: 'Boast' });
    expect(lead('Cumulative upkeep—Pay 1 life.')).toMatchObject({ label: undefined, dash: 'Cumulative Upkeep' });
    expect(lead('Prototype {1}{W} — 2/2')).toMatchObject({ label: undefined, dash: 'Prototype' });
  });

  it('a flavor word that starts with a keyword name is still a label when the rest is not a parameter', () => {
    expect(lead('Shadow Strike — {T}: Draw a card.').label).toEqual({ text: 'Shadow Strike', kind: 'flavor-word' });
  });

  it('modal headers, chapter numerals and case lines are structure, not labels', () => {
    expect(lead('Choose one —').label).toBeUndefined();
    expect(lead('I, II — Draw a card.', face('Test Saga', 'Enchantment — Saga', 'I, II — Draw a card.')).label).toBeUndefined();
    expect(lead('To solve — You control three artifacts.').label).toBeUndefined();
  });

  it('the label is read before self references become "~": a flavor word may contain the card name', () => {
    const c = face('Calim, Djinn', 'Legendary Creature — Djinn', 'Calim\'s Breath — {1}{U}, Discard Calim: Tap target permanent.');
    const p = pre(c);
    expect(p.lines[0]!.label?.text).toBe("Calim's Breath");
    expect(p.parse.slice(...p.lines[0]!.body).replace(/\s+/g, ' ')).toBe('{1}{U}, Discard ~: Tap target permanent.');
  });

  it('a label is a label entry of the ledger and never overlaps a reminder inside it', () => {
    const p = pre(face('Test Bear', 'Creature — Bear', 'Landfall (reminder) — Draw a card.'));
    const labels = p.ledger.filter((e) => e.status === 'label').map((e) => p.normalized.slice(...e.range));
    expect(labels).toEqual(['Landfall', '--']);
    expect(p.ledger.map((e) => e.status)).toEqual(['label', 'reminder', 'label']);
  });
});

describe('collapse', () => {
  it('joins ranges of the parse text with collapsed whitespace', () => {
    expect(collapse('a   b\n  c', [[0, 5], [6, 9]])).toBe('a b\nc');
  });
});
