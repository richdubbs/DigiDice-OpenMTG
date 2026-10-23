/**
 * Board behaviour fixed after the C4 review: attachments are their own controls, the zoom stays clear of the stack and follows keyboard focus, automation
 * badges follow design 10.5, zone buttons show playable and selectable cards, other players' decisions are not called priority, face-down and flipped cards
 * are drawn by their real state, the zone viewer is a real modal, and clickable cards have full accessible names.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { legalActions, type CardDef, type GameView, type LegalAction, type ObjectId } from '@openmtg/engine';
import { describe, expect, it, vi } from 'vitest';
import { GameBoard, objectName, type BoardCardProps } from '../../src/board';
import { automationMarkers } from '../../src/board/Markers';
import { ALICE, BOB, editable, playGame, type Captured } from './fixtures';

const game = playGame(6, undefined, (s) => s.zones.stack.length > 0);

function at(turn: number, step: string, viewer = ALICE): Captured {
  const c = game.captured.find((x) => x.turn === turn && x.step === step && x.view.viewer === viewer);
  if (!c) throw new Error(`no capture at ${turn}:${step}`);
  return c;
}

function named(view: GameView, controller: string, name: string): ObjectId[] {
  return view.zones.battlefield.filter((id) => view.objects[id]!.controller === controller && view.defs[view.objects[id]!.defId]?.name === name);
}

function slot(container: HTMLElement, id: ObjectId): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.board-card[data-object-id="${id}"]`);
  if (!el) throw new Error(`no card slot for ${id}`);
  return el;
}

function defIdOf(view: GameView, name: string): string {
  return Object.keys(view.defs).find((k) => view.defs[k]!.name === name)!;
}

/** Alice's view on turn 5 with one of her Forests attached to one of her Test Bears. */
function withAttachment() {
  const v = editable(at(5, 'main1').view);
  const [bear] = named(v, ALICE, 'Test Bear');
  const [forest] = named(v, ALICE, 'Forest');
  v.objects[forest!] = { ...v.objects[forest!]!, attachedTo: bear! };
  return { v, bear: bear!, forest: forest! };
}

const spyRenderer = (p: BoardCardProps) => <span className="spy" data-def={p.def?.name ?? 'back'} data-face-index={p.face} data-face-down={String(p.faceDown)} />;

describe('CR 301.5, 303.4: attachments are separate controls', () => {
  it('clicking or pressing Enter on an attached card reports only that card, never its host', () => {
    const { v, bear, forest } = withAttachment();
    const onObjectClick = vi.fn();
    const { container } = render(<GameBoard view={v} interaction={{ selectable: [bear, forest], onObjectClick }} />);
    fireEvent.click(slot(container, forest));
    expect(onObjectClick.mock.calls).toEqual([[forest]]);
    onObjectClick.mockClear();
    fireEvent.keyDown(slot(container, forest), { key: 'Enter' });
    expect(onObjectClick.mock.calls).toEqual([[forest]]);
  });

  it('no button is nested inside another button, and the attachment is tucked under its host with no "Attached to" chip', () => {
    const { v, bear, forest } = withAttachment();
    const { container } = render(<GameBoard view={v} interaction={{ selectable: [bear, forest], onObjectClick: () => {} }} />);
    expect(slot(container, forest).parentElement!.closest('[role="button"]')).toBeNull();
    expect(slot(container, bear).contains(slot(container, forest))).toBe(false);
    const group = slot(container, bear).closest<HTMLElement>('.permanent-group')!;
    expect(slot(container, forest).closest('.permanent-group')).toBe(group);
    expect(slot(container, forest).closest('.attachment')).not.toBeNull();
    expect(group.style.getPropertyValue('--att-n')).toBe('1');
    expect(within(group).queryByText(/^Attached to/)).toBeNull();
    expect(within(group).getByRole('group', { name: 'Attached to Test Bear' }).contains(slot(container, forest))).toBe(true);
  });
});

describe('CR 405: the card zoom', () => {
  it('pointing at a spell on the stack shows the zoom outside the side column, so the stack stays visible', () => {
    const k = game.kept.find((x) => x.view.viewer === ALICE)!;
    const { container } = render(<GameBoard view={k.view} />);
    const top = k.view.zones.stack[k.view.zones.stack.length - 1]!;
    fireEvent.mouseEnter(slot(container, top));
    const zoom = container.querySelector('.zoom:not(.zoom-empty)');
    expect(zoom).not.toBeNull();
    expect(zoom!.closest('.board-side')).toBeNull();
    expect(container.querySelector('.board-side')!.contains(container.querySelector('.stack-panel'))).toBe(true);
  });

  it('keyboard focus on any visible card (also the opponent\'s) shows the zoom', () => {
    const c = at(5, 'main1');
    const [bobBear] = named(c.view, BOB, 'Test Bear');
    const { container } = render(<GameBoard view={c.view} />);
    const el = slot(container, bobBear!);
    expect(el.getAttribute('tabindex')).toBe('0');
    fireEvent.focus(el);
    expect(container.querySelector('.zoom:not(.zoom-empty)')).not.toBeNull();
    fireEvent.blur(el);
    expect(container.querySelector('.zoom:not(.zoom-empty)')).toBeNull();
  });
});

