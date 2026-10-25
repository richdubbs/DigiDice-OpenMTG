/**
 * The "Show card images from Scryfall" setting has one source of truth (ARCHITECTURE.md "Card images" B; on by default since 2026-10-25): the page's settings record
 * `openmtg.settings.v1`, field `showScryfallImages` (the record the Settings screen, work package C7, keeps), or the settings store the app connects.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectScryfallSetting, getShowScryfallImages, setShowScryfallImages, SETTINGS_KEY, useShowScryfallImages } from '../../src/images/settings';

function Probe() {
  const [on] = useShowScryfallImages();
  return <p>{on ? 'on' : 'off'}</p>;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  connectScryfallSetting(null);
  localStorage.clear();
});

describe('one source of truth for the Scryfall images setting', () => {
  it('is on by default, and an "off" stored before the default changed (no mark) reads as on', () => {
    expect(getShowScryfallImages()).toBe(true);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showScryfallImages: false }));
    expect(getShowScryfallImages()).toBe(true);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showScryfallImages: false, scryfallDefaultOn: true }));
    expect(getShowScryfallImages()).toBe(false);
  });

  it('writes showScryfallImages into the shared settings record openmtg.settings.v1, keeping its other fields', () => {
    expect(SETTINGS_KEY).toBe('openmtg.settings.v1');
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ fullControl: true, playerNames: ['Ann', 'Bo'] }));
    setShowScryfallImages(true);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual({ fullControl: true, playerNames: ['Ann', 'Bo'], showScryfallImages: true, scryfallDefaultOn: true });
    setShowScryfallImages(false);
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).showScryfallImages).toBe(false);
    // No second key of its own.
    expect(Object.keys(localStorage)).toEqual([SETTINGS_KEY]);
  });

  it('reads what the Settings screen stored in that record', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showScryfallImages: false, scryfallDefaultOn: true }));
    expect(getShowScryfallImages()).toBe(false);
    localStorage.setItem(SETTINGS_KEY, 'not json');
    expect(getShowScryfallImages()).toBe(true);
  });

  it('a connected settings store (the page-wide one) is followed by the cards, and the switch writes to it', () => {
    let value = false;
    const listeners = new Set<() => void>();
    const page = {
      get: () => value,
      set: (on: boolean) => {
        value = on;
        for (const l of listeners) l();
      },
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    render(<Probe />);
    expect(screen.getByText('on')).toBeTruthy();
    act(() => connectScryfallSetting(page));
    expect(screen.getByText('off')).toBeTruthy();
    act(() => page.set(true));
    expect(screen.getByText('on')).toBeTruthy();
    act(() => setShowScryfallImages(false));
    expect(value).toBe(false);
    expect(screen.getByText('off')).toBeTruthy();
    expect(localStorage.getItem(SETTINGS_KEY)).toBeNull();
  });
});
