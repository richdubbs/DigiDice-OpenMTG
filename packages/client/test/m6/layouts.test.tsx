/**
 * M6-11 (m6 design 5 "M6-11", 3.6, 3.7): the board shows the milestone 6 states of real fixture cards, outside the card image (ARCHITECTURE.md "Card images"):
 * which face of a double-faced card is up and a way to see the other face (CR 712.8; the zoom shows both), what a melded permanent is (CR 712.4a), a Saga's
 * chapter (CR 714), a Class's level (CR 716), a leveler's level (CR 711), a Case's solved state (CR 719.3b), prototyped (CR 718.3b) and prepared (CR 722.3).
 */
import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { viewFor, type GameState, type GameView } from '@openmtg/engine';
import { GameBoard, type BoardCardProps } from '../../src/board';
import { finalChapter, statusLines } from '../../src/cards/objectStatus';
import { find, scenario, tweak } from '../prompts/harness';

const DELVER = 'Delver of Secrets // Insectile Aberration';
const spyRenderer = (p: BoardCardProps) => <span className="spy" data-def={p.def?.name ?? 'back'} data-face-index={p.face} />;

type Battlefield = NonNullable<NonNullable<NonNullable<Parameters<typeof scenario>[1]>['p1']>['battlefield']>;

/** Alice's battlefield with these permanents (real fixture cards), optionally changed, and her view of it. */
function board(battlefield: Battlefield, cards: string[], change?: (s: GameState) => void): { s: GameState; v: GameView } {
  let s = scenario(cards, { p1: { battlefield } });
  if (change) s = tweak(s, change);
  return { s, v: viewFor(s, 'p1') };
}

const lines = (v: GameView, id: string) => statusLines(v, v.objects[id]!).map((l) => l.text);
const slotOf = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`.board-card[data-object-id="${id}"]`)!;

describe('CR 712: double-faced cards', () => {
  it('CR 712.8e: a transformed Delver shows its back face up, says so, and the zoom shows its front face too', () => {
    const { s, v } = board([{ name: DELVER, face: 1 }], [DELVER]);
    const id = find(s, DELVER, 'battlefield');
    expect(lines(v, id)).toEqual(['Back face up (front: Delver of Secrets)']);
    const { container } = render(<GameBoard view={v} renderCard={spyRenderer} />);
    const el = slotOf(container, id);
    expect(el.querySelector('.board-card-image .spy')!.getAttribute('data-face-index')).toBe('1');
    expect(within(el).getByText('Back face up (front: Delver of Secrets)')).toBeTruthy();
    fireEvent.mouseEnter(el);
    const zoom = container.querySelector<HTMLElement>('.zoom:not(.zoom-empty)')!;
    expect([...zoom.querySelectorAll('.spy')].map((x) => x.getAttribute('data-face-index'))).toEqual(['1', '0']);
    expect(within(zoom).getByText('Front face')).toBeTruthy();
    expect(zoom.querySelector('[aria-label="Other face: Delver of Secrets"]')).toBeTruthy();
  });

  it('CR 712.8d: front face up says which back face it has; a modal double-faced card is shown the same way', () => {
    const { s, v } = board([DELVER], [DELVER]);
    expect(lines(v, find(s, DELVER, 'battlefield'))).toEqual(['Front face up (back: Insectile Aberration)']);
  });

  it('CR 712.4a: a melded permanent says it is one permanent represented by both cards (by name when the view carries their definitions)', () => {
    const cards = ['Brisela, Voice of Nightmares', 'Bruna, the Fading Light', 'Gisela, the Broken Blade'];
    let s = scenario(cards, { p1: { battlefield: ['Brisela, Voice of Nightmares'], graveyard: ['Bruna, the Fading Light', 'Gisela, the Broken Blade'] } });
    const id = find(s, 'Brisela, Voice of Nightmares', 'battlefield');
    s = tweak(s, (t) => {
      t.objects[id]!.components = [
        { kind: 'card', defId: 'Bruna, the Fading Light', owner: 'p1' },
        { kind: 'card', defId: 'Gisela, the Broken Blade', owner: 'p1' },
      ];
    });
    const v = viewFor(s, 'p1');
    expect(lines(v, id)).toEqual(['Melded from Bruna, the Fading Light and Gisela, the Broken Blade']);
    // without the components' definitions in the view, it still says what it is, never a wrong name
    const { ['Bruna, the Fading Light']: _b, ...defs } = v.defs;
    expect(lines({ ...v, defs }, id)).toEqual(['Melded: one permanent, 2 cards']);
  });
});