describe('CL3: the card zoom never stays open (STATUS, wave M8-C6 verification gap 5)', () => {
  const shownZoom = (container: HTMLElement) => container.querySelector('.zoom:not(.zoom-empty)');
  function bears() {
    const c = at(5, 'main1');
    const [mine] = named(c.view, ALICE, 'Test Bear');
    const [theirs] = named(c.view, BOB, 'Test Bear');
    return { view: c.view, mine: mine!, theirs: theirs! };
  }

  it('a zoom opened by keyboard focus closes when the pointer moves anywhere but that card, and stays while it moves over the card', () => {
    const { view, mine, theirs } = bears();
    const onObjectHover = vi.fn();
    const { container } = render(<GameBoard view={view} interaction={{ onObjectHover }} />);
    fireEvent.focus(slot(container, mine));
    expect(shownZoom(container)).not.toBeNull();
    fireEvent.mouseMove(slot(container, mine).querySelector('.board-card-image')!);
    expect(shownZoom(container)).not.toBeNull();
    fireEvent.mouseMove(slot(container, theirs));
    expect(shownZoom(container)).toBeNull();
    expect(onObjectHover).toHaveBeenLastCalledWith(null);
  });

  it('a pointer move over the board closes a zoom whose card element went away without a mouseleave (re-rendered elsewhere)', () => {
    const { view, mine } = bears();
    const { container } = render(<GameBoard view={view} />);
    const el = slot(container, mine);
    fireEvent.mouseEnter(el);
    expect(shownZoom(container)).not.toBeNull();
    el.remove(); // as when the card's element is replaced and the browser never sends mouseleave
    fireEvent.pointerMove(container.querySelector('.board-main')!);
    expect(shownZoom(container)).toBeNull();
  });

  it('Escape closes the zoom without taking the key from the prompt (cancel, CR 733.1)', () => {
    const { view, mine } = bears();
    const { container } = render(<GameBoard view={view} />);
    fireEvent.mouseEnter(slot(container, mine));
    expect(shownZoom(container)).not.toBeNull();
    const notCancelled = fireEvent.keyDown(window, { key: 'Escape' });
    expect(shownZoom(container)).toBeNull();
    expect(notCancelled).toBe(true); // not preventDefault-ed: the prompt's Esc handler still sees it
  });

  it('a press anywhere else closes the zoom; a press on the zoomed card keeps it', () => {
    const { view, mine, theirs } = bears();
    const { container } = render(<GameBoard view={view} />);
    fireEvent.mouseEnter(slot(container, mine));
    fireEvent.mouseDown(slot(container, mine));
    expect(shownZoom(container)).not.toBeNull();
    fireEvent.pointerDown(slot(container, theirs));
    expect(shownZoom(container)).toBeNull();
    fireEvent.focus(slot(container, theirs)); // keyboard focus (no press before it)
    expect(shownZoom(container)).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(shownZoom(container)).toBeNull();
  });

  it('other keys and moves inside the card leave the zoom open', () => {
    const { view, mine } = bears();
    const { container } = render(<GameBoard view={view} />);
    fireEvent.mouseEnter(slot(container, mine));
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.pointerMove(slot(container, mine));
    expect(shownZoom(container)).not.toBeNull();
  });
});

