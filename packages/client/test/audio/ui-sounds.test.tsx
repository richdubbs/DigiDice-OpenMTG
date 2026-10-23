/**
 * The delegated interface sounds (src/audio/uiSounds.ts): which control makes which ui.* sound, data-sfx and "none", the manual scope, the dedupe with a
 * handler's own sound (also through React: a dialog's ui.open, a screen's ui.navigate), toggles, selects, sliders, typing and hover with their rate
 * limits. Nothing is heard in jsdom; a fake player (or the page's engine, through recordSounds) records what would play.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NavProvider, useNav } from '../../src/app/nav';
import type { SoundId } from '../../src/audio/catalog';
import { recordSounds, resetSoundEngineForTests, sfx, soundEngine } from '../../src/audio/sfx';
import { HOVER_GAP_MS, TICK_GAP_MS, TYPE_GAP_MS, clickSound, installUiSounds, type UiSoundPlayer } from '../../src/audio/uiSounds';
import { Modal } from '../../src/decks/chrome';

class FakePlayer implements UiSoundPlayer {
  readonly ids: SoundId[] = [];
  get playCount(): number {
    return this.ids.length;
  }
  play(id: SoundId): void {
    this.ids.push(id);
  }
}

/** Lets the deferred generic click (a microtask) run. */
const settle = () => act(async () => undefined);

let root: HTMLDivElement;
let player: FakePlayer;
let clock: number;
let uninstall: () => void;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  player = new FakePlayer();
  clock = 1000;
  uninstall = installUiSounds(root, player, { now: () => clock });
});

afterEach(() => {
  uninstall();
  root.remove();
  resetSoundEngineForTests();
});

function html(markup: string): void {
  root.innerHTML = markup;
}

const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;

async function clickOn(sel: string): Promise<SoundId[]> {
  player.ids.length = 0;
  fireEvent.click(q(sel));
  await settle();
  return [...player.ids];
}

function pointerOver(target: Element, pointerType: string, relatedTarget: Element | null = null): void {
  // jsdom has no PointerEvent: a mouse event with the pointer's type is what the listener reads.
  const ev = new MouseEvent('pointerover', { bubbles: true, relatedTarget });
  Object.defineProperty(ev, 'pointerType', { value: pointerType });
  target.dispatchEvent(ev);
}

