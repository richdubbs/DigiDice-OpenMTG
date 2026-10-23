/** The game board (work package C4): what the game screen (C5) imports. */
export { GameBoard, type GameBoardProps } from './GameBoard';
export type { BoardInteraction } from './context';
export { CardBack, PlaceholderCard, defaultCardRenderer, noArtist, type ArtistHook, type BoardCardProps, type CardRenderer, type CardSize } from './cardRenderer';
export { setStopsAction, toggleStop } from './PhaseBar';
export type { PlayerSleeves } from './sleeves';
export { filterLog, type TurnFilter } from './GameLog';
export { playableObjects, stackItems, battlefieldRows, seating, objectName, targetName } from './model';
export type { SetStopsAction } from './types';
