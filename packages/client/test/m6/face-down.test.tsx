/**
 * M6-11 (m6 design 5 "M6-11", 3.4): face-down permanents and spells in the client, from real engine states (the M6-3 test helpers: real fixture cards cast
 * face down, put face down by morph, megamorph and cloak). The board renders only `viewFor` (CR 400.2): another player's face-down object comes with the
 * engine's pseudo-definition, so the DOM never names its card (CR 708.5); its controller sees the real card in the zoom with how it was put face down.
 */
import { fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FACE_DOWN_DEF_IDS, viewFor, type GameState, type GameView } from '@openmtg/engine';
import { GameBoard } from '../../src/board';
import { objectName as boardName } from '../../src/board/model';
import { objectName as promptName } from '../../src/prompts/names';
import { RevealNotice, revealedAtEnd, revealLines } from '../../src/game/RevealNotice';
import { act, castFaceDown, drive, find, lands, putFaceDown, resolveTop, scenario } from '../../../engine/test/m6/face-down/support';

/** Alice (p1): a face-down megamorph Den Protector, a cloaked Exalted Angel and a face-down Grinning Demon spell on the stack. */
function table(): { s: GameState; den: string; cloaked: string; spell: string } {
  let s = scenario(['Den Protector', 'Exalted Angel', 'Grinning Demon', 'Swamp'], { p1: { hand: ['Grinning Demon'], battlefield: lands('Swamp', 3) } });
  let den: string;
  let cloaked: string;
  [s, den] = putFaceDown(s, 'p1', 'Den Protector', { by: 'megamorph', profile: 'plain' });
  [s, cloaked] = putFaceDown(s, 'p1', 'Exalted Angel', { by: 'cloak', profile: 'ward2' });
  s = castFaceDown(s, 'Grinning Demon', 'morph');
  const spell = s.zones.stack[s.zones.stack.length - 1]!;
  return { s, den, cloaked, spell };
}

const SECRETS = ['Den Protector', 'Exalted Angel', 'Grinning Demon', 'megamorph', 'Megamorph'];

/** Everything the page shows, portals included (the card zoom of C2 renders into document.body). */
const pageText = (): string => document.body.innerHTML;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('CR 708.5, m6 design D7: another player\'s face-down permanents and spells', () => {
  it('the opponent\'s view carries only the pseudo-definitions (the engine side the client relies on)', () => {
    const { s, den, cloaked, spell } = table();
    const v = viewFor(s, 'p2');
    expect([v.objects[den]!.defId, v.objects[cloaked]!.defId, v.objects[spell]!.defId]).toEqual([FACE_DOWN_DEF_IDS.plain, FACE_DOWN_DEF_IDS.ward2, FACE_DOWN_DEF_IDS.plain]);
    expect(v.objects[den]!.faceDownInfo?.by).toBe('morph'); // CR 702.37b-c: a megamorph is announced as a morph
  });

  it('the board names them by what is public (CR 708.6) and no real name, nor "megamorph", is anywhere in the DOM', () => {
    const { s, den, cloaked, spell } = table();
    const v = viewFor(s, 'p2');
    const { container } = render(<GameBoard view={v} />);
    const slot = (id: string) => container.querySelector<HTMLElement>(`.board-card[data-object-id="${id}"]`)!;
    expect(slot(den).getAttribute('aria-label')).toBe('Face-down 2/2 creature (morph) (Alice)');
    expect(slot(cloaked).getAttribute('aria-label')).toBe('Face-down 2/2 creature (cloaked) (Alice)');
    expect(slot(den).getAttribute('data-face')).toBe('down');
    expect(within(slot(den)).getByText('Face down (morph)')).toBeTruthy();
    expect(slot(cloaked).querySelector('.card-pt')?.getAttribute('data-pt')).toBe('2/2'); // the profile's characteristics, through getChars on the view
    // the stack: a face-down creature spell, no text, no automation badge (CR 708.2a, 708.4)
    const entry = container.querySelector<HTMLElement>(`[data-stack-id="${spell}"]`)!;
    expect(within(entry).getByText('Face-down creature spell (morph)')).toBeTruthy();
    // the zoom of the opponent's face-down permanent: the card back and the public facts, never a blank frame
    fireEvent.mouseEnter(slot(cloaked));
    const zoom = container.querySelector<HTMLElement>('.zoom:not(.zoom-empty)')!;
    expect(zoom.textContent).toContain('Face-down 2/2 creature (cloaked)');
    expect(zoom.textContent).toContain('only Alice may look at it (CR 708.5). It is a 2/2 creature with ward {2}.');
    expect(zoom.querySelector('.placeholder-card')).toBeNull();
    for (const secret of SECRETS) expect(pageText(), secret).not.toContain(secret);
    for (const id of [den, cloaked, spell]) expect(pageText()).not.toContain(s.objects[id]!.defId);
  });

  it('the prompts name them the same way (a target "face-down creature")', () => {
    const { s, den, spell } = table();
    const v = viewFor(s, 'p2');
    expect(promptName(v, den)).toBe('Face-down creature (morph)');
    expect(promptName(v, spell)).toBe('Face-down creature spell (morph)');
    expect(boardName(v, spell)).toBe('Face-down creature spell (morph)');
  });
});