describe('clicks', () => {
  it('ordinary buttons click; primary and submit buttons confirm; Back, Cancel, Close and Clear cancel', async () => {
    html(`
      <button id="plain">Rename</button>
      <button id="primary" class="button-primary">Done</button>
      <form onsubmit="return false"><button id="submit" type="submit">Save</button></form>
      <button id="cancel" class="button-link">Cancel</button>
      <button id="close">Close</button>
      <button id="clear" aria-label="Clear search">×</button>
      <button id="back" class="screen-back" aria-label="Back"><svg></svg>Back</button>
      <button id="deckback" class="deck-back" aria-label="Back"></button>
      <a id="link" href="#x">Docs</a>
      <div id="rb" role="button">Chip</div>
      <label id="lb" class="button">Choose files</label>
    `);
    expect(await clickOn('#plain')).toEqual(['ui.click']);
    expect(await clickOn('#primary')).toEqual(['ui.confirm']);
    expect(await clickOn('#submit')).toEqual(['ui.confirm']);
    expect(await clickOn('#cancel')).toEqual(['ui.cancel']);
    expect(await clickOn('#close')).toEqual(['ui.cancel']);
    expect(await clickOn('#clear')).toEqual(['ui.cancel']);
    expect(await clickOn('#back')).toEqual(['ui.cancel']);
    expect(await clickOn('#deckback')).toEqual(['ui.cancel']);
    expect(await clickOn('#link')).toEqual(['ui.click']);
    expect(await clickOn('#rb')).toEqual(['ui.click']);
    expect(await clickOn('#lb')).toEqual(['ui.click']);
  });

  it('Cancel, Close and Dismiss inside a dialog close it (ui.close, not ui.cancel); Clear inside a dialog still cancels', async () => {
    html(`
      <div role="dialog"><button id="c">Cancel</button><button id="x" aria-label="Close">×</button><button id="clr">Clear</button></div>
      <div role="alertdialog"><button id="d">Dismiss</button><button id="ok" class="button-primary">Save</button></div>
    `);
    expect(await clickOn('#c')).toEqual(['ui.close']);
    expect(await clickOn('#x')).toEqual(['ui.close']);
    expect(await clickOn('#d')).toEqual(['ui.close']);
    expect(await clickOn('#clr')).toEqual(['ui.cancel']);
    expect(await clickOn('#ok')).toEqual(['ui.confirm']);
  });

  it('a click on an icon inside a button is the button\'s', async () => {
    html('<button class="button-primary"><svg><path id="icon"></path></svg> OK</button>');
    expect(await clickOn('#icon')).toEqual(['ui.confirm']);
  });

  it('data-sfx names the sound, "none" silences it; an unknown id falls back to the rules', async () => {
    html('<button id="a" data-sfx="ui.delete">Delete</button><button id="b" data-sfx="none">Copy</button><button id="c" data-sfx="nope">X</button>');
    expect(await clickOn('#a')).toEqual(['ui.delete']);
    expect(await clickOn('#b')).toEqual([]);
    expect(await clickOn('#c')).toEqual(['ui.click']);
  });

  it('a summary opens and closes its panel', async () => {
    html('<details id="d"><summary id="s">More</summary><p>Inside</p></details>');
    expect(clickSound(q('#s'))).toBe('ui.open');
    q<HTMLDetailsElement>('#d').open = true;
    expect(clickSound(q('#s'))).toBe('ui.close');
  });

  it('disabled controls, plain elements and the manual scope are silent', async () => {
    html(`
      <label id="off" class="button" aria-disabled="true">Choose</label>
      <p id="text">Just text</p>
      <div data-sfx-scope="manual"><button id="board">Card</button></div>
    `);
    expect(await clickOn('#off')).toEqual([]);
    expect(await clickOn('#text')).toEqual([]);
    expect(await clickOn('#board')).toEqual([]);
  });

  it('a handler that plays its own sound for the click replaces the generic one', async () => {
    html('<button id="b" class="button-primary">Import</button><button id="c">Other</button>');
    q('#b').addEventListener('click', () => player.play('ui.success'));
    expect(await clickOn('#b')).toEqual(['ui.success']);
    // The next click is counted afresh.
    expect(await clickOn('#c')).toEqual(['ui.click']);
  });
});

