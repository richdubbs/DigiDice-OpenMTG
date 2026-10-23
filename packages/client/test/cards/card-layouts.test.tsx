/**
 * The placeholder frame for every layout (ARCHITECTURE.md "Card images" A: name, mana cost, type line, rules text, P/T or loyalty, styled by color, no
 * Wizards symbols or frames), tapped and flipped rotation, the face toggle of double-faced cards, the card back, the automation badge outside the
 * picture, and hover zoom.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { compileCard, type CardDef } from '@openmtg/engine';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card } from '../../src/cards/Card';
import { modelFromDef, modelFromSummary, slotOfFace, type CardModel } from '../../src/cards/model';
import { CardImagesProvider } from '../../src/images/context';
import { def, fixtureToken, summary, testImages } from '../card-fixtures';

const model = (name: string): CardModel => modelFromDef(def(name));

function show(ui: ReactElement) {
  const { images } = testImages();
  return render(<CardImagesProvider images={images}>{ui}</CardImagesProvider>);
}

const frameOf = (c: HTMLElement) => c.querySelector('.card-frame') as HTMLElement;
const names = (c: HTMLElement) => [...c.querySelectorAll('.frame-name')].map((n) => n.textContent);

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('normal cards', () => {
  it('shows name, mana cost as our glyphs, type line, rules text and P/T, toned by the card color (CR 202.2)', () => {
    const { container } = show(<Card card={model('Aardvark Sloth')} />);
    const frame = frameOf(container);
    expect(frame.dataset.layout).toBe('normal');
    expect(frame.dataset.tone).toBe('W');
    expect(names(container)).toEqual(['Aardvark Sloth']);
    expect(within(frame).getByRole('group', { name: 'Mana cost: 3 generic mana, one white mana' })).toBeTruthy();
    expect(within(frame).getByText('Creature — Sloth Beast')).toBeTruthy();
    expect(frame.textContent).toContain('Lifelink');
    expect(within(frame).getByLabelText('Power and toughness 3/3')).toBeTruthy();
    // Reminder text (CR 207.2a) is dimmed, never painted manual.
    expect(frame.querySelector('[data-status="reminder"]')?.textContent).toMatch(/Damage dealt by this creature/);
  });

  it('tones lands, colorless artifacts and multicolored cards (our own palette)', () => {
    expect(frameOf(show(<Card card={model('Forest')} />).container).dataset.tone).toBe('land');
    expect(frameOf(show(<Card card={model('Bonesplitter')} />).container).dataset.tone).toBe('artifact');
    expect(frameOf(show(<Card card={model('Bard Class')} />).container).dataset.tone).toBe('multi');
  });

  it('a basic land with no mana cost shows no glyphs (CR 202.1b)', () => {
    const { container } = show(<Card card={model('Forest')} />);
    expect(container.querySelector('.mana-cost')).toBeNull();
  });
});

describe('two halves, one picture', () => {
  it('CR 709: a split card shows both halves with their own costs', () => {
    const { container } = show(<Card card={model('Commit // Memory')} />);
    expect(frameOf(container).dataset.layout).toBe('split');
    expect(names(container)).toEqual(['Commit', 'Memory']);
    expect(screen.getByRole('group', { name: 'Mana cost: 3 generic mana, one blue mana' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Mana cost: 4 generic mana, one blue mana, one blue mana' })).toBeTruthy();
  });

  it('CR 715: an adventurer card shows the adventure as an inset beside the creature text', () => {
    const { container } = show(<Card card={model('Bonecrusher Giant // Stomp')} />);
    const inset = container.querySelector('.frame-adventure') as HTMLElement;
    expect(within(inset).getByText('Stomp')).toBeTruthy();
    expect(within(inset).getByText('Instant — Adventure')).toBeTruthy();
    expect(names(container)[0]).toBe('Bonecrusher Giant');
    expect(screen.getByLabelText('Power and toughness 4/3')).toBeTruthy();
  });

  it('CR 710: a flip card shows the flipped half upside down, and a flipped card turns 180 degrees', () => {
    const m = model('Akki Lavarunner // Tok-Tok, Volcano Born');
    const { container } = show(<Card card={m} />);
    expect(container.querySelector('.frame-upside-down .frame-name')?.textContent).toBe('Tok-Tok, Volcano Born');
    expect((container.querySelector('.card-box') as HTMLElement).dataset.rotation).toBe('0');
    const flipped = show(<Card card={m} flipped />).container;
    expect((flipped.querySelector('.card-box') as HTMLElement).style.transform).toContain('rotate(180deg)');
  });

  it('CR 722.1: a preparation card shows its prepare spell in an inset frame (CR 722.2: on the right), with both names, costs and texts', () => {
    const { container } = show(<Card card={model('Strife Scholar // Awaken the Ages')} />);
    expect(frameOf(container).dataset.layout).toBe('prepare');
    expect(names(container)).toEqual(['Strife Scholar', 'Awaken the Ages']);
    expect(screen.getByRole('group', { name: 'Mana cost: 2 generic mana, one red mana' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Mana cost: 5 generic mana, one red mana' })).toBeTruthy();
    const inset = container.querySelector('.frame-prepare') as HTMLElement;
    expect(within(inset).getByText('Awaken the Ages')).toBeTruthy();
    expect(within(inset).getByText('Sorcery')).toBeTruthy();
    expect(inset.textContent).toContain('Create two 2/2 red and white Spirit creature tokens.');
    // The card's own text box is on the left, the inset on the right (CR 722.2).
    const row = inset.parentElement!;
    expect(row.lastElementChild).toBe(inset);
    expect(row.firstElementChild?.textContent).toContain('Ward');
  });

  it('one-picture layouts have one image slot for every face (design 12.2)', () => {
    for (const n of ['Commit // Memory', 'Bonecrusher Giant // Stomp', 'Akki Lavarunner // Tok-Tok, Volcano Born', 'Strife Scholar // Awaken the Ages']) {
      const m = model(n);
      expect(m.slots).toHaveLength(1);
      expect(slotOfFace(m, 1)?.key).toBe(n);
    }
  });
});

describe('double-faced cards (CR 712)', () => {
  it('shows the front, names the back, and the face toggle shows the back side', () => {
    const { container } = show(<Card card={model('Delver of Secrets // Insectile Aberration')} />);
    expect(names(container)).toEqual(['Delver of Secrets']);
    expect(container.querySelector('.frame-other-side')?.textContent).toBe('Back: Insectile Aberration — Creature — Human Insect');
    fireEvent.click(screen.getByRole('button', { name: 'Show back of Delver of Secrets // Insectile Aberration' }));
    expect(names(container)).toEqual(['Insectile Aberration']);
    expect(screen.getByLabelText('Power and toughness 3/2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show front of Delver of Secrets // Insectile Aberration' }));
    expect(names(container)).toEqual(['Delver of Secrets']);
  });

  it('shows the face the game says is up (GameObject.face) and has one image slot per side', () => {
    const m = model("Agadeem's Awakening // Agadeem, the Undercrypt");
    const { container } = show(<Card card={m} face={1} />);
    expect(names(container)).toEqual(['Agadeem, the Undercrypt']);
    expect(frameOf(container).dataset.tone).toBe('land');
    expect(container.querySelector('.frame-other-side')?.textContent).toMatch(/^Front: Agadeem's Awakening — Sorcery/);
    expect(m.slots.map((s) => s.key)).toEqual(["Agadeem's Awakening", 'Agadeem, the Undercrypt']);
    expect(slotOfFace(m, 1)?.key).toBe('Agadeem, the Undercrypt');
  });

  it('CR 310: a battle shows its defense; its back is a creature', () => {
    const { container } = show(<Card card={model('Invasion of Ergamon // Truga Cliffcharger')} />);
    expect(screen.getByLabelText('Defense 5')).toBeTruthy();
    expect(frameOf(container).dataset.tone).toBe('multi');
    fireEvent.click(screen.getByRole('button', { name: /Show back of Invasion of Ergamon/ }));
    expect(names(container)).toEqual(['Truga Cliffcharger']);
  });
});

describe('structured frames', () => {
  it('CR 714: a saga shows its chapter numerals beside each chapter', () => {
    const { container } = show(<Card card={model('History of Benalia')} />);
    const chapters = [...container.querySelectorAll('.saga-chapter')];
    expect(chapters).toHaveLength(2);
    expect(within(chapters[0] as HTMLElement).getByLabelText('Chapter I, II')).toBeTruthy();
    expect(chapters[1]?.textContent).toMatch(/^IIIKnights you control get \+2\/\+1/);
  });

  it('CR 716: a class shows its levels with their costs', () => {
    const { container } = show(<Card card={model('Bard Class')} />);
    const levels = [...container.querySelectorAll('.class-level')];
    expect(levels.map((l) => l.getAttribute('aria-label'))).toEqual(['Level 2', 'Level 3']);
    expect(within(levels[1] as HTMLElement).getByRole('group', { name: 'Mana cost: 3 generic mana, one red mana, one green mana' })).toBeTruthy();
  });

  it('CR 606: a planeswalker shows loyalty costs beside its abilities and its loyalty', () => {
    const { container } = show(<Card card={model('Chandra, Torch of Defiance')} />);
    expect([...container.querySelectorAll('.loyalty-cost')].map((c) => c.textContent)).toEqual(['+1', '+1', '−3', '−7']);
    expect(screen.getByLabelText('Loyalty 4')).toBeTruthy();
    // "{R}{R}" inside the second ability is drawn as glyphs.
    expect(container.querySelectorAll('.loyalty-line .mana-glyph[data-symbol="R"]').length).toBe(2);
  });

  it('CR 711: a leveler shows its level bands and their P/T', () => {
    const { container } = show(<Card card={model('Student of Warfare')} />);
    expect([...container.querySelectorAll('.level-band')].map((b) => b.textContent)).toEqual(['Level 2-6', 'Level 7+']);
    expect([...container.querySelectorAll('.level-pt')].map((b) => b.textContent)).toEqual(['3/3', '4/4']);
  });

  it.each(['Case of the Locked Hothouse', 'Gemrazer', 'Phyrexian Fleshgorger'])('%s (one-sided layout) shows one frame and has one slot', (n) => {
    const m = model(n);
    const { container } = show(<Card card={m} />);
    expect(names(container)).toEqual([m.faces[0]!.name]);
    expect(frameOf(container).dataset.layout).toBe(m.layout);
    expect(m.slots).toHaveLength(1);
  });

  it('CR 712.4: a meld front shows one frame and has its own slot plus the melded back (design 12.2)', () => {
    const m = model('Gisela, the Broken Blade');
    const { container } = show(<Card card={m} />);
    expect(names(container)).toEqual(['Gisela, the Broken Blade']);
    expect(frameOf(container).dataset.layout).toBe('meld');
    expect(m.slots.map((s) => s.label)).toEqual(['Gisela, the Broken Blade', 'Brisela, Voice of Nightmares (melded back)']);
  });

  it('CR 111: a token is marked as a token and keyed by its variant', () => {
    const m = modelFromDef(compileCard(fixtureToken('Angel', '4', '4', 'Flying'))); // the 4/4 white Angel with flying (other Angel variants are fixtures too)
    const { container } = show(<Card card={m} />);
    expect(within(frameOf(container)).getByText('Token')).toBeTruthy();
    expect(screen.getByLabelText('Power and toughness 4/4')).toBeTruthy();
    expect(m.slots[0]?.key).toBe('Angel (4/4 W Creature — Angel; Flying)');
  });
});

describe('automation (design 10)', () => {
  it('paints manual text and shows the level in a badge under the card, outside the picture', () => {
    const odd: CardDef = compileCard({ name: 'Moon Gadget', layout: 'normal', mana_cost: '{2}', type_line: 'Artifact', oracle_text: 'Flying\nWhenever the moon wobbles, hum a strange tune.', colors: [] });
    const { container } = show(<Card card={modelFromDef(odd)} />);
    const manual = [...container.querySelectorAll('[data-status="manual"]')].map((s) => s.textContent).join(' ');
    expect(manual).toMatch(/moon wobbles/);
    const badge = screen.getByRole('img', { name: `Automation: ${odd.automation.level}` });
    expect(odd.automation.level).not.toBe('full');
    expect(container.querySelector('.card-box')?.contains(badge)).toBe(false);
    expect(container.querySelector('.card-meta')?.contains(badge)).toBe(true);
  });

  it('a fully automated card gets the "Full" badge (the word of the deckbuilder filter) and no painted text', () => {
    const d = def('Aardvark Sloth');
    const { container } = show(<Card card={modelFromDef(d)} />);
    expect(d.automation.level).toBe('full');
    expect(screen.getByRole('img', { name: 'Automation: full' }).textContent).toBe('Full');
    expect(container.querySelector('[data-status="manual"]')).toBeNull();
  });

  it('badge={false} hides it', () => {
    show(<Card card={model('Aardvark Sloth')} badge={false} />);
    expect(screen.queryByRole('img', { name: /Automation/ })).toBeNull();
  });
});

describe('hidden and face-down cards', () => {
  it('a hidden card is the DigiDice card back, with no badge and no zoom', () => {
    const { container } = show(<Card card={null} zoomDelayMs={0} />);
    const back = screen.getByAltText('Hidden card');
    expect(back.getAttribute('src')).toBe('/brand/sleeves/sleeve-classic.svg');
    expect(container.querySelector('.card-frame')).toBeNull();
    expect(container.querySelector('.automation-badge')).toBeNull();
    fireEvent.mouseEnter(container.querySelector('figure')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('CR 708.2: a face-down card shows the back; its controller can still zoom to see it', async () => {
    const { container } = show(<Card card={model('Aardvark Sloth')} faceDown zoomDelayMs={0} />);
    expect(screen.getByAltText('Face-down card')).toBeTruthy();
    expect(container.querySelector('.card-frame')).toBeNull();
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog', { name: 'Aardvark Sloth (zoomed)' });
    expect(within(zoom).getByText(/Face down/)).toBeTruthy();
  });
});

describe('tapped rotation and zoom', () => {
  it('CR 701.26a: a tapped card turns sideways (the slot becomes landscape)', () => {
    const { container } = show(<Card card={model('Forest')} tapped />);
    const fig = container.querySelector('figure')!;
    expect(fig.className).toContain('is-tapped');
    expect((fig.querySelector('.card-box') as HTMLElement).style.transform).toContain('rotate(90deg)');
    expect(show(<Card card={model('Forest')} tapped flipped />).container.querySelector('.card-box')?.getAttribute('data-rotation')).toBe('270');
  });

  it('hovering opens a large zoom with both sides of a double-faced card; leaving closes it', async () => {
    const { container } = show(<Card card={model('Delver of Secrets // Insectile Aberration')} zoomDelayMs={0} />);
    const fig = container.querySelector('figure')!;
    fireEvent.mouseEnter(fig);
    const zoom = await screen.findByRole('dialog', { name: 'Delver of Secrets // Insectile Aberration (zoomed)' });
    expect([...zoom.querySelectorAll('.frame-name')].map((n) => n.textContent)).toEqual(['Delver of Secrets', 'Insectile Aberration']);
    // The zoom lives outside the card (a portal), so it never covers anything drawn on the card.
    expect(fig.contains(zoom)).toBe(false);
    fireEvent.mouseLeave(fig);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the zoom lists what players resolve by hand', async () => {
    const odd = compileCard({ name: 'Moon Gadget', layout: 'normal', mana_cost: '{2}', type_line: 'Artifact', oracle_text: 'Whenever the moon wobbles, hum a strange tune.', colors: [] });
    const { container } = show(<Card card={modelFromDef(odd)} zoomDelayMs={0} />);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog');
    expect(within(zoom).getByText('Resolved by hand:')).toBeTruthy();
    expect(zoom.querySelectorAll('.card-zoom-manual li').length).toBe(odd.automation.unsupported.length);
  });

  it('zoom={false} never zooms; a pending zoom is cancelled when the pointer leaves', async () => {
    const { container } = show(<Card card={model('Forest')} zoom={false} zoomDelayMs={0} />);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(screen.queryByRole('dialog')).toBeNull();
    const other = show(<Card card={model('Forest')} zoomDelayMs={20} />).container.querySelector('figure')!;
    fireEvent.mouseEnter(other);
    fireEvent.mouseLeave(other);
    await act(async () => new Promise((r) => setTimeout(r, 40)));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a clickable card is a keyboard-usable button', () => {
    let clicks = 0;
    show(<Card card={model('Forest')} onClick={() => clicks++} />);
    const btn = screen.getByRole('button', { name: 'Forest' });
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(clicks).toBe(2);
  });
});

describe('the face toggle is its own control (CR 712)', () => {
  it('CR 712: Enter or Space on the face toggle of a clickable double-faced card turns it over and never runs the card action', () => {
    let clicks = 0;
    const { container } = show(<Card card={model('Delver of Secrets // Insectile Aberration')} onClick={() => clicks++} />);
    const toggle = screen.getByRole('button', { name: 'Show back of Delver of Secrets // Insectile Aberration' });
    // Not nested inside the card's own button.
    expect(toggle.parentElement?.closest('[role="button"]')).toBeNull();
    // The keydown reaches the toggle unhandled (the browser then clicks it): the card action does not run and nothing cancels the activation.
    expect(fireEvent.keyDown(toggle, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(toggle, { key: ' ' })).toBe(true);
    fireEvent.click(toggle);
    expect(clicks).toBe(0);
    expect(names(container)).toEqual(['Insectile Aberration']);
    // The card itself still answers Enter.
    fireEvent.keyDown(screen.getByRole('button', { name: 'Insectile Aberration' }), { key: 'Enter' });
    expect(clicks).toBe(1);
  });
});

describe('flipped flip cards (CR 710.2)', () => {
  it('CR 710.2: a flipped card is named after its flipped half, and the zoom shows that half upright', async () => {
    const m = model('Akki Lavarunner // Tok-Tok, Volcano Born');
    show(<Card card={m} flipped zoomDelayMs={0} />);
    const card = screen.getByRole('group', { name: 'Tok-Tok, Volcano Born, flipped' });
    fireEvent.focus(card);
    const zoom = await screen.findByRole('dialog', { name: 'Tok-Tok, Volcano Born (zoomed, flipped)' });
    const picture = zoom.querySelector('.card-zoom-picture') as HTMLElement;
    expect(picture.classList.contains('is-flipped')).toBe(true);
    expect(within(zoom).getByText(/Flipped \(CR 710\.2\): Tok-Tok, Volcano Born/)).toBeTruthy();
  });

  it('CR 710.2: an unflipped flip card is its normal half', () => {
    show(<Card card={model('Akki Lavarunner // Tok-Tok, Volcano Born')} />);
    expect(screen.getByRole('group', { name: 'Akki Lavarunner' })).toBeTruthy();
  });
});

describe('zoom placement and keyboard access', () => {
  const rect = (left: number, width = 146, top = 300, height = 204) => ({ left, right: left + width, top, bottom: top + height, width, height, x: left, y: top, toJSON: () => ({}) });
  const place = (el: Element, left: number) => vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(left) as DOMRect);
  let width = 0;
  beforeEach(() => {
    width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    vi.restoreAllMocks();
  });

  it('the zoom opens on the side of the card with more room and never wider than that room', async () => {
    const { container } = show(<Card card={model('Forest')} zoomDelayMs={0} />);
    place(container.querySelector('.card-slot')!, 700);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog');
    expect(zoom.className).toContain('card-zoom-left');
    // The card starts at x=700: the zoom (from x=16) must end before it.
    expect(16 + parseFloat(zoom.style.maxWidth)).toBeLessThanOrEqual(700);
  });

  it('a click (focus while the pointer is on the card) keeps the open zoom where it is', async () => {
    const { container } = show(<Card card={model('Forest')} onClick={() => undefined} zoomDelayMs={0} />);
    place(container.querySelector('.card-slot')!, 700);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog');
    fireEvent.focus(screen.getByRole('button', { name: 'Forest' }));
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(screen.getByRole('dialog')).toBe(zoom);
    expect(zoom.className).toContain('card-zoom-left');
  });

  it('keyboard focus places the zoom by the card position too', async () => {
    const { container } = show(<Card card={model('Forest')} zoomDelayMs={0} />);
    place(container.querySelector('.card-slot')!, 100);
    fireEvent.focus(screen.getByRole('group', { name: 'Forest' }));
    expect((await screen.findByRole('dialog')).className).toContain('card-zoom-right');
  });

  it('every zoomable card can be focused to open its zoom, and Escape closes it', async () => {
    show(<Card card={model('Forest')} zoomDelayMs={0} />);
    const card = screen.getByRole('group', { name: 'Forest' });
    expect(card.tabIndex).toBe(0);
    fireEvent.focus(card);
    await screen.findByRole('dialog');
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a card announces its state: CR 701.26a tapped, selected (aria-pressed), and face down (CR 708.2)', () => {
    show(<Card card={model('Forest')} tapped />);
    expect(screen.getByRole('group', { name: 'Forest, tapped' })).toBeTruthy();
    show(<Card card={model('Island')} selected onClick={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Island' }).getAttribute('aria-pressed')).toBe('true');
    const { container } = show(<Card card={null} faceDown />);
    expect(container.querySelector('[aria-label="Face-down card"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="Hidden card"]')).toBeNull();
  });

  it('the zoom names the card instead of the engine self-reference "~" in the text resolved by hand', async () => {
    const { container } = show(<Card card={model('Delver of Secrets // Insectile Aberration')} zoomDelayMs={0} />);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog');
    const items = [...zoom.querySelectorAll('.card-zoom-manual li')].map((li) => li.textContent ?? '');
    expect(items.some((t) => t.includes('transform Delver of Secrets.'))).toBe(true);
    expect(items.some((t) => t.includes('~'))).toBe(false);
  });
});

describe('models from search results (CardSummary)', () => {
  it('draws the same frame and computes the same slots as the compiled definition', () => {
    for (const n of ['Delver of Secrets // Insectile Aberration', 'Commit // Memory', 'Chandra, Torch of Defiance', 'Angel']) {
      const fromSummary = modelFromSummary(summary(n));
      expect(fromSummary.slots.map((s) => s.key)).toEqual(model(n).slots.map((s) => s.key));
    }
    const { container } = show(<Card card={modelFromSummary(summary('Chandra, Torch of Defiance'))} />);
    expect(screen.getByLabelText('Loyalty 4')).toBeTruthy();
    expect(container.querySelectorAll('.loyalty-cost')).toHaveLength(4);
  });
});