describe('CR 708.5: the controller sees its own face-down cards', () => {
  it('a card back on the table, named for its controller with how it was put face down; the zoom shows the real card', () => {
    const { s, den, spell } = table();
    const v = viewFor(s, 'p1');
    const { container } = render(<GameBoard view={v} />);
    const el = container.querySelector<HTMLElement>(`.board-card[data-object-id="${den}"]`)!;
    expect(el.getAttribute('aria-label')).toBe('Face-down 2/2 creature (Den Protector, megamorph) (Alice)');
    expect(el.querySelector('.placeholder-card')).toBeNull(); // the back on the table (the opponent may be looking at the screen too)
    fireEvent.mouseEnter(el);
    const zoom = container.querySelector<HTMLElement>('.zoom:not(.zoom-empty)')!;
    expect(within(zoom).getByText('Face down (only you can see it) (megamorph): Den Protector')).toBeTruthy();
    expect(zoom.querySelector('.placeholder-card')?.getAttribute('data-card-name')).toBe('Den Protector');
    // its face-down spell: the stack says what it is to its controller, the table pile shows the back
    expect(within(container.querySelector<HTMLElement>(`[data-stack-id="${spell}"]`)!).getByText('Face-down creature spell (Grinning Demon, morph)')).toBeTruthy();
  });
});

describe('CR 708.9: reveals', () => {
  it('a face-down creature that dies is revealed to everybody: the notice above the prompt says what it was', () => {
    let s = scenario(['Grinning Demon', 'Lightning Bolt', 'Mountain'], { p1: { hand: ['Lightning Bolt'], battlefield: lands('Mountain', 1) } });
    let id: string;
    [s, id] = putFaceDown(s, 'p1', 'Grinning Demon');
    s = drive(act(s, { type: 'cast', player: 'p1', card: find(s, 'Lightning Bolt', 'hand') }), [{ kind: 'chooseTargets', targets: [{ kind: 'object', id }] }]);
    s = resolveTop(s);
    expect(s.objects[id]).toBeUndefined();
    const v = viewFor(s, 'p2');
    expect(revealLines(v)).toEqual([expect.stringContaining('Grinning Demon')]);
    const { container } = render(<RevealNotice view={v} />);
    expect(container.textContent).toContain('Revealed: The face-down permanent is revealed as it leaves the battlefield: it is Grinning Demon.');
  });

  it('at the end of the game every face-down permanent and spell is named (the view shows them to everybody then)', () => {
    const { s } = table();
    const over: GameState = { ...s, result: { winner: 'p2', reason: 'test' } };
    const v: GameView = viewFor(over, 'p2');
    expect(revealedAtEnd(v).map((x) => x.text).sort()).toEqual([
      "Alice's face-down creature was Den Protector",
      "Alice's face-down creature was Exalted Angel",
      "Alice's face-down spell was Grinning Demon",
    ]);
    // while the game runs, nothing is revealed to the opponent
    expect(revealedAtEnd(viewFor(s, 'p2'))).toEqual([]);
    render(<RevealNotice view={viewFor(s, 'p2')} />);
    expect(pageText()).not.toContain('Den Protector');
  });
});
