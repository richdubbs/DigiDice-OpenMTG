/**
 * Cards for the card-component tests: the engine's offline fixtures (Oracle fields only, never image URLs; ARCHITECTURE.md "Card images"), compiled by
 * the default compiler as a game would, plus helpers that render inside an image provider with a fake store.
 */
import { compileCard, type CardDef, type OracleCard } from '@openmtg/engine';
import type { CardSummary } from '@openmtg/server/api';
import fixtures from '../../engine/test/fixtures/cards.json';
import { createCardImages, type CardImages } from '../src/images/context';
import type { UrlLookup } from '../src/images/scryfall';
import { idbImageStore } from '../src/images/store';
import { fakeIndexedDB, fakeObjectUrls } from './fake-indexeddb';

const ALL: OracleCard[] = [...(fixtures as { cards: OracleCard[]; tokens: OracleCard[] }).cards, ...(fixtures as { tokens: OracleCard[] }).tokens];

export function oracle(name: string): OracleCard {
  const c = ALL.find((x) => x.name === name);
  if (!c) throw new Error(`No fixture card ${name}`);
  return c;
}

/** A fixture token picked by its name and characteristics: several token variants share a name (the fixture set grows with each round's cards). */
export function fixtureToken(name: string, power: string, toughness: string, text: string): OracleCard {
  const c = ALL.find((x) => x.name === name && x.power === power && x.toughness === toughness && (x.oracle_text ?? '') === text);
  if (!c) throw new Error(`No fixture token ${name} ${power}/${toughness} "${text}"`);
  return c;
}

const DEFS = new Map<string, CardDef>();
/** The compiled definition of a fixture card (memoized: compiling is the slow part). */
export function def(name: string): CardDef {
  let d = DEFS.get(name);
  if (!d) {
    d = compileCard(oracle(name));
    DEFS.set(name, d);
  }
  return d;
}

/** A CardSummary as the server would send it (C1 builds the real ones). */
export function summary(name: string, extra: Partial<CardSummary> = {}): CardSummary {
  const c = oracle(name);
  const faces = (c.card_faces && c.card_faces.length > 0 ? c.card_faces : [c]).map((f) => ({
    name: f.name,
    manaCost: f.mana_cost ?? c.mana_cost ?? null,
    typeLine: f.type_line ?? c.type_line ?? '',
    oracleText: f.oracle_text ?? '',
    colors: (f.colors ?? c.colors ?? []) as CardSummary['colors'],
    ...(f.power !== undefined ? { power: f.power } : {}),
    ...(f.toughness !== undefined ? { toughness: f.toughness } : {}),
    ...(f.loyalty !== undefined ? { loyalty: f.loyalty } : {}),
    ...(f.defense !== undefined ? { defense: f.defense } : {}),
  }));
  return {
    name: c.name,
    oracleId: c.oracle_id ?? c.name,
    layout: c.layout,
    manaValue: c.cmc ?? 0,
    colors: (c.colors ?? []) as CardSummary['colors'],
    colorIdentity: (c.color_identity ?? []) as CardSummary['colors'],
    faces,
    legalities: {},
    automation: def(name).automation.level,
    ...extra,
  };
}

/**
 * Image sources over a fake IndexedDB and fake object URLs; `lookup` answers Scryfall URL questions (none by default); `canShow` says which files the
 * "browser" can decode (all by default: jsdom decodes nothing).
 */
export function testImages(lookup: UrlLookup = async () => null, opts: { canShow?: (file: Blob) => Promise<boolean> } = {}) {
  const idb = fakeIndexedDB();
  const urls = fakeObjectUrls();
  const images: CardImages = createCardImages({ store: idbImageStore(idb.factory, 'test-images'), urls, lookup, canShow: opts.canShow ?? (async () => true) });
  return { images, idb, urls };
}

/** An image file as the browser's file picker gives it. */
export const imageFile = (name: string, type = 'image/jpeg', bytes = 'img') => new File([bytes], name, { type });