describe('design 10.5: automation badges', () => {
  it('full (check), partial ("Partly automated") and manual ("Resolve by hand") each have a badge with an icon, not colour alone; none on the battlefield', () => {
    const v = editable(at(5, 'main1').view);
    const bearDef = defIdOf(v, 'Test Bear');
    const forestDef = defIdOf(v, 'Forest');
    v.defs[bearDef] = { ...v.defs[bearDef]!, automation: { ...v.defs[bearDef]!.automation, level: 'partial' } };
    v.defs[forestDef] = { ...v.defs[forestDef]!, automation: { ...v.defs[forestDef]!.automation, level: 'manual' } };
    const { container } = render(<GameBoard view={v} />);
    const [bear] = named(v, ALICE, 'Test Bear');
    const [forest] = named(v, ALICE, 'Forest');
    expect(within(slot(container, bear!)).queryByText('Partly automated')).toBeNull();
    expect(within(slot(container, forest!)).queryByText('Resolve by hand')).toBeNull();
    expect(container.querySelectorAll('.board-card[data-zone="battlefield"] .marker-automation')).toHaveLength(0);
    for (const level of ['full', 'partial', 'manual'] as const) {
      const [m] = automationMarkers({ ...v.defs[bearDef]!, automation: { ...v.defs[bearDef]!.automation, level } } as CardDef);
      expect(m?.icon, level).toBeTruthy();
    }
    expect(automationMarkers({ ...v.defs[bearDef]!, automation: { ...v.defs[bearDef]!.automation, level: 'full' } } as CardDef)[0]!.text).toBe('Fully automated');
  });

  it('a spell on the stack carries its automation badge', () => {
    const k = game.kept.find((x) => x.view.viewer === ALICE)!;
    const { container } = render(<GameBoard view={k.view} />);
    const top = k.view.zones.stack[k.view.zones.stack.length - 1]!;
    expect(within(container.querySelector<HTMLElement>(`[data-stack-id="${top}"]`)!).getByText('Fully automated')).toBeTruthy();
  });

  it('a permanent with a manual triggered ability shows no chip on the battlefield ("Triggers to check" lists its triggers)', () => {
    const v = editable(at(5, 'main1').view);
    const bearDef = defIdOf(v, 'Test Bear');
    v.defs[bearDef] = {
      ...v.defs[bearDef]!,
      automation: { ...v.defs[bearDef]!.automation, level: 'partial', faces: [{ abilities: [{ level: 'manual', manual: [{ path: '', text: 'When ...', reason: 'no template', impact: 'trigger' }] }] }] },
    };
    const { container } = render(<GameBoard view={v} />);
    const [bear] = named(v, ALICE, 'Test Bear');
    expect(within(slot(container, bear!)).queryByText('Manual trigger')).toBeNull();
  });
});

describe('CR 117.1, 702.34: zone buttons show what can be done from them', () => {
  it('a playable card in a graveyard (flashback) marks the graveyard button; a selectable one is counted too', () => {
    const c = game.captured.filter((x) => x.view.zones.graveyard[BOB]!.length > 0 && x.view.viewer === ALICE).pop()!;
    const v = editable(c.view);
    const gy = v.zones.graveyard[BOB]!;
    v.zones.graveyard[BOB] = [gy[0]!];
    const cast: LegalAction = { kind: 'cast', isMana: false, label: 'Cast with flashback', object: gy[0]!, action: { type: 'pass', player: ALICE } };
    const { container, rerender } = render(<GameBoard view={v} legalActions={[cast]} />);
    const button = screen.getByRole('button', { name: "Bob's graveyard: 1 card, 1 playable" });
    expect(button.classList.contains('has-playable')).toBe(true);
    expect(within(button).getByText('1 playable')).toBeTruthy();
    rerender(<GameBoard view={v} interaction={{ selectable: [gy[0]!], onObjectClick: () => {} }} />);
    expect(screen.getByRole('button', { name: "Bob's graveyard: 1 card, 1 to choose" }).classList.contains('has-selectable')).toBe(true);
    expect(container.querySelector('.zone-button.has-playable')).toBeNull();
  });
});

describe('CR 117: whose decision it is', () => {
  it('another player\'s pending decision is shown as Deciding (the view does not say which), the viewer\'s own priority as Priority', () => {
    const v = editable(at(5, 'main1').view);
    v.pending = { kind: 'priority', id: 'd-x', player: BOB, prompt: 'Waiting for the other player to decide.' } as GameView['pending'];
    const { container, rerender } = render(<GameBoard view={v} />);
    const bob = container.querySelector<HTMLElement>(`.player-panel[data-player-id="${BOB}"]`)!;
    expect(within(bob).getByText('Deciding')).toBeTruthy();
    expect(within(bob).queryByText('Priority')).toBeNull();
    const own = editable(at(5, 'main1').view);
    rerender(<GameBoard view={own} />);
    const alice = container.querySelector<HTMLElement>(`.player-panel[data-player-id="${ALICE}"]`)!;
    expect(within(alice).getByText('Priority')).toBeTruthy();
  });
});

