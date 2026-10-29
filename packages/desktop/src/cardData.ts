/** Keeping the card data fresh: the server's (packages/server cardData.ts), which the Godot app's server runs too. */
export { CARD_DATA_MAX_AGE_MS, cardDataStale, refreshCardData } from '@openmtg/server';
