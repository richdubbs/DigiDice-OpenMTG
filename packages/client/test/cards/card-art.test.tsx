/**
 * The art box of our own frame (ARCHITECTURE.md "Card images" A): procedural, deterministic, seeded by the card's name, cheap (inline SVG, no canvas,
 * no network, a few dozen nodes), and kept clear of anything that would touch an uploaded or Scryfall picture.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { artTypesOf, emblemTypeOf, hashString, landColorsOf, rngOf, textLenOf } from '../../src/cards/artSeed';
import { CardArt, planArt, type CardArtProps } from '../../src/cards/CardArt';
import { Card } from '../../src/cards/Card';
import { modelFromDef } from '../../src/cards/model';
import { CardImagesProvider } from '../../src/images/context';
import { def, testImages } from '../card-fixtures';

const art = (p: Partial<CardArtProps> = {}): CardArtProps => ({ seedName: 'Ember Drake', colors: ['R'], typeLine: 'Creature — Dragon', oracleText: '', ...p });
const markup = (p: Partial<CardArtProps>) => render(<CardArt {...art(p)} />).container.innerHTML;
/** The picture without the ids React hands each instance (they differ between renders; the picture does not). */
const picture = (html: string) => html.replace(/ id="[^"]*"/g, '').replace(/url\(#[^)]*\)/g, 'url()');

