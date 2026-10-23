/**
 * The type emblem: a small glyph of our own drawing for the card's main type (creature claws, instant bolt, sorcery spellbook, enchantment sparkle,
 * artifact gear, planeswalker gem, battle swords, land vista). It stands where a set symbol sits on a printed card (right end of the type line) and, on
 * small cards where the type line is hidden, in the corner of the art box. Decorative: the type line carries the words.
 */
import { gearPath } from './artShapes';
import type { ArtType } from './artSeed';

const GEAR = gearPath(12, 12, 11, 8, 8, 3.6);
const SWORD = 'M12 1.2 14 4.2V14.6H10V4.2ZM6.8 14.6H17.2V17H6.8ZM10.8 17H13.2V21H10.8ZM12 20.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Z';

function Glyph({ type }: { type: ArtType }) {
  switch (type) {
    case 'creature':
      // Three claw marks.
      return (
        <>
          <path d="M3 2C8.5 7.5 10.5 14 8.6 22.5 6.5 15 4.6 9.5 3 2Z" />
          <path d="M9.6 1.5C15.6 7 17.6 14 15.6 22.5 13.2 15 11.2 9 9.6 1.5Z" />
          <path d="M16.4 2C21 7.5 22.6 13 21 22 19.2 15 17.8 9.5 16.4 2Z" />
        </>
      );
    case 'instant':
      return <path d="M14 .8 4.2 13.4h6.2L8.8 23.2 20 9.4h-6.4Z" />;
    case 'sorcery':
      // An open spellbook.
      return <path fillRule="evenodd" d="M12 5.6C9.2 3.8 5.2 3.6 1.8 4.8V19.6C5.2 18.4 9.2 18.7 12 20.6 14.8 18.7 18.8 18.4 22.2 19.6V4.8C18.8 3.6 14.8 3.8 12 5.6ZM11.2 8.2C8.9 6.9 5.9 6.7 3.6 7.3V16.6C5.9 16 8.9 16.2 11.2 17.5ZM12.8 8.2V17.5C15.1 16.2 18.1 16 20.4 16.6V7.3C18.1 6.7 15.1 6.9 12.8 8.2Z" />;
    case 'enchantment':
      return (
        <>
          <path d="M11 2C11.8 8 14 10.2 20 11 14 11.8 11.8 14 11 20 10.2 14 8 11.8 2 11 8 10.2 10.2 8 11 2Z" />
          <path d="M19 14.5C19.3 17 20.2 17.9 22.6 18.2 20.2 18.5 19.3 19.4 19 22 18.7 19.4 17.8 18.5 15.4 18.2 17.8 17.9 18.7 17 19 14.5Z" />
          <path d="M18.6 1.4C18.8 2.9 19.3 3.4 20.8 3.6 19.3 3.8 18.8 4.3 18.6 5.8 18.4 4.3 17.9 3.8 16.4 3.6 17.9 3.4 18.4 2.9 18.6 1.4Z" />
        </>
      );
    case 'artifact':
      return <path fillRule="evenodd" d={GEAR} />;
    case 'planeswalker':
      return (
        <>
          <path d="M12 1.5 21.5 9 12 22.5 2.5 9Z" />
          <path d="M2.5 9H21.5L12 22.5Z" fill="#000" fillOpacity=".28" />
          <path d="M12 1.5 8.2 9 12 22.5 15.8 9Z" fill="#fff" fillOpacity=".3" />
        </>
      );
    case 'battle':
      return (
        <>
          <path d={SWORD} transform="rotate(45 12 12)" />
          <path d={SWORD} transform="rotate(-45 12 12)" />
        </>
      );
    case 'land':
      return (
        <>
          <path d="M1 21 8.6 7.6l3.6 6.1 3-4.1L23 21Z" />
          <circle cx="18.6" cy="5.2" r="3" />
        </>
      );
  }
}

export function TypeEmblem({ type, className = '' }: { type: ArtType; className?: string }) {
  return (
    <svg className={`type-emblem ${className}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-emblem={type}>
      <Glyph type={type} />
    </svg>
  );
}
