/**
 * Artist credits everywhere:
 * a Scryfall picture names its artist; small pictures (the table, the hand, thumbnails) in their accessible name and tooltip only, larger ones (zooms, the
 * stage, the zone viewers) with the visible "Illustrated by <artist>" line under the picture, never on it. No credit with the setting off, for uploaded
 * images, or for our own frames; each side of a double-faced card credits its own artist.
 * The Scryfall URLs and artist names here are made-up test strings (fixtures never contain image URLs or artists).
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { GameView, ObjectId } from '@openmtg/engine';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameBoard } from '../src/board';
import { pictureArtist } from '../src/board/fx/dom';
import { Card } from '../src/cards/Card';
import { creditElement, creditedName, creditText } from '../src/cards/ArtistCredit';
import { cardModelOf } from '../src/cards/fromView';
import { modelFromSummary, slotOfFace } from '../src/cards/model';
import { renderBoardCard, useBoardArtist } from '../src/game/boardCards';
import { CardImagesProvider, type CardImages } from '../src/images/context';
import type { FaceUris } from '../src/images/scryfall';
import { setShowScryfallImages } from '../src/images/settings';
import { PromptStage, StageCard } from '../src/prompts/stage';
import { ALICE, editable, playGame } from './board/fixtures';
import { imageFile, summary, testImages } from './card-fixtures';

const BEAR_ART = 'Bear Painter';
const DAY_ART = 'Day Artist';
const NIGHT_ART = 'Night Artist';
const DFC = 'Day Bear // Night Bear';

/** Scryfall's answers by card name (made-up URLs); Forest has none, so it keeps our own frame. */
const lookup = async (name: string): Promise<FaceUris | null> => {
  if (name === 'Test Bear') return [{ normal: 'https://fake.scryfall.io/normal/bear.jpg', artist: BEAR_ART }];
  if (name === DFC) return [{ normal: 'https://fake.scryfall.io/normal/day.jpg', artist: DAY_ART }, { normal: 'https://fake.scryfall.io/normal/night.jpg', artist: NIGHT_ART }];
  return null;
};

const game = playGame(6);

function baseView(): GameView {
  const c = game.captured.find((x) => x.turn === 5 && x.step === 'main1' && x.view.viewer === ALICE);
  if (!c) throw new Error('no capture at 5:main1');
  return editable(c.view);
}

const bearDefId = (v: GameView) => Object.keys(v.defs).find((k) => v.defs[k]!.name === 'Test Bear')!;
const alicesBears = (v: GameView): ObjectId[] =>
  v.zones.battlefield.filter((id) => v.objects[id]!.controller === ALICE && v.objects[id]!.defId === bearDefId(v));

/** Alice's view with a Test Bear on her battlefield and one in her hand. */
function scene() {
  const v = baseView();
  const [bear] = alicesBears(v);
  if (!bear) throw new Error('fixture: Alice has no Test Bear on the battlefield');
  const hand = v.zones.hand[ALICE]![0]!;
  v.objects[hand] = { ...v.objects[hand]!, defId: bearDefId(v) };
  return { v, bear, hand };
}

function showBoard(v: GameView, images: CardImages, prompt?: ReactNode) {
  return render(
    <CardImagesProvider images={images}>
      <GameBoard view={v} renderCard={renderBoardCard} useArtist={useBoardArtist} {...(prompt !== undefined ? { prompt } : {})} />
    </CardImagesProvider>,
  );
}

function slot(container: HTMLElement, id: ObjectId): HTMLElement {
  const el = container.querySelector<HTMLElement>(`.board-main .board-card[data-object-id="${id}"]`);
  if (!el) throw new Error(`no card slot for ${id}`);
  return el;
}

const zoomOf = (container: HTMLElement) => container.querySelector<HTMLElement>('.zoom:not(.zoom-empty)');

beforeEach(() => localStorage.clear());
afterEach(() => {
  setShowScryfallImages(false);
  localStorage.clear();
});

describe('the shared credit', () => {
  it('one text everywhere: the visible line and the name with its credit', () => {
    expect(creditText('Christopher Moeller')).toBe('Illustrated by Christopher Moeller');
    expect(creditedName('Lightning Bolt', 'Christopher Moeller')).toBe('Lightning Bolt, illustrated by Christopher Moeller');
    expect(creditedName('Lightning Bolt', null)).toBe('Lightning Bolt');
    const el = creditElement('Christopher Moeller', 'fx-ghost-credit');
    expect(el.textContent).toBe('Illustrated by Christopher Moeller');
    expect(el.className).toBe('artist-credit fx-ghost-credit');
  });

  it('the own-draw reveal reads the artist from the Scryfall picture it copies, never from an upload', () => {
    const box = document.createElement('div');
    box.innerHTML = '<img data-source="scryfall" data-artist="Bear Painter" alt="">';
    expect(pictureArtist(box)).toBe(BEAR_ART);
    box.innerHTML = '<img data-source="upload" alt="">';
    expect(pictureArtist(box)).toBeNull();
    box.innerHTML = '<div class="card-frame"></div>';
    expect(pictureArtist(box)).toBeNull();
  });
});

