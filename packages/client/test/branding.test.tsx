/** Branding rules (docs/design/branding.md): exact disclaimer, Donate hidden without a URL, theme from brand.json, assets that exist. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BRAND, FAN_CONTENT_DISCLAIMER, brandAsset, donationUrl, type Brand } from '../src/branding/brand';
import { DonateLink } from '../src/branding/Branding';
import { Logo3D, defaultLayers } from '../src/branding/Logo3D';
import { contrastRatio, themeVars } from '../src/theme/theme';
import { publishedFiles } from '../build/brand-assets';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const withUrl = (url: string | null): Brand => ({ ...BRAND, donationUrl: url });

describe('Fan Content disclaimer', () => {
  it('is word for word the disclaimer of README.md and NOTICE', () => {
    expect(readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toContain(`> ${FAN_CONTENT_DISCLAIMER}`);
    expect(readFileSync(path.join(repoRoot, 'NOTICE'), 'utf8')).toContain(FAN_CONTENT_DISCLAIMER);
  });
});

describe('Donate', () => {
  it('is hidden while brand.json has no donation URL', () => {
    const { container } = render(<DonateLink brand={withUrl(null)} />);
    expect(container.innerHTML).toBe('');
  });

  it('accepts only https URLs', () => {
    expect(donationUrl(withUrl('https://example.org/donate'))).toBe('https://example.org/donate');
    expect(donationUrl(withUrl('http://example.org/donate'))).toBeNull();
    expect(donationUrl(withUrl('javascript:alert(1)'))).toBeNull();
    expect(donationUrl(withUrl('not a url'))).toBeNull();
  });

  it('opens the donation page in a new tab, never as a pop-up', () => {
    render(<DonateLink brand={withUrl('https://example.org/donate')} />);
    const link = screen.getByRole('link', { name: 'Donate' });
    expect(link.getAttribute('href')).toBe('https://example.org/donate');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

describe('theme', () => {
  it('takes the brand colors from brand.json', () => {
    const vars = themeVars();
    expect(vars['--brand-blue']).toBe(BRAND.colors.blue);
    expect(vars['--brand-magenta']).toBe(BRAND.colors.magenta);
    expect(vars['--text']).toBe(BRAND.colors.white);
    expect(vars['--table-bg']).toBe(BRAND.colors.navy);
  });

  it('has accessible contrast (WCAG AA) for text on the table and on primary buttons', () => {
    expect(contrastRatio(BRAND.colors.white, BRAND.colors.navy)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(BRAND.colors.blue, BRAND.colors.navy)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(BRAND.colors.black, BRAND.colors.blue)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(BRAND.colors.black, BRAND.colors.blueDeep)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('brand assets', () => {
  it('every asset named in brand.json exists in assets/brand and is published under /brand/', () => {
    const published = new Set(publishedFiles(repoRoot).map((f) => `/${f.url}`));
    for (const key of Object.keys(BRAND.assets) as (keyof Brand['assets'])[]) {
      const url = brandAsset(key);
      expect(existsSync(path.join(repoRoot, 'assets', 'brand', BRAND.assets[key])), key).toBe(true);
      expect(published.has(url), url).toBe(true);
    }
  });

  it('publishes the brand README (the "not MIT" notice) and the license files with the client', () => {
    const files = publishedFiles(repoRoot);
    const urls = files.map((f) => f.url);
    expect(urls).toContain('brand/README.md');
    expect(urls).toEqual(expect.arrayContaining(['legal/LICENSE.txt', 'legal/NOTICE.txt', 'legal/THIRD_PARTY_NOTICES.md']));
    for (const f of files) expect(existsSync(f.src), f.src).toBe(true);
    expect(readFileSync(path.join(repoRoot, 'assets', 'brand', 'README.md'), 'utf8')).toMatch(/not covered by OpenMTG's MIT License/);
  });
});

describe('Logo3D', () => {
  it('stacks many layers at hero size and few when small, and only the front one is a named image', () => {
    expect(defaultLayers(224)).toBeGreaterThanOrEqual(10);
    expect(defaultLayers(30)).toBeLessThanOrEqual(6);
    const { container } = render(<Logo3D size={224} />);
    expect(container.querySelectorAll('img')).toHaveLength(defaultLayers(224));
    expect(screen.getAllByRole('img', { name: 'DigiDice logo' })).toHaveLength(1);
    expect(screen.getByAltText('DigiDice logo').getAttribute('src')).toBe(`/brand/${BRAND.assets.logoSquareTransparent}`);
  });

  it('is hidden from assistive technology when decorative (inside a control that has its own label)', () => {
    render(<Logo3D size={36} decorative />);
    expect(screen.queryByRole('img')).toBeNull();
  });
});
