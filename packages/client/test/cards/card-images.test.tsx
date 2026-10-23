/**
 * Image selection (ARCHITECTURE.md "Card images"): player upload (IndexedDB, per printed side) > Scryfall image if the setting is on > text placeholder;
 * Scryfall images are hot-linked as given (https *.scryfall.io only), whole, never covered.
 * The Scryfall URLs here are made-up test strings, not real images (fixtures never contain image URLs).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card } from '../../src/cards/Card';
import { modelFromDef, modelFromSummary } from '../../src/cards/model';
import { chooseCardImage } from '../../src/cards/useCardImage';
import { CardImagesProvider, type CardImages } from '../../src/images/context';
import { pickScryfallUrl, safeScryfallUrl } from '../../src/images/scryfall';
import { setShowScryfallImages } from '../../src/images/settings';
import { def, imageFile, summary, testImages } from '../card-fixtures';

const FRONT = 'https://fake.scryfall.io/normal/front/test-delver.jpg';
const BACK = 'https://fake.scryfall.io/normal/back/test-delver.jpg';
const LARGE = 'https://fake.scryfall.io/large/front/test-delver.jpg';
const DELVER = 'Delver of Secrets // Insectile Aberration';

function delverSummary() {
  const s = summary(DELVER);
  s.faces[0]!.imageUris = { normal: FRONT, large: LARGE };
  s.faces[1]!.imageUris = { normal: BACK };
  return modelFromSummary(s);
}

const show = (images: CardImages, ui: ReactElement) => render(<CardImagesProvider images={images}>{ui}</CardImagesProvider>);
const store = (images: CardImages, key: string, card: string, name = `${key}.jpg`) =>
  act(() => images.store.put({ key, card, label: key, fileName: name, type: 'image/jpeg', size: 3, blob: imageFile(name), addedAt: 0 }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('the priority rule', () => {
  it('upload > Scryfall (only when enabled) > placeholder', () => {
    expect(chooseCardImage('blob:u', 'https://x', true)).toEqual({ kind: 'upload', src: 'blob:u' });
    expect(chooseCardImage('blob:u', 'https://x', false)).toEqual({ kind: 'upload', src: 'blob:u' });
    expect(chooseCardImage(null, 'https://x', true)).toEqual({ kind: 'scryfall', src: 'https://x' });
    expect(chooseCardImage(null, 'https://x', false)).toEqual({ kind: 'placeholder' });
    expect(chooseCardImage(null, null, true)).toEqual({ kind: 'placeholder' });
  });

  it('accepts only https links to scryfall.io (the CSP allows *.scryfall.io only)', () => {
    expect(safeScryfallUrl(FRONT)).toBe(FRONT);
    expect(safeScryfallUrl('http://fake.scryfall.io/a.jpg')).toBeNull();
    expect(safeScryfallUrl('https://evil.example/scryfall.io/a.jpg')).toBeNull();
    expect(safeScryfallUrl('https://scryfall.io.evil.example/a.jpg')).toBeNull();
    expect(safeScryfallUrl('javascript:alert(1)')).toBeNull();
    expect(pickScryfallUrl({ normal: FRONT, large: LARGE }, 'large')).toBe(LARGE);
    expect(pickScryfallUrl({ normal: FRONT }, 'large')).toBe(FRONT);
    expect(pickScryfallUrl({ large: LARGE }, 'normal')).toBe(LARGE);
  });
});

describe('Scryfall images (opt-in, off by default)', () => {
  it('are not shown while the setting is off, even when the card has URLs', () => {
    const { images } = testImages();
    const { container } = show(images, <Card card={delverSummary()} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.card-frame')).toBeTruthy();
  });

  it('when on, the browser hot-links the face image as given: whole, aspect ratio kept, nothing drawn over it', async () => {
    setShowScryfallImages(true);
    const { images } = testImages();
    const { container } = show(images, <Card card={delverSummary()} />);
    const img = await screen.findByAltText('Delver of Secrets');
    expect(img.getAttribute('src')).toBe(FRONT);
    expect(img.dataset.source).toBe('scryfall');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(img.getAttribute('style')).toBeNull(); // no filter, tint, blur or crop styles
    const box = container.querySelector('.card-box')!;
    expect(box.children).toHaveLength(1); // the image is alone in the card's rectangle
    expect(box.contains(screen.getByRole('img', { name: /Automation/ }))).toBe(false);
    // The back side has its own picture.
    fireEvent.click(screen.getByRole('button', { name: /Show back/ }));
    expect((await screen.findByAltText('Insectile Aberration')).getAttribute('src')).toBe(BACK);
  });

  it('the zoom uses the large image', async () => {
    setShowScryfallImages(true);
    const { images } = testImages();
    const { container } = show(images, <Card card={delverSummary()} zoomDelayMs={0} />);
    fireEvent.mouseEnter(container.querySelector('figure')!);
    const zoom = await screen.findByRole('dialog');
    await waitFor(() => expect(zoom.querySelector('img')?.getAttribute('src')).toBe(LARGE));
  });

  it('a card from a game (a CardDef has no URLs) asks the server once per name, only while the setting is on', async () => {
    const lookup = vi.fn(async () => [{ normal: FRONT }, { normal: BACK }]);
    const { images } = testImages(lookup);
    const m = modelFromDef(def(DELVER));
    const first = show(images, <Card card={m} />);
    expect(first.container.querySelector('img')).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
    first.unmount();
    setShowScryfallImages(true);
    show(images, <><Card card={m} /><Card card={m} face={1} /></>);
    expect((await screen.findByAltText('Delver of Secrets')).getAttribute('src')).toBe(FRONT);
    expect((await screen.findByAltText('Insectile Aberration')).getAttribute('src')).toBe(BACK);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(DELVER);
  });

  it('a card drawn anew (it changed zones) shows its picture in its first render, never the text frame (the art must not switch to the default while it flies)', async () => {
    setShowScryfallImages(true);
    const lookup = vi.fn(async () => [{ normal: FRONT }, { normal: BACK }]);
    const { images } = testImages(lookup);
    const m = modelFromDef(def(DELVER));
    const first = show(images, <Card card={m} />);
    expect((await screen.findByAltText('Delver of Secrets')).getAttribute('src')).toBe(FRONT);
    first.unmount();
    // The next component for the same card (a new object id in another zone) has the picture at once: no frame, no waiting for a promise.
    const again = show(images, <Card card={m} />);
    expect(again.container.querySelector('img')?.getAttribute('src')).toBe(FRONT);
    expect(again.container.querySelector('.card-frame')).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('a card whose picture is still on its way marks its stand-in frame, so the fx layer waits for it before flying the card', async () => {
    setShowScryfallImages(true);
    let release: (u: { normal: string }[]) => void = () => undefined;
    const lookup = vi.fn(() => new Promise<{ normal: string }[]>((r) => (release = r)));
    const { images } = testImages(lookup);
    const { container } = show(images, <Card card={modelFromDef(def(DELVER))} />);
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    expect(container.querySelector('.card-frame[data-picture-pending]')).not.toBeNull();
    await act(async () => release([{ normal: FRONT }, { normal: BACK }]));
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe(FRONT));
    expect(container.querySelector('[data-picture-pending]')).toBeNull();
  });

  it('a URL that is not Scryfall https is ignored; a broken image falls back to the placeholder', async () => {
    setShowScryfallImages(true);
    const s = summary('Forest');
    s.faces[0]!.imageUris = { normal: 'http://fake.scryfall.io/forest.jpg' };
    const { images } = testImages();
    const { container } = show(images, <Card card={modelFromSummary(s)} />);
    expect(container.querySelector('img')).toBeNull();

    const ok = summary('Island');
    ok.faces[0]!.imageUris = { normal: 'https://fake.scryfall.io/island.jpg' };
    const r = show(images, <Card card={modelFromSummary(ok)} />);
    const img = await screen.findByAltText('Island');
    fireEvent.error(img);
    expect(r.container.querySelector('img')).toBeNull();
    expect(r.container.querySelector('.card-frame')).toBeTruthy();
  });
});

describe('player uploads (IndexedDB, per printed side)', () => {
  it('an uploaded image beats the Scryfall image and is bound to its side only', async () => {
    setShowScryfallImages(true);
    const { images, urls } = testImages();
    await store(images, 'Delver of Secrets', DELVER, 'my-delver.jpg');
    show(images, <Card card={delverSummary()} />);
    const img = await screen.findByAltText('Delver of Secrets');
    await waitFor(() => expect(img.dataset.source).toBe('upload'));
    expect(urls.live.get(img.getAttribute('src')!)).toBeInstanceOf(Blob);
    // The back side has no upload: it falls back to its Scryfall image.
    fireEvent.click(screen.getByRole('button', { name: /Show back/ }));
    expect((await screen.findByAltText('Insectile Aberration')).dataset.source).toBe('scryfall');
  });

  it('uploaded image > Scryfall: while the upload is still loading, no Scryfall image is chosen or looked up', async () => {
    setShowScryfallImages(true);
    const lookup = vi.fn(async () => [{ normal: FRONT }, { normal: BACK }]);
    const { images } = testImages(lookup);
    await store(images, 'Delver of Secrets', DELVER, 'mine.jpg');
    const seen: string[] = [];
    const { container } = show(images, <><Card card={delverSummary()} /><Card card={modelFromDef(def(DELVER))} /></>);
    const observer = new MutationObserver(() => {
      for (const img of container.querySelectorAll('img')) seen.push(img.dataset.source ?? '');
    });
    observer.observe(container, { subtree: true, childList: true, attributes: true });
    for (const img of container.querySelectorAll('img')) seen.push(img.dataset.source ?? '');
    await waitFor(() => expect(container.querySelectorAll('img[data-source="upload"]')).toHaveLength(2));
    observer.disconnect();
    expect(seen).not.toContain('scryfall');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('with the setting off, an upload still shows and other cards keep their placeholder', async () => {
    const { images } = testImages();
    await store(images, 'Forest', 'Forest');
    const { container } = show(images, <><Card card={modelFromDef(def('Forest'))} /><Card card={modelFromDef(def('Island'))} /></>);
    expect((await screen.findByAltText('Forest')).dataset.source).toBe('upload');
    expect(container.querySelectorAll('.card-frame')).toHaveLength(1);
  });

  it('cards update when an image is stored, replaced or deleted, and old object URLs are revoked', async () => {
    const { images, urls } = testImages();
    const { container } = show(images, <Card card={modelFromDef(def('Forest'))} />);
    await waitFor(() => expect(container.querySelector('.card-frame')).toBeTruthy());
    await store(images, 'Forest', 'Forest', 'a.jpg');
    const first = (await screen.findByAltText('Forest')).getAttribute('src')!;
    await store(images, 'Forest', 'Forest', 'b.jpg');
    await waitFor(() => expect(screen.getByAltText('Forest').getAttribute('src')).not.toBe(first));
    expect(urls.revoked).toContain(first);
    await act(() => images.store.delete('Forest'));
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(container.querySelector('.card-frame')).toBeTruthy();
  });

  it('one-picture layouts use the one slot for every face', async () => {
    const { images } = testImages();
    await store(images, 'Commit // Memory', 'Commit // Memory');
    show(images, <Card card={modelFromDef(def('Commit // Memory'))} />);
    expect((await screen.findByAltText('Commit // Memory')).dataset.source).toBe('upload'); // CR 709.4: both names
  });

  it('a hidden card never shows an upload', async () => {
    const { images } = testImages();
    await store(images, 'Forest', 'Forest');
    show(images, <Card card={null} />);
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(screen.getByRole('img', { name: 'Hidden card' }).getAttribute('src')).toBe('/brand/sleeves/sleeve-classic.svg');
  });
});