describe('CR 708, 710: face-down and flipped permanents', () => {
  it('CR 708.5: the controller\'s own face-down permanent is a card back with a name; the zoom shows the real card, labelled', () => {
    const v = editable(at(5, 'main1').view);
    const [bear] = named(v, ALICE, 'Test Bear');
    v.objects[bear!] = { ...v.objects[bear!]!, faceDown: true };
    expect(objectName(v, bear!)).toBe('Face-down 2/2 creature (Test Bear)');
    const { container } = render(<GameBoard view={v} renderCard={spyRenderer} />);
    const el = slot(container, bear!);
    expect(el.getAttribute('data-face')).toBe('down');
    expect(el.getAttribute('aria-label')).toBe('Face-down 2/2 creature (Test Bear) (Alice)');
    const spy = el.querySelector('.board-card-image .spy')!;
    expect(spy.getAttribute('data-def')).toBe('back');
    expect(spy.getAttribute('data-face-down')).toBe('true');
    expect(el.textContent).not.toContain('{1}{G}');
    fireEvent.mouseEnter(el);
    const zoom = container.querySelector<HTMLElement>('.zoom:not(.zoom-empty)')!;
    expect(within(zoom).getByText('Face down (only you can see it): Test Bear')).toBeTruthy();
    expect(zoom.querySelector('.spy')!.getAttribute('data-def')).toBe('Test Bear');
  });

  it('CR 710.2: a flipped flip card is drawn with its flipped face', () => {
    const v = editable(at(5, 'main1').view);
    const [bear] = named(v, ALICE, 'Test Bear');
    const d = defIdOf(v, 'Test Bear');
    const def = v.defs[d]!;
    v.defs[d] = { ...def, layout: 'flip', faces: [def.faces[0]!, { ...def.faces[0]!, name: 'Flipped Bear' }] };
    v.objects[bear!] = { ...v.objects[bear!]!, flipped: true };
    const { container } = render(<GameBoard view={v} renderCard={spyRenderer} />);
    expect(slot(container, bear!).querySelector('.spy')!.getAttribute('data-face-index')).toBe('1');
    expect(slot(container, bear!).getAttribute('aria-label')).toBe('Flipped Bear (Alice)');
  });
});

describe('CR 404, 406: the zone viewer is a modal dialog', () => {
  const gyView = () => game.captured.filter((x) => x.view.zones.graveyard[BOB]!.length > 0 && x.view.viewer === ALICE).pop()!.view;

  it('traps focus, closes with Escape from anywhere, returns focus to its button, and only one is open at a time', () => {
    const v = gyView();
    render(<GameBoard view={v} />);
    const open = screen.getByRole('button', { name: /^Bob's graveyard: \d+ cards?$/ });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: "Bob's graveyard" });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    // Tab from the last control wraps to the first; focus moved outside comes back
    const focusables = [...dialog.querySelectorAll<HTMLElement>('button, [tabindex="0"]')];
    focusables[focusables.length - 1]!.focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(document.activeElement).toBe(focusables[0]);
    screen.getByRole('button', { name: /^Bob's exile/ }).focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    // a second viewer replaces the first
    fireEvent.click(screen.getByRole('button', { name: /^Alice's graveyard/ }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe("Alice's graveyard");
    const aliceButton = screen.getByRole('button', { name: /^Alice's graveyard/ });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(aliceButton);
  });

  it('clicking the backdrop closes it, and counts are singular for one card', () => {
    const v = editable(gyView());
    v.zones.graveyard[BOB] = [v.zones.graveyard[BOB]![0]!];
    const { container } = render(<GameBoard view={v} />);
    fireEvent.click(screen.getByRole('button', { name: "Bob's graveyard: 1 card" }));
    fireEvent.click(container.querySelector('.zone-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('accessible names of cards', () => {
  it('a clickable card is named with its controller and described by its markers (tapped) and what is on the card (P/T)', () => {
    const v = editable(at(5, 'main1').view);
    const [bobBear] = named(v, BOB, 'Test Bear');
    v.objects[bobBear!] = { ...v.objects[bobBear!]!, tapped: true };
    const { container } = render(<GameBoard view={v} interaction={{ selectable: [bobBear!], onObjectClick: () => {} }} />);
    const el = slot(container, bobBear!);
    expect(el.getAttribute('role')).toBe('button');
    expect(el.getAttribute('aria-label')).toBe('Test Bear (Bob)');
    const described = el.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)!.textContent).join(' ');
    expect(described).toContain('Tapped');
    expect(described).toContain('Power/toughness 2/2');
    expect(el.getAttribute('aria-pressed')).toBe('false');
  });

  it('a merely playable card is a plain button, not a toggle', () => {
    const c = at(1, 'main1');
    const legal = legalActions(c.state, ALICE);
    const { container } = render(<GameBoard view={c.view} legalActions={legal} interaction={{ onObjectClick: () => {} }} />);
    const playable = [...container.querySelectorAll<HTMLElement>('.board-card[data-highlight="playable"]')];
    expect(playable.length).toBeGreaterThan(0);
    for (const el of playable) expect(el.hasAttribute('aria-pressed')).toBe(false);
  });
});
