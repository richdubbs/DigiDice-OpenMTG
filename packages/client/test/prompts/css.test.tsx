/**
 * The prompt stylesheet: scoped class names (C2, C3 and C4 each define their own global `.mana-cost`; the last stylesheet loaded would win), and disabled
 * buttons that look disabled.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { createGame, viewFor, type Decision } from '@openmtg/engine';
import { describe, expect, it } from 'vitest';
import { DecisionPrompt } from '../../src/prompts/DecisionPrompt';
import { smallConfig } from '../helpers';

const css = readFileSync(path.resolve(__dirname, '..', '..', 'src', 'prompts', 'prompts.css'), 'utf8');
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = [...plain.matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1]!.split(',').map((s) => s.trim()));
const definedClasses = [...new Set(selectors.flatMap((s) => [...s.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]!)))];

describe('prompts.css', () => {
  it('every rule is scoped to a prompt- class (no global .mana-cost / .mana-sym / .button-small shared with other packages)', () => {
    expect(selectors.length).toBeGreaterThan(0);
    expect(selectors.filter((s) => !s.startsWith('.prompt-'))).toEqual([]);
  });

  it('disabled buttons in the prompt bar look disabled: dimmed, a not-allowed cursor, no hover highlight', () => {
    const rule = /\.prompt-bar button:disabled\s*(?:,[^{]*)?\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/opacity:\s*0?\.45/);
    expect(rule![1]).toMatch(/cursor:\s*not-allowed/);
    expect(css).toMatch(/\.prompt-bar button:disabled:hover/);
  });

  it('every class name the color prompt uses is defined (no undefined mana-* classes)', () => {
    const view = viewFor(createGame(smallConfig('css-color')), 'p1');
    const d: Decision = { kind: 'chooseColor', id: 'd1', player: 'p1', prompt: 'Choose a color.', options: ['W', 'G'] };
    const { container } = render(<DecisionPrompt d={d} view={view} legal={[]} answer={() => {}} act={() => {}} busy={false} />);
    const used = new Set([...container.querySelectorAll('[class]')].flatMap((e) => [...e.classList]));
    expect([...used].filter((c) => !definedClasses.includes(c) && !['button-primary', 'button-link'].includes(c))).toEqual([]);
    expect(container.textContent).toContain('Green');
  });
});