describe('seeds', () => {
  it('hashString and rngOf are deterministic and spread names apart', () => {
    expect(hashString('Forest')).toBe(hashString('Forest'));
    expect(hashString('Forest')).not.toBe(hashString('Island'));
    const a = rngOf(hashString('x'));
    const b = rngOf(hashString('x'));
    const seq = [a(), a(), a()];
    expect(seq).toEqual([b(), b(), b()]);
    expect(seq.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('classifies types: the emblem shows the first of planeswalker, battle, creature, land, artifact, enchantment, instant, sorcery', () => {
    expect(emblemTypeOf('Artifact Creature — Golem')).toBe('creature');
    expect(emblemTypeOf('Artifact Land')).toBe('land');
    expect(emblemTypeOf('Legendary Planeswalker — Jace')).toBe('planeswalker');
    expect(emblemTypeOf('Battle — Siege')).toBe('battle');
    expect(emblemTypeOf('Enchantment — Aura')).toBe('enchantment');
    expect(emblemTypeOf('Instant')).toBe('instant');
    expect(emblemTypeOf('Sorcery')).toBe('sorcery');
    expect(emblemTypeOf('Emblem')).toBe('enchantment');
    expect(emblemTypeOf('')).toBe('enchantment');
    expect(artTypesOf('Artifact Creature — Golem')).toEqual(['creature', 'artifact']);
  });

  it('CR 305.6: a land is drawn in the colors of its basic land types and of the mana its text makes', () => {
    expect(landColorsOf('Basic Land — Forest', '({T}: Add {G}.)')).toEqual(['G']);
    expect(landColorsOf('Land — Mountain Forest', '')).toEqual(['R', 'G']);
    expect(landColorsOf('Land', '{T}: Add {U} or {R}.')).toEqual(['U', 'R']);
    expect(landColorsOf('Land', '{T}: Add {C}.')).toEqual([]);
  });

  it('shares the room by the length of the rules text', () => {
    expect(['', 'Flying', 'x'.repeat(100), 'x'.repeat(200), 'x'.repeat(400)].map(textLenOf)).toEqual(['none', 'short', 'mid', 'long', 'xl']);
  });
});

describe('what is drawn', () => {
  it('plans one scene per color (at most three), a landscape for a land, brass for artifacts and crystal for colorless', () => {
    expect(planArt(art()).flavors).toEqual(['R']);
    expect(planArt(art({ colors: ['U', 'R'] })).flavors).toEqual(['U', 'R']);
    expect(planArt(art({ colors: ['W', 'U', 'B', 'R', 'G'] })).flavors).toEqual(['W', 'B', 'G']);
    expect(planArt(art({ colors: [], typeLine: 'Basic Land — Island', oracleText: '({T}: Add {U}.)' }))).toMatchObject({ flavors: ['U'], land: true, primary: 'land' });
    expect(planArt(art({ colors: [], typeLine: 'Land', oracleText: '{T}: Add {C}.' })).flavors).toEqual(['terra']);
    expect(planArt(art({ colors: [], typeLine: 'Artifact — Equipment' })).flavors).toEqual(['steel']);
    expect(planArt(art({ colors: [], typeLine: 'Sorcery' })).flavors).toEqual(['crystal']);
    // A colored artifact creature keeps its color and gets a gear.
    expect(planArt(art({ colors: ['G'], typeLine: 'Artifact Creature — Golem' }))).toMatchObject({ flavors: ['G'], gear: true });
  });

  it('is deterministic: the same card always gets the same picture, different names get different ones', () => {
    expect(picture(markup({}))).toBe(picture(markup({})));
    const names = ['Ember Drake', 'Lightning Spear', 'Cinder Imp', 'Flame Tongue', 'Ashen Colossus', 'Smoldering Wyrm'];
    const pictures = new Set(names.map((n) => picture(markup({ seedName: n }))));
    expect(pictures.size).toBe(names.length);
  });

  it('every flavor and type is drawn, as decoration only, in a few dozen nodes with no canvas, filter, image or network', () => {
    const cards: Partial<CardArtProps>[] = [
      { colors: ['R'] },
      { colors: ['U'], typeLine: 'Instant' },
      { colors: ['G'], typeLine: 'Enchantment — Aura' },
      { colors: ['B'], typeLine: 'Sorcery' },
      { colors: ['W'], typeLine: 'Creature — Angel' },
      { colors: ['U', 'R'], typeLine: 'Creature — Elemental' },
      { colors: ['W', 'U', 'B'], typeLine: 'Planeswalker — Test' },
      { colors: [], typeLine: 'Artifact', seedName: 'Gizmo' },
      { colors: [], typeLine: 'Sorcery', seedName: 'Shard' },
      { colors: [], typeLine: 'Battle — Siege', seedName: 'Siege' },
      ...(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] as const).map((t) => ({ colors: [], typeLine: `Basic Land — ${t}`, seedName: t })),
      { colors: [], typeLine: 'Land', oracleText: '{T}: Add {W} or {B}.', seedName: 'Scrubland' },
    ];
    for (const c of cards) {
      const { container } = render(<CardArt {...art(c)} />);
      const box = container.querySelector('.frame-art') as HTMLElement;
      expect(box.getAttribute('aria-hidden')).toBe('true');
      expect(container.querySelectorAll('canvas, img, image, filter, foreignObject, animate, script')).toHaveLength(0);
      expect(container.querySelectorAll('*').length, JSON.stringify(c)).toBeLessThan(110);
      expect(container.querySelectorAll('svg path, svg rect, svg circle, svg g, svg ellipse, svg polygon').length).toBeGreaterThan(6);
      expect(container.querySelector('.art-emblem')).toBeTruthy();
      expect(container.innerHTML).not.toMatch(/https?:|href=/);
    }
  });

  it('marks what it drew on the box (flavors and type) for tests and styling', () => {
    const { container } = render(<CardArt {...art({ colors: ['U', 'R'], typeLine: 'Instant' })} />);
    const box = container.querySelector('.frame-art') as HTMLElement;
    expect(box.dataset.art).toBe('UR');
    expect(box.dataset.artType).toBe('instant');
  });

  it('draws a creature after its subtypes: a dragon is winged, a spider has legs', () => {
    expect(markup({ typeLine: 'Creature — Dragon' })).not.toBe(markup({ typeLine: 'Creature — Spider' }));
  });
});

describe('the art box in the frame', () => {
  const show = (name: string) => {
    const { images } = testImages();
    return render(
      <CardImagesProvider images={images}>
        <Card card={modelFromDef(def(name))} />
      </CardImagesProvider>,
    );
  };

  it('every layout of the placeholder frame carries art, a type emblem in the type line, and keeps the type line and rules text in the DOM', () => {
    const { container } = show('Aardvark Sloth');
    const frame = container.querySelector('.card-frame') as HTMLElement;
    expect(frame.querySelectorAll('.frame-art')).toHaveLength(1);
    expect(frame.querySelector('.frame-type .type-medal')).toBeTruthy();
    expect(frame.querySelector('.frame-type')!.textContent).toContain('Creature — Sloth Beast');
    expect(frame.querySelector('.frame-text')!.textContent).toContain('Lifelink');
    expect(frame.querySelector('.frame-art')!.getAttribute('data-art-type')).toBe('creature');
  });

  it('a split card shares one art band; a flip card one band between its halves', () => {
    const split = show('Commit // Memory').container.querySelector('.frame-split') as HTMLElement;
    expect(split.querySelectorAll('.frame-art')).toHaveLength(1);
    expect(split.querySelectorAll('.frame-half')).toHaveLength(2);
    const flip = show('Akki Lavarunner // Tok-Tok, Volcano Born').container.querySelector('.frame-flip') as HTMLElement;
    expect(flip.querySelectorAll('.frame-art')).toHaveLength(1);
    expect(flip.children[1]!.classList.contains('frame-art')).toBe(true);
  });

  it('basic lands are drawn as a landscape of their type', () => {
    const { container } = show('Forest');
    const box = container.querySelector('.frame-art') as HTMLElement;
    expect(box.dataset.art).toBe('G');
    expect(box.dataset.artType).toBe('land');
  });
});
