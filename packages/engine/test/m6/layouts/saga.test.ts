/**
 * M6-6 (m6 design 3.7 "Saga", 5 "M6-6"): Sagas. The intrinsic "enters with a lore counter" replacement (CR 714.3a) and read ahead's chosen number (CR 714.3b,
 * 702.155), the precombat main lore counter (CR 714.3c), chapter triggers (CR 714.2b-c) and the sacrifice of SBA 704.5s (CR 714.4). Real fixture cards
 * (History of Benalia, The Elder Dragon War, Doubling Season), driven by real actions.
 */
import { describe, expect, it } from 'vitest';
import { getChars, type GameState } from '../../../src/index';
import { advanceTo, answer, find, pass, scenario } from '../../m3/scenario';
import { cast, drive, resolveTop } from '../../m5/cr-examples/helpers';

const lore = (s: GameState, id: string): number => s.objects[id]?.counters['lore'] ?? 0;
const knights = (s: GameState): number => s.zones.battlefield.filter((id) => s.defs[s.objects[id]!.defId]!.name === 'Knight Token').length;
const plains = (n: number): string[] => Array<string>(n).fill('Plains');

/** Cast History of Benalia and let it resolve: it is on the battlefield with its entering lore counters, its chapter triggers waiting or on the stack. */
function benaliaOnBattlefield(battlefield: string[] = []): { s: GameState; id: string } {
  let s = scenario(['History of Benalia', 'Doubling Season'], { p1: { hand: ['History of Benalia'], battlefield: [...plains(3), ...battlefield] } });
  s = cast(s, 'History of Benalia');
  s = resolveTop(s); // the spell resolves; its chapter triggers are put on the stack before p1 gets priority
  return { s, id: find(s, 'History of Benalia', 'battlefield') };
}

describe('CR 714.3a: each Saga without read ahead enters with a lore counter (an intrinsic replacement effect)', () => {
  it('History of Benalia enters with one lore counter, which triggers chapter I (CR 714.2b); it has the intrinsic ability r:saga', () => {
    const { s, id } = benaliaOnBattlefield();
    expect(lore(s, id)).toBe(1);
    expect(getChars(s, id).abilities.map((a) => a.key)).toContain('r:saga');
    expect(s.zones.stack).toHaveLength(1); // chapter I
    const t = resolveTop(s);
    expect(knights(t)).toBe(1);
    expect(t.objects[id]?.zone).toBe('battlefield'); // final chapter III not reached
  });

  it('with Doubling Season it enters with two lore counters (a replacement effect puts them, CR 614.16), and both chapters I and II trigger (CR 714.2b-c)', () => {
    const { s, id } = benaliaOnBattlefield(['Doubling Season']);
    expect(lore(s, id)).toBe(2);
    expect(s.zones.stack).toHaveLength(2); // "I, II" triggers once per chapter number reached (CR 714.2c)
    const t = resolveTop(resolveTop(s));
    expect(knights(t)).toBe(4); // each chapter makes a Knight, doubled by Doubling Season
  });
});

describe('CR 714.3c: as its controller\'s precombat main phase begins, a Saga gets a lore counter (a turn-based action)', () => {
  it('the next turn of its controller: chapter II; not on the opponent\'s turn', () => {
    const { s, id } = benaliaOnBattlefield();
    let t = resolveTop(s); // chapter I: a Knight
    t = advanceTo(t, 2, 'main1'); // p2's turn
    expect(lore(t, id)).toBe(1);
    t = advanceTo(t, 3, 'main1');
    expect(lore(t, id)).toBe(2);
    expect(t.log.some((l) => /puts a lore counter on History of Benalia \(precombat main phase\)/.test(l.text) && l.rules?.includes('CR 714.3c'))).toBe(true);
    t = drive(t);
    expect(t.zones.stack).toHaveLength(1); // chapter II
    t = resolveTop(t);
    expect(knights(t)).toBe(2);
  });

  it('with Doubling Season the turn-based lore counter is ONE: it is not put by an effect (CR 614.16, 714.3c)', () => {
    const { s, id } = benaliaOnBattlefield(['Doubling Season']); // enters with 2
    let t = resolveTop(resolveTop(s));
    t = advanceTo(t, 3, 'main1');
    expect(lore(t, id)).toBe(3);
  });
});

