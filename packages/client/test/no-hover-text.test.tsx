/**
 * No hover text boxes (src/app/noHoverText.ts, owner 2026-10-25): every `title` attribute is taken off the page, on elements already there, on elements
 * React adds later and when a title changes; an element whose only name was its title keeps it as aria-label.
 */
import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { installNoHoverText } from '../src/app/noHoverText';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

const flush = (): Promise<void> => act(() => Promise.resolve());

describe('no hover text boxes', () => {
  it('takes titles off what is on the page, what React adds and what changes', async () => {
    let setTip: (t: string) => void = () => {};
    function Board() {
      const [tip, set] = useState('Power/toughness 2/2');
      setTip = set;
      return (
        <div>
          <span className="card-pt" title={tip}>
            2/2
          </span>
          <button type="button" aria-label="Rename" title="Rename" />
        </div>
      );
    }
    const old = document.createElement('p');
    old.setAttribute('title', 'Mana pool (CR 106.4)');
    old.textContent = 'R';
    document.body.append(old);
    stop = installNoHoverText(document);
    expect(old.hasAttribute('title')).toBe(false);
    const { container } = render(<Board />);
    await flush();
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    await act(async () => setTip('Power/toughness 3/3 (a +1/+1 counter)'));
    await flush();
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
    expect(container.querySelector('.card-pt')!.hasAttribute('aria-label')).toBe(false); // its text names it
    old.remove();
  });

  it('an icon with no text and no label keeps its title as aria-label', async () => {
    stop = installNoHoverText(document);
    const { container } = render(<span className="board-mana-glyph" title="Red mana" />);
    await flush();
    const glyph = container.querySelector('.board-mana-glyph')!;
    expect(glyph.hasAttribute('title')).toBe(false);
    expect(glyph.getAttribute('aria-label')).toBe('Red mana');
  });
});
