/**
 * Avatars (milestone 14, accounts design 7.1): an account's picture is one of 48 of OpenMTG's own, 8 shapes in 6 tones, chosen by id (`AvatarId`,
 * the contract in `@openmtg/accounts/api`; a new account starts with `defaultAvatar(accountId)`). The files are assets/avatars/<id>.svg, made by
 * scripts/brand/gen-avatars.mjs. Unlike the DigiDice brand assets they are under the repository's MIT licence (assets/avatars/README.md).
 *
 * This module maps each id to its picture's URL and to a name for alt text ("Magenta d20"): the pictures themselves carry no text. Vite bundles the
 * files as separate assets, never inlined into the script (`?no-inline`), so a page fetches only the pictures it shows.
 */
import { AVATAR_SHAPES, AVATAR_TONES, isAvatarId, type AvatarId } from '@openmtg/accounts/api';

export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarTone = (typeof AVATAR_TONES)[number];

export interface Avatar {
  id: AvatarId;
  shape: AvatarShape;
  tone: AvatarTone;
  /** "Magenta d20", "White comet": the picture's alt text. */
  name: string;
  /** The picture. */
  url: string;
}

/** The picture shown for an id this build does not know (from a newer server, or none at all). */
export const FALLBACK_AVATAR: AvatarId = 'chip-white';

const FILES = import.meta.glob<string>('../../../../assets/avatars/*.svg', { eager: true, import: 'default', query: '?no-inline' });
/** Each picture's URL by the file's name without ".svg". */
const URLS: ReadonlyMap<string, string> = new Map(Object.entries(FILES).map(([file, url]) => [file.slice(file.lastIndexOf('/') + 1, -'.svg'.length), url]));

const TONE_NAMES: Readonly<Record<AvatarTone, string>> = { blue: 'Blue', magenta: 'Magenta', violet: 'Violet', cyan: 'Cyan', amber: 'Amber', white: 'White' };

/** The 48 avatars in the order of AVATAR_IDS (shape by shape): the order a picker shows them in. */
export const AVATARS: readonly Avatar[] = Object.freeze(
  AVATAR_SHAPES.flatMap((shape) =>
    AVATAR_TONES.map((tone): Avatar => {
      const id: AvatarId = `${shape}-${tone}`;
      const url = URLS.get(id);
      // The ids and the files come from the same commit (packages/accounts/test/m14-9 checks them): a gap is a broken checkout, not a state to draw.
      if (url === undefined) throw new Error(`the avatar picture assets/avatars/${id}.svg is missing (node scripts/brand/gen-avatars.mjs makes it)`);
      return Object.freeze({ id, shape, tone, name: `${TONE_NAMES[tone]} ${shape}`, url });
    }),
  ),
);

const BY_ID: ReadonlyMap<string, Avatar> = new Map(AVATARS.map((a) => [a.id, a]));

/** An avatar by id; undefined for anything that is not one of the 48. */
export function avatarById(id: unknown): Avatar | undefined {
  return isAvatarId(id) ? BY_ID.get(id) : undefined;
}

/** The avatar to draw for an id: its own, or FALLBACK_AVATAR for an id this build does not know. */
export function avatarFor(id: unknown): Avatar {
  return avatarById(id) ?? BY_ID.get(FALLBACK_AVATAR)!;
}

/** The URL of the picture to draw for an id (FALLBACK_AVATAR's for an unknown id). */
export function avatarUrl(id: unknown): string {
  return avatarFor(id).url;
}

/** The alt text of the picture drawn for an id (FALLBACK_AVATAR's for an unknown id). */
export function avatarName(id: unknown): string {
  return avatarFor(id).name;
}