describe('the board (C4 with C2 pictures)', () => {
  it('table and hand cards name the artist in their accessible name and tooltip only; the zoom shows the line under the picture', async () => {
    setShowScryfallImages(true);
    const { v, bear, hand } = scene();
    const { container } = showBoard(v, testImages(lookup).images);
    const onTable = slot(container, bear);
    await waitFor(() => expect(onTable.getAttribute('aria-label')).toBe('Test Bear (Alice), illustrated by Bear Painter'));
    const img = onTable.querySelector('img')!;
    expect(img.title).toBe('Test Bear, illustrated by Bear Painter');
    expect(img.alt).toBe('Test Bear, illustrated by Bear Painter');
    expect(img.dataset.artist).toBe(BEAR_ART);
    await waitFor(() => expect(slot(container, hand).getAttribute('aria-label')).toBe('Test Bear, illustrated by Bear Painter'));
    // No visible line on the table or in the hand: nothing changes their layout.
    expect(container.querySelector('.board-card .artist-credit')).toBeNull();
    // Our own frame (Forest: no Scryfall picture) names no artist.
    const forest = v.zones.battlefield.find((id) => v.objects[id]!.controller === ALICE && v.defs[v.objects[id]!.defId]!.name === 'Forest')!;
    expect(slot(container, forest).getAttribute('aria-label')).toBe('Forest (Alice)');

    fireEvent.mouseEnter(onTable);
    const zoom = zoomOf(container)!;
    const line = within(zoom).getByText('Illustrated by Bear Painter');
    expect(line.classList.contains('artist-credit')).toBe(true);
    expect(line.closest('.zoom-card')).toBeNull(); // under the picture, never on it
    expect(zoom.querySelector('.zoom-card img')!.contains(line)).toBe(false);
    fireEvent.mouseLeave(onTable);

    fireEvent.mouseEnter(slot(container, forest));
    expect(zoomOf(container)!.querySelector('.artist-credit')).toBeNull();
  });

  it('a double-faced card credits the face shown, and its zoom credits each face under its own picture', async () => {
    setShowScryfallImages(true);
    const { v, bear } = scene();
    const d = bearDefId(v);
    const def = v.defs[d]!;
    v.defs[d] = { ...def, name: DFC, layout: 'transform', faces: [{ ...def.faces[0]!, name: 'Day Bear' }, { ...def.faces[0]!, name: 'Night Bear' }] };
    const { container, rerender } = showBoard(v, testImages(lookup).images);
    await waitFor(() => expect(slot(container, bear).getAttribute('aria-label')).toMatch(/, illustrated by Day Artist$/));
    fireEvent.mouseEnter(slot(container, bear));
    const zoom = zoomOf(container)!;
    const day = await within(zoom).findByText('Illustrated by Day Artist');
    const night = await within(zoom).findByText('Illustrated by Night Artist');
    expect(day.closest('.zoom-other')).toBeNull();
    expect(night.closest('.zoom-other')).not.toBeNull();
    fireEvent.mouseLeave(slot(container, bear));

    // Transformed (CR 712.8e): the back face is up, and its own artist is credited.
    const night2 = editable(v);
    night2.objects[bear] = { ...night2.objects[bear]!, face: 1 };
    const images = testImages(lookup).images;
    rerender(
      <CardImagesProvider images={images}>
        <GameBoard view={night2} renderCard={renderBoardCard} useArtist={useBoardArtist} />
      </CardImagesProvider>,
    );
    await waitFor(() => expect(slot(container, bear).getAttribute('aria-label')).toMatch(/, illustrated by Night Artist$/));
    fireEvent.mouseEnter(slot(container, bear));
    const z2 = zoomOf(container)!;
    expect((await within(z2).findByText('Illustrated by Night Artist')).closest('.zoom-other')).toBeNull();
    expect((await within(z2).findByText('Illustrated by Day Artist')).closest('.zoom-other')).not.toBeNull();
  });

  it('with the Scryfall setting off nothing is credited (our own frames)', async () => {
    const { v, bear, hand } = scene();
    const { container } = showBoard(v, testImages(lookup).images);
    expect(slot(container, bear).getAttribute('aria-label')).toBe('Test Bear (Alice)');
    expect(slot(container, hand).getAttribute('aria-label')).toBe('Test Bear');
    expect(container.querySelector('img[title]')).toBeNull();
    fireEvent.mouseEnter(slot(container, bear));
    expect(zoomOf(container)!.querySelector('.artist-credit')).toBeNull();
  });

  it('an uploaded image is never credited, even with the Scryfall setting on', async () => {
    setShowScryfallImages(true);
    const { v, bear } = scene();
    const { images } = testImages(lookup);
    const key = slotOfFace(cardModelOf(v.defs[bearDefId(v)]!), 0)!.key;
    await act(() => images.store.put({ key, card: 'Test Bear', label: key, fileName: 'mine.jpg', type: 'image/jpeg', size: 3, blob: imageFile('mine.jpg'), addedAt: 0 }));
    const { container } = showBoard(v, images);
    await waitFor(() => expect(slot(container, bear).querySelector('img')?.dataset.source).toBe('upload'));
    expect(slot(container, bear).getAttribute('aria-label')).toBe('Test Bear (Alice)');
    expect(slot(container, bear).querySelector('img')!.hasAttribute('title')).toBe(false);
    fireEvent.mouseEnter(slot(container, bear));
    expect(zoomOf(container)!.querySelector('.artist-credit')).toBeNull();
  });

  it('the graveyard viewer shows the line under each card; the pile button stays as it was', async () => {
    setShowScryfallImages(true);
    const { v, bear } = scene();
    v.zones.battlefield = v.zones.battlefield.filter((id) => id !== bear);
    v.zones.graveyard[ALICE] = [...(v.zones.graveyard[ALICE] ?? []), bear];
    v.objects[bear] = { ...v.objects[bear]!, zone: 'graveyard', tapped: false };
    const { container } = showBoard(v, testImages(lookup).images);
    const pile = screen.getByRole('button', { name: /^Alice's graveyard/ });
    expect(pile.querySelector('.artist-credit')).toBeNull();
    fireEvent.click(pile);
    const dialog = screen.getByRole('dialog', { name: "Alice's graveyard" });
    const line = await within(dialog).findByText('Illustrated by Bear Painter');
    const card = line.closest<HTMLElement>('.board-card')!;
    expect(card.dataset.objectId).toBe(bear);
    expect(card.querySelector('.board-card-image')!.contains(line)).toBe(false);
    expect(card.getAttribute('aria-label')).toBe('Test Bear (Alice), illustrated by Bear Painter');
    // Only the viewer's cards carry the line; the table's do not.
    expect([...container.querySelectorAll('.board-card .artist-credit')].every((el) => el.closest('.zone-viewer'))).toBe(true);
  });

  it('a stage overlay (the opening hand, assigning damage) shows the line under each card, above what the prompt adds', async () => {
    setShowScryfallImages(true);
    const { v, hand } = scene();
    const prompt = (
      <PromptStage title="Your opening hand">
        <StageCard id={hand}>
          <span className="amount">3</span>
        </StageCard>
      </PromptStage>
    );
    const { container } = showBoard(v, testImages(lookup).images, prompt);
    const line = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.prompt-stage .artist-credit');
      if (!el) throw new Error('no credit yet');
      return el;
    });
    expect(line.textContent).toBe('Illustrated by Bear Painter');
    const card = line.closest('.prompt-stage-card')!;
    expect(card.querySelector('.prompt-stage-picture')!.contains(line)).toBe(false);
    expect(line.nextElementSibling?.className).toBe('amount');
  });
});