describe('clicks through React (the page engine)', () => {
  beforeEach(() => {
    uninstall();
    resetSoundEngineForTests();
    uninstall = installUiSounds(document, soundEngine(), { now: () => clock });
  });

  function Opener() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Export
        </button>
        {open && (
          <Modal label="Export" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </Modal>
        )}
      </>
    );
  }

  it('a button that opens a dialog sounds ui.open, not a click; its Close button and Escape close it with ui.close only', async () => {
    const rec = recordSounds();
    render(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await settle();
    expect(rec.ids).toEqual(['ui.open']);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await settle();
    expect(rec.ids).toEqual(['ui.open', 'ui.close']);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await settle();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await settle();
    expect(rec.ids).toEqual(['ui.open', 'ui.close', 'ui.open', 'ui.close']);
    expect(screen.queryByRole('dialog')).toBeNull();
    rec.stop();
  });

  function Screens() {
    const nav = useNav();
    return (
      <>
        <p data-testid="screen">{nav.route.screen}</p>
        <button type="button" onClick={() => nav.go({ screen: 'decks' })}>
          Decks
        </button>
        <button type="button" onClick={() => nav.go({ screen: nav.route.screen } as never)}>
          Same
        </button>
        <button type="button" className="screen-back" onClick={nav.back}>
          Back
        </button>
        <button type="button" onClick={() => nav.reset({ screen: 'settings' })}>
          Settings
        </button>
      </>
    );
  }

  it('changing screens sounds ui.navigate (go, back, reset) instead of the button\'s own sound; staying on the screen does not', async () => {
    const rec = recordSounds();
    render(
      <NavProvider>
        <Screens />
      </NavProvider>,
    );
    const press = async (name: string) => {
      fireEvent.click(screen.getByRole('button', { name }));
      await settle();
    };
    await press('Decks');
    expect(screen.getByTestId('screen').textContent).toBe('decks');
    expect(rec.ids).toEqual(['ui.navigate']);
    await press('Same');
    // The route changed but not the screen: only the button's click.
    expect(rec.ids).toEqual(['ui.navigate', 'ui.click']);
    await press('Back');
    await press('Back');
    // decks -> decks -> home: the first Back stays on Decks (a cancel), the second changes the screen.
    expect(rec.ids).toEqual(['ui.navigate', 'ui.click', 'ui.cancel', 'ui.navigate']);
    await press('Settings');
    expect(screen.getByTestId('screen').textContent).toBe('settings');
    expect(rec.ids.slice(-1)).toEqual(['ui.navigate']);
    // Back sweeps the other way (mirrored); go and reset as designed.
    expect(rec.calls.filter((c) => c.id === 'ui.navigate').map((c) => c.opts.mirror === true)).toEqual([false, true, false]);
    rec.stop();
  });
});

describe('toggles, choices, sliders', () => {
  it('a checkbox turns on and off; a radio and a select pick', () => {
    html(`
      <input id="cb" type="checkbox">
      <input id="r1" type="radio" name="g"><input id="r2" type="radio" name="g">
      <select id="sel"><option value="a">A</option><option value="b">B</option></select>
    `);
    fireEvent.click(q('#cb'));
    fireEvent.click(q('#cb'));
    fireEvent.click(q('#r2'));
    fireEvent.change(q('#sel'), { target: { value: 'b' } });
    expect(player.ids).toEqual(['ui.toggleOn', 'ui.toggleOff', 'ui.select', 'ui.select']);
  });

  it('a checkbox in a label sounds once, as a toggle (the label is not a button)', async () => {
    html('<label class="settings-check"><input id="cb" type="checkbox"><span id="t">Sound effects</span></label>');
    fireEvent.click(q('#t'));
    await settle();
    expect(player.ids).toEqual(['ui.toggleOn']);
  });

  it('a slider ticks as it moves, at most once per TICK_GAP_MS', () => {
    html('<input id="r" type="range" min="0" max="100">');
    const r = q<HTMLInputElement>('#r');
    for (let v = 10; v <= 50; v += 10) {
      fireEvent.input(r, { target: { value: String(v) } });
      clock += TICK_GAP_MS / 3;
    }
    // 5 moves within 5/3 gaps: the first and the one a full gap later.
    expect(player.ids).toEqual(['ui.tick', 'ui.tick']);
    clock += TICK_GAP_MS;
    fireEvent.input(r, { target: { value: '60' } });
    expect(player.ids).toHaveLength(3);
  });
});

