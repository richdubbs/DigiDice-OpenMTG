/**
 * UI profiles (docs/design/ui-profiles.md): the templates (Neon Grid, LCARS, Reality Fracture), saved profiles in localStorage with try/catch, the look
 * applied to the page, the Settings screen's Look and feel section, the LCARS space battle and the Reality Fracture sky behind Home, and the stylesheets
 * staying scoped to their template.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NavProvider } from '../src/app/nav';
import { createBattle, SHIELD, shieldHit, stepBattle } from '../src/profiles/battle';
import { createScene, holeAt, mirrorPoint, orbitPlace, sideOf, stepScene } from '../src/profiles/fracture';
import {
  MAX_PROFILES, PROFILES_KEY, ProfilesStore, TEMPLATES, TEMPLATE_PROFILES, applyLook, cleanHex, connectProfiles, isTemplatePalette, lookVars, parseProfileFile,
  profileFile, resetProfilesStoreForTests, sanitizeLook, sanitizeProfiles, templateLook, templateProfileId, uniqueName,
} from '../src/profiles/profiles';
import { ProfilesSection } from '../src/settings/ProfilesSection';
import { HomeScreen } from '../src/screens/HomeScreen';
import { themeVars } from '../src/theme/theme';
import { cssOf, declarations } from './css-rules';
import { memoryStorage } from './game-fixtures';

afterEach(() => {
  resetProfilesStoreForTests();
  vi.restoreAllMocks();
  const root = document.documentElement;
  for (const k of Object.keys(root.dataset)) delete root.dataset[k];
  root.removeAttribute('style');
});

const LCARS = templateProfileId('lcars');
const GRID = templateProfileId('neonGrid');
const FRACTURE = templateProfileId('fracture');

describe('templates', () => {
  it('names the current look Neon Grid and adds LCARS and Reality Fracture, read-only profiles with their own palettes', () => {
    expect(TEMPLATE_PROFILES.map((p) => [p.id, p.name, p.builtIn])).toEqual([
      [GRID, 'Neon Grid', true],
      [LCARS, 'LCARS', true],
      [FRACTURE, 'Reality Fracture', true],
    ]);
    // Neon Grid's palette is the brand's: the look every screen was designed in.
    expect(templateLook('neonGrid').colors).toEqual({ neon: '#1fb8ff', neon2: '#f500f5' });
    expect(Object.keys(templateLook('lcars').colors)).toEqual(['frame', 'button', 'panel', 'highlight', 'alert', 'text']);
    expect(Object.keys(templateLook('fracture').colors)).toEqual(['mind', 'echo', 'memory', 'alert', 'text', 'void']);
    for (const t of Object.values(TEMPLATES)) {
      expect(t.presets[0]!.colors, `${t.name}: the first palette is the template's own`).toEqual(templateLook(t.id).colors);
      for (const p of t.presets) expect(Object.keys(p.colors).sort(), `${t.name} ${p.name}`).toEqual(t.slots.map((s) => s.key).sort());
    }
  });
});

describe('profile data', () => {
  it('cleans looks field by field: unknown template, colors, sizes and switches take the template value', () => {
    expect(sanitizeLook(null)).toEqual(templateLook('neonGrid'));
    expect(sanitizeLook({ template: 'nope' }).template).toBe('neonGrid');
    const look = sanitizeLook({ template: 'lcars', colors: { frame: '#ABC', button: 'red', panel: '#123456', extra: '#000000' }, textSize: 1.17, motion: 0, scene: false });
    expect(look.colors.frame).toBe('#aabbcc');
    expect(look.colors.button).toBe(TEMPLATES.lcars.slots[1]!.default);
    expect(look.colors.panel).toBe('#123456');
    expect(look.colors).not.toHaveProperty('extra');
    expect(look.textSize).toBe(1.2);
    expect(look.motion).toBe(true);
    expect(look.scene).toBe(false);
    expect(cleanHex('#12345')).toBeNull();
  });

  it('keeps valid saved profiles, drops broken or duplicate ones and falls back to Neon Grid for an unknown active id', () => {
    const s = sanitizeProfiles({
      activeId: 'p-gone0000',
      profiles: [
        { id: 'p-good0001', name: '  My   bridge ', look: { template: 'lcars' } },
        { id: 'p-good0001', name: 'Duplicate', look: {} },
        { id: 'bad id', name: 'Bad', look: {} },
        'junk',
        { id: 'p-good0002', name: '', look: { template: 'neonGrid' } },
      ],
    });
    expect(s.activeId).toBe(GRID);
    expect(s.profiles.map((p) => [p.id, p.name, p.look.template])).toEqual([
      ['p-good0001', 'My bridge', 'lcars'],
      ['p-good0002', 'Neon Grid', 'neonGrid'],
    ]);
  });

  it('gives a name that is taken a number', () => {
    expect(uniqueName('LCARS', ['Neon Grid', 'LCARS'])).toBe('LCARS (2)');
    expect(uniqueName('lcars', ['LCARS', 'lcars (2)'])).toBe('lcars (3)');
    expect(uniqueName('Mine', ['LCARS'])).toBe('Mine');
  });

  it('exports a profile as a file and reads it back; anything else is not a profile', () => {
    const look = { ...templateLook('lcars'), textSize: 1.1, colors: { ...templateLook('lcars').colors, frame: '#5b8fd6' } };
    const text = JSON.stringify(profileFile({ id: 'p-abcd0001', name: 'Bridge', look }));
    expect(parseProfileFile(text)).toEqual({ name: 'Bridge', look });
    expect(parseProfileFile('{"name":"x"}')).toBeNull();
    expect(parseProfileFile('not json')).toBeNull();
  });
});

describe('the profiles store', () => {
  it('starts on Neon Grid, so a first visit looks exactly as before', () => {
    const store = new ProfilesStore(memoryStorage());
    expect(store.active().id).toBe(GRID);
    expect(store.get().profiles).toEqual([]);
  });

  it('loads a template, saves a look as a new profile (loading it), renames, changes and deletes it, storing every change at once', () => {
    const storage = memoryStorage();
    const store = new ProfilesStore(storage);
    store.select(LCARS);
    expect(store.active().name).toBe('LCARS');
    const id = store.create('LCARS', store.active().look)!;
    expect(store.active().id).toBe(id);
    expect(store.active().name).toBe('LCARS (2)');
    store.rename(id, 'Bridge');
    store.updateLook(id, { colors: { ...store.active().look.colors, frame: '#123456' }, textSize: 1.3, motion: false });
    // Stored: a new store on the same storage sees the same profiles.
    const again = new ProfilesStore(storage);
    expect(again.active()).toMatchObject({ id, name: 'Bridge', look: { template: 'lcars', textSize: 1.3, motion: false } });
    expect(again.active().look.colors.frame).toBe('#123456');
    // Switching the template starts from its colors.
    store.updateLook(id, { template: 'neonGrid' });
    expect(store.active().look.colors).toEqual(templateLook('neonGrid').colors);
    // Deleting the profile in use falls back to its template.
    store.remove(id);
    expect(store.active().id).toBe(GRID);
    expect(JSON.parse(storage.getItem(PROFILES_KEY)!)).toEqual({ activeId: GRID, profiles: [] });
  });

  it('never changes a template', () => {
    const store = new ProfilesStore(memoryStorage());
    store.updateLook(LCARS, { textSize: 1.3 });
    store.rename(LCARS, 'Mine');
    store.remove(LCARS);
    expect(store.find(LCARS)).toEqual(TEMPLATE_PROFILES[1]);
  });

  it('imports an exported profile as a new one and stops at MAX_PROFILES', () => {
    const store = new ProfilesStore(memoryStorage());
    const file = JSON.stringify(profileFile(TEMPLATE_PROFILES[1]!));
    const id = store.importText(file);
    expect(store.find(id!)?.name).toBe('LCARS (2)');
    expect(store.importText('nope')).toBeNull();
    while (store.get().profiles.length < MAX_PROFILES) store.create('More', templateLook('neonGrid'));
    expect(store.create('One too many', templateLook('neonGrid'))).toBeNull();
    expect(store.importText(file)).toBeNull();
  });

  it('works without storage and says so', () => {
    const store = new ProfilesStore(memoryStorage({ [PROFILES_KEY]: '{broken' }, true));
    expect(store.active().id).toBe(GRID);
    store.select(LCARS);
    expect(store.active().id).toBe(LCARS);
    expect(store.persisted).toBe(false);
  });
});

describe('applying a look', () => {
  it('marks the template on the root and sets its variables; back on Neon Grid the brand variables return and the LCARS ones go', () => {
    const root = document.documentElement;
    const base = themeVars();
    applyLook(root, { ...templateLook('lcars'), textSize: 1.2 }, base);
    expect(root.dataset.ui).toBe('lcars');
    expect(root.dataset.tint).toBeUndefined();
    expect(root.style.getPropertyValue('--lc-frame')).toBe('#ff9c00');
    expect(root.style.getPropertyValue('--text')).toBe(templateLook('lcars').colors.text);
    expect(root.style.fontSize).toBe('120%');
    applyLook(root, templateLook('neonGrid'), base);
    expect(root.dataset.ui).toBe('grid');
    expect(root.style.getPropertyValue('--lc-frame')).toBe('');
    expect(root.style.getPropertyValue('--text')).toBe(base['--text']);
    expect(root.style.getPropertyValue('--neon-rgb')).toBe('31, 184, 255');
    expect(root.style.fontSize).toBe('');
  });

  it('puts Reality Fracture on the root with its palette, lent to the grid variables too, and takes it all away again on another template', () => {
    const root = document.documentElement;
    const base = themeVars();
    const look = { ...templateLook('fracture'), colors: { ...templateLook('fracture').colors, memory: '#123456' } };
    applyLook(root, look, base);
    expect(root.dataset.ui).toBe('fracture');
    expect(root.dataset.tint).toBe('custom');
    expect(root.style.getPropertyValue('--rf-memory')).toBe('#123456');
    expect(root.style.getPropertyValue('--rf-echo')).toBe(TEMPLATES.fracture.slots[1]!.default);
    // The palette lights what the sheet leaves to the grid look: glows and the accent in the light half's color, its readable text.
    expect(root.style.getPropertyValue('--neon-rgb')).toBe('18, 52, 86');
    expect(root.style.getPropertyValue('--accent-text')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--rf-memory-ink')).toBe('#ffffff');
    applyLook(root, templateLook('lcars'), base);
    expect(root.dataset.ui).toBe('lcars');
    expect(root.style.getPropertyValue('--rf-mind')).toBe('');
    applyLook(root, templateLook('neonGrid'), base);
    expect(root.style.getPropertyValue('--rf-void')).toBe('');
    expect(root.style.getPropertyValue('--text')).toBe(base['--text']);
  });

  it("recolors Neon Grid's glows from the profile's neons and picks readable text for buttons in that color", () => {
    const look = { ...templateLook('neonGrid'), colors: { neon: '#39ff7a', neon2: '#202060' } };
    expect(isTemplatePalette(look)).toBe(false);
    const vars = lookVars(look);
    expect(vars['--neon-rgb']).toBe('57, 255, 122');
    expect(vars['--neon-2-rgb']).toBe('32, 32, 96');
    expect(vars['--accent-text']).toBe('#000000');
    expect(lookVars({ ...look, colors: { neon: '#202060', neon2: '#000000' } })['--accent-text']).toBe('#ffffff');
    applyLook(document.documentElement, look);
    expect(document.documentElement.dataset.tint).toBe('custom');
  });

  it('follows the store: loading a profile restyles the page at once', () => {
    const store = new ProfilesStore(memoryStorage());
    const stop = connectProfiles(document.documentElement, store, themeVars());
    expect(document.documentElement.dataset.ui).toBe('grid');
    act(() => store.select(LCARS));
    expect(document.documentElement.dataset.ui).toBe('lcars');
    stop();
    act(() => store.select(GRID));
    expect(document.documentElement.dataset.ui).toBe('lcars');
  });
});

describe('Settings: Look and feel', () => {
  const section = () => screen.getByRole('region', { name: 'Look and feel' });

  function renderSection(store: ProfilesStore) {
    return render(<ProfilesSection store={store} />);
  }

  it('lists the templates; picking one loads it; a template offers no customization', () => {
    const store = new ProfilesStore(memoryStorage());
    renderSection(store);
    const radios = within(section()).getAllByRole('radio', { name: /Template$/ });
    expect(radios.map((r) => r.closest('label')!.querySelector('b')!.textContent)).toEqual(['Neon Grid', 'LCARS', 'Reality Fracture']);
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(radios[1]!);
    expect(store.active().id).toBe(LCARS);
    expect(screen.getByText(/LCARS is a template and cannot be changed/)).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Text size' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the look in use as a new profile, then customizes, renames and deletes it', () => {
    const store = new ProfilesStore(memoryStorage());
    store.select(LCARS);
    renderSection(store);
    fireEvent.click(screen.getByRole('button', { name: 'Save as new profile' }));
    const name = screen.getByRole('textbox', { name: 'Name of the new profile' }) as HTMLInputElement;
    expect(name.value).toBe('My LCARS');
    fireEvent.change(name, { target: { value: 'Bridge' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(store.active()).toMatchObject({ name: 'Bridge', look: { template: 'lcars' } });
    expect(screen.getByRole('status').textContent).toBe('Saved and loaded "Bridge".');

    // Customize: a palette, one color, the text size and the backgrounds.
    fireEvent.click(screen.getByRole('button', { name: 'Red alert' }));
    expect(store.active().look.colors).toEqual(TEMPLATES.lcars.presets.find((p) => p.name === 'Red alert')!.colors);
    fireEvent.change(screen.getByLabelText(/^Frame/), { target: { value: '#00ff00' } });
    expect(store.active().look.colors.frame).toBe('#00ff00');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Text size' })).getByRole('radio', { name: '120%' }));
    expect(store.active().look.textSize).toBe(1.2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Space battle behind the Home screen' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Moving backgrounds' }));
    expect(store.active().look).toMatchObject({ scene: false, motion: false });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to the LCARS template' }));
    expect(store.active().look).toEqual(templateLook('lcars'));

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New name' }), { target: { value: 'Neon Grid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    // A name a template has is numbered.
    expect(store.active().name).toBe('Neon Grid (2)');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    expect(store.get().profiles).toEqual([]);
    expect(store.active().id).toBe(LCARS);
  });

  it('switching a profile to the other template shows that template’s colors', () => {
    const store = new ProfilesStore(memoryStorage());
    store.create('Mine', templateLook('neonGrid'));
    renderSection(store);
    expect((screen.getByLabelText(/^Second neon/) as HTMLInputElement).value).toBe('#f500f5');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Template' })).getByRole('radio', { name: 'LCARS' }));
    expect(store.active().look.template).toBe('lcars');
    expect((screen.getByLabelText(/^Highlight/) as HTMLInputElement).value).toBe(templateLook('lcars').colors.highlight);
  });

  it('imports a profile file and says when a file is not one', async () => {
    const store = new ProfilesStore(memoryStorage());
    renderSection(store);
    const input = screen.getByLabelText('Import a profile file') as HTMLInputElement;
    const file = (text: string) => ({ name: 'p.json', text: () => Promise.resolve(text) }) as unknown as File;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file(JSON.stringify(profileFile({ id: 'p-x0000001', name: 'Shared', look: templateLook('lcars') })))] } });
    });
    expect(store.active()).toMatchObject({ name: 'Shared', look: { template: 'lcars' } });
    expect(screen.getByRole('status').textContent).toBe('Imported and loaded "Shared".');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file('hello')] } });
    });
    expect(screen.getByRole('status').textContent).toBe('That file is not an OpenMTG profile.');
  });
});

describe('Home: the LCARS space battle', () => {
  function home(store: ProfilesStore) {
    resetProfilesStoreForTests(store);
    return render(
      <NavProvider>
        <HomeScreen />
      </NavProvider>,
    );
  }

  it('is drawn behind Home only with the LCARS template and its scene on, hidden from screen readers', () => {
    // jsdom draws nothing on a canvas: the scene then stays blank instead of failing.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const store = new ProfilesStore(memoryStorage());
    const { container } = home(store);
    expect(container.querySelector('canvas')).toBeNull();
    act(() => store.select(LCARS));
    const canvas = container.querySelector('canvas.space-battle')!;
    expect(canvas).toBeTruthy();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    // The menu is unchanged.
    expect(within(screen.getByRole('navigation', { name: 'Main menu' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Play', 'Decks', 'Images', 'Settings', 'About']);
    act(() => {
      const id = store.create('Quiet', { ...templateLook('lcars'), scene: false })!;
      store.select(id);
    });
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('Home: the Reality Fracture sky', () => {
  function home(store: ProfilesStore) {
    resetProfilesStoreForTests(store);
    return render(
      <NavProvider>
        <HomeScreen />
      </NavProvider>,
    );
  }

  it('is drawn behind Home only with the Reality Fracture template and its scene on, hidden from screen readers', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const store = new ProfilesStore(memoryStorage());
    const { container } = home(store);
    expect(container.querySelector('canvas.fracture-scene')).toBeNull();
    act(() => store.select(FRACTURE));
    const canvas = container.querySelector('canvas.fracture-scene')!;
    expect(canvas).toBeTruthy();
    expect(canvas.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('canvas.space-battle')).toBeNull();
    expect(within(screen.getByRole('navigation', { name: 'Main menu' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['Play', 'Decks', 'Images', 'Settings', 'About']);
    act(() => {
      const id = store.create('Quiet', { ...templateLook('fracture'), scene: false })!;
      store.select(id);
    });
    expect(container.querySelector('canvas')).toBeNull();
  });
});

describe('the broken sky behind Home', () => {
  it('breaks the sky round the logo: its pieces lie apart with none in the hole the logo broke through, and a line through the logo splits the two worlds', () => {
    const s = createScene(1400, 900, 2026, { x: 0.5, y: 0.3 });
    const cx = 700;
    const cy = 270;
    expect(s.pieces.length).toBeGreaterThanOrEqual(15);
    const inHole = s.pieces.filter((p) => Math.hypot(p.c.x - cx, p.c.y - cy) < holeAt(s, Math.atan2(p.c.y - cy, p.c.x - cx)));
    expect(inHole).toEqual([]);
    // The hole is wider than the logo's frame all round, and ragged.
    const reach = Array.from({ length: 36 }, (_, i) => holeAt(s, (i / 36) * Math.PI * 2));
    expect(Math.min(...reach)).toBeGreaterThan(900 * 0.15);
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(20);
    // Left of the line is the real side, right of it the echo; the mirror of a point lies on the other side.
    expect(sideOf(s, { x: 70, y: 450 })).toBe('real');
    expect(sideOf(s, { x: 1330, y: 450 })).toBe('echo');
    const echo = mirrorPoint(s, { x: 140, y: 360 });
    expect(sideOf(s, echo)).toBe('echo');
    const back = mirrorPoint(s, echo);
    expect(back.x).toBeCloseTo(140, 9);
    expect(back.y).toBeCloseTo(360, 9);
    // The same break for the same seed, size and logo.
    expect(createScene(1400, 900, 2026, { x: 0.5, y: 0.3 }).pieces).toEqual(s.pieces);
  });

  it('is the same sky for the same seed; motes rise on the real side and fall on the echo side; shards circle the logo and drift off the screen to break off again', () => {
    const run = () => {
      const s = createScene(1200, 800, 5);
      const seen = { real: 0, echo: 0 };
      const wrong: string[] = [];
      for (let i = 0; i < 60 * 25; i++) {
        stepScene(s, 1 / 60);
        for (const m of s.motes) {
          seen[m.side]++;
          // Gravity is mirrored: up on the real side, down on the echo side.
          if (m.side === 'real' ? m.vy >= 0 : m.vy <= 0) wrong.push(`mote ${m.side} vy ${m.vy}`);
        }
        for (const sh of s.shards) {
          if (sh.orbit) {
            const o = orbitPlace(s, sh);
            if (Math.hypot(o.x - s.center.x * s.w, o.y - s.center.y * s.h) > s.w * 0.4) wrong.push('orbit too wide');
          } else if (sh.x < -200 || sh.x > 1400 || sh.y < -200 || sh.y > 1000) wrong.push(`shard at ${sh.x}, ${sh.y}`);
        }
      }
      return { wrong: wrong.slice(0, 5), seen, shards: s.shards.map((sh) => [Math.round(sh.x), Math.round(sh.y)]), motes: s.motes.length };
    };
    const a = run();
    expect(a.wrong).toEqual([]);
    expect(run()).toEqual(a);
    expect(a.seen.real).toBeGreaterThan(1000);
    expect(a.seen.echo).toBeGreaterThan(1000);
    expect(a.motes).toBeGreaterThan(20);
  });
});

describe('the space battle', () => {
  it('is the same battle for the same seed, keeps its ships near the screen and lands every beam on a shield', () => {
    const run = () => {
      const b = createBattle(1200, 800, 7);
      let hits = 0;
      for (let i = 0; i < 60 * 40; i++) {
        stepBattle(b, 1 / 60);
        for (const s of b.ships) {
          expect(s.x, 'x').toBeGreaterThan(-200);
          expect(s.x, 'x').toBeLessThan(1400);
          expect(s.y, 'y').toBeGreaterThan(-200);
          expect(s.y, 'y').toBeLessThan(1000);
        }
        if (b.ships.some((s) => s.shield > 0.5)) hits++;
      }
      return { hits, ships: b.ships.map((s) => [Math.round(s.x), Math.round(s.y)]) };
    };
    const a = run();
    expect(run()).toEqual(a);
    // Shields light up for a good part of the fight.
    expect(a.hits).toBeGreaterThan(60 * 5);
  });

  it('puts the point a beam strikes on the shield bubble, facing the shooter', () => {
    const b = createBattle(1000, 700, 3);
    const target = b.ships[1]!;
    target.heading = 0.7;
    const from = { x: target.x - 300, y: target.y + 40 };
    const hit = shieldHit(target, from.x, from.y);
    const sh = SHIELD[target.side];
    // Back in the target's frame the point is on the ellipse.
    const dx = hit.x - target.x;
    const dy = hit.y - target.y;
    const lx = (dx * Math.cos(-target.heading) - dy * Math.sin(-target.heading)) / target.size - sh.cx;
    const ly = (dx * Math.sin(-target.heading) + dy * Math.cos(-target.heading)) / target.size;
    expect((lx / sh.rx) ** 2 + (ly / sh.ry) ** 2).toBeCloseTo(1, 6);
    expect(Math.hypot(hit.x - from.x, hit.y - from.y)).toBeLessThan(Math.hypot(target.x - from.x, target.y - from.y));
  });
});

describe('stylesheets', () => {
  const src = path.resolve(__dirname, '..', 'src', 'theme');
  const rules = (file: string) =>
    [...readFileSync(path.join(src, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .map((m) => m[1]!.trim())
      .filter((s) => !s.startsWith('@') && !/^(from|to|\d+%)/.test(s));

  it("keeps every LCARS and Reality Fracture rule to its template and every Neon Grid profile rule to its own switches, so none changes another's look", () => {
    for (const selectors of rules('lcars.css')) {
      for (const sel of selectors.split(/,(?![^(]*\))/)) expect(sel.trim(), sel).toMatch(/^:root\[data-ui='lcars'\]/);
    }
    const fracture = rules('fracture.css');
    expect(fracture.length).toBeGreaterThan(150);
    for (const selectors of fracture) {
      for (const sel of selectors.split(/,(?![^(]*\))/)) expect(sel.trim(), sel).toMatch(/^:root\[data-ui='fracture'\]/);
    }
    for (const selectors of rules('neon-grid.css')) {
      for (const sel of selectors.split(/,(?![^(]*\))/)) expect(sel.trim(), sel).toMatch(/^:root\[(data-ui='grid'|data-motion='off')\]/);
    }
  });

  it('mutes a select choice that cannot be picked (a deck the format cannot play) in LCARS too, whose option color outranks the rule in styles.css', () => {
    const lcars = (selector: string) => declarations(cssOf('theme/lcars.css'), `:root[data-ui='lcars'] ${selector}`).color;
    expect(declarations(cssOf('theme/styles.css'), 'select option:disabled').color).toBe('var(--text-muted)');
    expect(lcars('select option:disabled')).toBe('var(--lc-muted)');
    expect(lcars('select option:disabled')).not.toBe(lcars('select option'));
  });
});