describe('CR 714, 716, 711, 719, 718, 722: layout structures', () => {
  it('CR 714.2: History of Benalia with two lore counters is on chapter II of III', () => {
    // put onto the battlefield with one lore counter before Alice's precombat main phase, which adds the second (CR 714.3c)
    const { s, v } = board([{ name: 'History of Benalia', counters: { lore: 1 } }], ['History of Benalia']);
    expect(v.objects[find(s, 'History of Benalia', 'battlefield')]!.counters['lore']).toBe(2);
    const id = find(s, 'History of Benalia', 'battlefield');
    expect(finalChapter(v.defs['History of Benalia']!, 0)).toBe(3);
    expect(lines(v, id)).toEqual(['Chapter II of III']);
    const { container } = render(<GameBoard view={v} />);
    const el = slotOf(container, id);
    expect(within(el).getByText('Chapter II of III')).toBeTruthy();
    // the counters themselves, on the card
    expect(el.querySelector('.board-card-image .card-counter[data-counter="lore"]')?.getAttribute('title')).toBe('2 lore counters (CR 122.1)');
  });

  it('CR 716.2: Bard Class is level 1 without the designation, level 2 with it', () => {
    const { s, v } = board(['Bard Class'], ['Bard Class']);
    const id = find(s, 'Bard Class', 'battlefield');
    expect(lines(v, id)).toEqual(['Level 1 of 3']);
    const leveled = viewFor(tweak(s, (t) => void (t.objects[id]!.classLevel = 2)), 'p1');
    expect(lines(leveled, id)).toEqual(['Level 2 of 3']);
  });

  it('CR 711.2: Student of Warfare with three level counters is in its LEVEL 2-6 bracket', () => {
    const { s, v } = board([{ name: 'Student of Warfare', counters: { level: 3 } }], ['Student of Warfare']);
    expect(lines(v, find(s, 'Student of Warfare', 'battlefield'))).toEqual(['Level 3 (LEVEL 2-6)']);
  });

  it('CR 719.3b: a Case says whether it is solved', () => {
    const { s, v } = board(['Case of the Locked Hothouse'], ['Case of the Locked Hothouse']);
    const id = find(s, 'Case of the Locked Hothouse', 'battlefield');
    expect(lines(v, id)).toEqual(['Not solved']);
    expect(lines(viewFor(tweak(s, (t) => void (t.objects[id]!.solved = true)), 'p1'), id)).toEqual(['Solved']);
  });

  it('CR 718.3b: a prototyped Phyrexian Fleshgorger says so, with the prototype\'s cost and power and toughness', () => {
    const { s, v } = board(['Phyrexian Fleshgorger'], ['Phyrexian Fleshgorger'], (t) => {
      for (const o of Object.values(t.objects)) if (o.defId === 'Phyrexian Fleshgorger') o.prototyped = true;
    });
    expect(lines(v, find(s, 'Phyrexian Fleshgorger', 'battlefield'))).toEqual(['Prototyped ({1}{B}{B} 3/3)']);
  });

  it('CR 722.3a: a prepared Encouraging Aviator says so; an unprepared one says nothing', () => {
    const name = 'Encouraging Aviator // Jump';
    const { s, v } = board([name], [name]);
    const id = find(s, name, 'battlefield');
    expect(lines(v, id)).toEqual([]);
    const prepared = viewFor(tweak(s, (t) => void (t.objects[id]!.prepared = true)), 'p1');
    expect(lines(prepared, id)).toEqual(['Prepared']);
    const { container } = render(<GameBoard view={prepared} />);
    expect(within(slotOf(container, id)).getByText('Prepared')).toBeTruthy();
  });

  it('CR 708.2a: a face-down permanent shows none of its card\'s states (it is a nameless 2/2)', () => {
    const { s, v } = board([{ name: 'History of Benalia', counters: { lore: 2 } }], ['History of Benalia'], (t) => {
      for (const o of Object.values(t.objects)) if (o.defId === 'History of Benalia') o.faceDown = true;
    });
    expect(lines(v, find(s, 'History of Benalia', 'battlefield'))).toEqual([]);
  });
});