describe('typing', () => {
  it('printable keys, Backspace and Delete in a text field type; Enter, Escape, Tab, arrows and shortcuts do not', () => {
    html('<input id="t" type="text"><textarea id="ta"></textarea>');
    const t = q('#t');
    for (const key of ['a', ' ', 'Backspace', 'Delete']) {
      fireEvent.keyDown(t, { key });
      clock += TYPE_GAP_MS;
    }
    expect(player.ids).toEqual(['ui.type', 'ui.type', 'ui.type', 'ui.type']);
    player.ids.length = 0;
    for (const key of ['Enter', 'Escape', 'Tab', 'ArrowLeft', 'Shift']) {
      fireEvent.keyDown(t, { key });
      clock += TYPE_GAP_MS;
    }
    fireEvent.keyDown(t, { key: 'a', ctrlKey: true });
    clock += TYPE_GAP_MS;
    fireEvent.keyDown(t, { key: 'v', metaKey: true });
    clock += TYPE_GAP_MS;
    expect(player.ids).toEqual([]);
    fireEvent.keyDown(q('#ta'), { key: 'x' });
    expect(player.ids).toEqual(['ui.type']);
  });

  it('is rate-limited to one per TYPE_GAP_MS, and silent in read-only fields, checkboxes and outside fields', () => {
    html('<input id="t" type="text"><textarea id="ro" readonly></textarea><input id="cb" type="checkbox"><button id="b">B</button>');
    fireEvent.keyDown(q('#t'), { key: 'a' });
    clock += TYPE_GAP_MS - 1;
    fireEvent.keyDown(q('#t'), { key: 'b' });
    expect(player.ids).toEqual(['ui.type']);
    clock += 1;
    fireEvent.keyDown(q('#t'), { key: 'c' });
    expect(player.ids).toEqual(['ui.type', 'ui.type']);
    clock += TYPE_GAP_MS;
    fireEvent.keyDown(q('#ro'), { key: 'a' });
    fireEvent.keyDown(q('#cb'), { key: 'a' });
    fireEvent.keyDown(q('#b'), { key: 'a' });
    expect(player.ids).toHaveLength(2);
  });
});

describe('hover', () => {
  it('the mouse or pen entering a button or link hovers; moving inside it, touch, disabled buttons and plain elements do not', () => {
    html(`
      <button id="b"><span id="inner">Play</span></button>
      <a id="a" href="#x">Link</a>
      <button id="off" disabled>Off</button>
      <p id="p">text</p>
    `);
    pointerOver(q('#b'), 'mouse', q('#p'));
    expect(player.ids).toEqual(['ui.hover']);
    clock += HOVER_GAP_MS;
    // From the button onto its own label: still the same button.
    pointerOver(q('#inner'), 'mouse', q('#b'));
    expect(player.ids).toHaveLength(1);
    pointerOver(q('#a'), 'touch');
    pointerOver(q('#off'), 'mouse');
    pointerOver(q('#p'), 'mouse');
    expect(player.ids).toHaveLength(1);
    pointerOver(q('#a'), 'pen', q('#b'));
    expect(player.ids).toEqual(['ui.hover', 'ui.hover']);
  });

  it('a sweep across a toolbar is rate-limited to one per HOVER_GAP_MS', () => {
    html('<button id="a">A</button><button id="b">B</button><button id="c">C</button>');
    pointerOver(q('#a'), 'mouse');
    clock += 20;
    pointerOver(q('#b'), 'mouse', q('#a'));
    clock += 20;
    pointerOver(q('#c'), 'mouse', q('#b'));
    expect(player.ids).toEqual(['ui.hover']);
    clock += HOVER_GAP_MS;
    pointerOver(q('#a'), 'mouse', q('#c'));
    expect(player.ids).toEqual(['ui.hover', 'ui.hover']);
  });
});

describe('install', () => {
  it('uninstall removes every listener', async () => {
    html('<button id="b">B</button><input id="t" type="text">');
    uninstall();
    fireEvent.click(q('#b'));
    fireEvent.keyDown(q('#t'), { key: 'a' });
    await settle();
    expect(player.ids).toEqual([]);
    uninstall = () => undefined;
  });

  it('the page engine counts every sound asked for (what the dedupe reads), heard or not', () => {
    resetSoundEngineForTests();
    const before = soundEngine().playCount;
    sfx('ui.click');
    sfx('deck.add');
    expect(soundEngine().playCount).toBe(before + 2);
  });
});