describe('CR 704.5s, 714.4: a Saga is sacrificed once it has its final chapter number of lore counters and no chapter ability of it is waiting or on the stack', () => {
  it('not while chapter III is on the stack; sacrificed after it resolved', () => {
    const { s, id } = benaliaOnBattlefield(['Doubling Season']); // lore 2: chapters I and II
    let t = resolveTop(resolveTop(s));
    t = advanceTo(t, 3, 'main1'); // lore 3: chapter III triggers
    t = drive(t);
    expect(t.zones.stack).toHaveLength(1);
    expect(t.objects[id]?.zone).toBe('battlefield'); // CR 704.5s: the source of a chapter ability that has not left the stack
    t = resolveTop(t);
    expect(t.objects[id]).toBeUndefined();
    expect(t.zones.graveyard['p1']!.some((x) => t.defs[t.objects[x]!.defId]!.name === 'History of Benalia')).toBe(true);
    expect(t.log.some((l) => l.rules?.includes('CR 704.5s') && /sacrifices History of Benalia/.test(l.text))).toBe(true);
    // the Knights got +2/+1 from chapter III until end of turn
    const knight = t.zones.battlefield.find((x) => t.defs[t.objects[x]!.defId]!.name === 'Knight Token')!;
    expect([getChars(t, knight).power, getChars(t, knight).toughness]).toEqual(['4', '3']);
  });
});

describe('CR 714.3b, 702.155: read ahead', () => {
  /** Cast The Elder Dragon War choosing `n` as it enters. */
  function elderWar(n: number): { s: GameState; id: string } {
    let s = scenario(['The Elder Dragon War', 'Mountain', 'Grizzly Bears'], { p1: { hand: ['The Elder Dragon War'], battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain'] }, p2: { battlefield: ['Grizzly Bears'] } });
    s = cast(s, 'The Elder Dragon War');
    s = pass(pass(s)); // it resolves; as it enters, choose a number
    expect(s.pending).toMatchObject({ kind: 'chooseOption' });
    const opt = (s.pending as { options: { id: string; label: string }[] }).options;
    expect(opt.map((o) => o.label)).toEqual(['1', '2', '3']); // between one and its final chapter number
    s = answer(s, { kind: 'chooseOption', ids: [opt[n - 1]!.id] });
    s = drive(s);
    return { s, id: find(s, 'The Elder Dragon War', 'battlefield') };
  }

  it('the Saga enters with the chosen number of lore counters, and the chapters below that number don\'t trigger (CR 702.155a): choosing 3 triggers only III', () => {
    const { s, id } = elderWar(3);
    expect(lore(s, id)).toBe(3);
    expect(getChars(s, id).abilities.map((a) => a.key)).toContain('r:readAhead');
    expect(getChars(s, id).abilities.map((a) => a.key)).not.toContain('r:saga');
    expect(s.zones.stack).toHaveLength(1);
    const t = resolveTop(s);
    expect(t.zones.battlefield.some((x) => t.defs[t.objects[x]!.defId]!.name === 'Dragon Token')).toBe(true); // chapter III, a 4/4 Dragon
    expect(t.zones.battlefield.some((x) => t.defs[t.objects[x]!.defId]!.name === 'Grizzly Bears')).toBe(true); // chapter I did not trigger
    expect(t.objects[id]).toBeUndefined(); // CR 704.5s: final chapter reached, sacrificed
  });

  it('choosing 1 triggers chapter I as usual; the next precombat main phase gets chapter II', () => {
    const { s, id } = elderWar(1);
    expect(lore(s, id)).toBe(1);
    let t = resolveTop(s); // chapter I: 2 damage to each creature and each opponent
    expect(t.zones.battlefield.some((x) => t.defs[t.objects[x]!.defId]!.name === 'Grizzly Bears')).toBe(false);
    t = advanceTo(t, 3, 'main1');
    expect(lore(t, id)).toBe(2);
    t = drive(t);
    expect(t.zones.stack).toHaveLength(1); // chapter II (resolved by hand: its text is manual)
  });
});