describe('the card component (C2) and its zoom', () => {
  const delver = () => {
    const s = summary('Delver of Secrets // Insectile Aberration');
    s.faces[0]!.imageUris = { normal: 'https://fake.scryfall.io/normal/front/test-delver.jpg', artist: 'Front Artist' };
    s.faces[1]!.imageUris = { normal: 'https://fake.scryfall.io/normal/back/test-delver.jpg', artist: 'Back Artist' };
    return modelFromSummary(s);
  };
  const show = (images: CardImages, ui: ReactNode) => render(<CardImagesProvider images={images}>{ui}</CardImagesProvider>);

  it('names the artist of the side shown; with `credit` the line is under the picture and follows the "Back" toggle', async () => {
    setShowScryfallImages(true);
    const { container } = show(testImages().images, <Card card={delver()} credit zoom={false} />);
    expect(await screen.findByRole('group', { name: 'Delver of Secrets, illustrated by Front Artist' })).toBeTruthy();
    const line = screen.getByText('Illustrated by Front Artist');
    expect(container.querySelector('.card-slot')!.contains(line)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Show back/ }));
    expect(await screen.findByText('Illustrated by Back Artist')).toBeTruthy();
    expect(screen.queryByText('Illustrated by Front Artist')).toBeNull();
  });

  it('the hover zoom credits each side under its own picture', async () => {
    setShowScryfallImages(true);
    const { container } = show(testImages().images, <Card card={delver()} zoomDelayMs={0} />);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog', { name: /zoomed/ });
    const faces = zoom.querySelectorAll('.card-zoom-face');
    expect(faces).toHaveLength(2);
    expect(await within(faces[0] as HTMLElement).findByText('Illustrated by Front Artist')).toBeTruthy();
    expect(await within(faces[1] as HTMLElement).findByText('Illustrated by Back Artist')).toBeTruthy();
    expect(zoom.querySelector('.card-zoom-picture .artist-credit')).toBeNull();
    // No visible line on the card itself without `credit`.
    expect(container.querySelector('.artist-credit')).toBeNull();
  });

  it('no credit with the setting off', async () => {
    const { container } = show(testImages().images, <Card card={delver()} credit zoomDelayMs={0} />);
    expect(screen.getByRole('group', { name: 'Delver of Secrets' })).toBeTruthy();
    fireEvent.mouseEnter(container.querySelector('figure')!);
    await screen.findByRole('dialog', { name: /zoomed/ });
    expect(document.querySelector('.artist-credit')).toBeNull();
  });
});
