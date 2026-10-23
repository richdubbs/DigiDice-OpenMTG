/**
 * M14-9: the client's avatar map (src/branding/avatars.ts, accounts design 7.1): every AvatarId has its picture and a name for alt text, in the order
 * of AVATAR_IDS; an unknown id draws the fallback; and every picture is an SVG document to the browser's own XML parser (DOMParser), with nothing in
 * it a picture shown with <img> could not draw or should not hold (the file checks themselves are packages/accounts/test/m14-9).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AVATAR_IDS, defaultAvatar, isAvatarId } from '@openmtg/accounts/api';
import { describe, expect, it } from 'vitest';
import { AVATARS, FALLBACK_AVATAR, avatarById, avatarFor, avatarName, avatarUrl } from '../../src/branding/avatars';

const avatarDir = path.resolve(__dirname, '..', '..', '..', '..', 'assets', 'avatars');
const file = (id: string): string => readFileSync(path.join(avatarDir, `${id}.svg`), 'utf8');

describe('M14-9: the avatar map', () => {
  it('has every avatar id once, in the order of AVATAR_IDS, each with its own picture', () => {
    expect(AVATARS.map((a) => a.id)).toEqual([...AVATAR_IDS]);
    expect(new Set(AVATARS.map((a) => a.url)).size).toBe(48);
    for (const a of AVATARS) {
      // Vite's file (the build adds a hash to the name), never a data: URL inlined into the script.
      expect(a.url).toMatch(new RegExp(`(^|/)${a.id}(-[\\w-]+)?\\.svg(\\?.*)?$`));
      expect(a.url.startsWith('data:')).toBe(false);
      expect(`${a.shape}-${a.tone}`).toBe(a.id);
      expect(avatarById(a.id)).toBe(a);
      expect(avatarUrl(a.id)).toBe(a.url);
    }
  });

  it('names each one for alt text, tone then shape', () => {
    expect(avatarName('d20-magenta')).toBe('Magenta d20');
    expect(avatarName('comet-white')).toBe('White comet');
    expect(avatarName('d4-blue')).toBe('Blue d4');
    expect(avatarName('chip-amber')).toBe('Amber chip');
    expect(new Set(AVATARS.map((a) => a.name)).size).toBe(48);
  });

  it('draws the fallback for an id this build does not know', () => {
    expect(isAvatarId(FALLBACK_AVATAR)).toBe(true);
    for (const unknown of ['d7-blue', 'd20-green', 'D20-MAGENTA', '', null, undefined, 42, { id: 'd4-blue' }]) {
      expect(avatarById(unknown)).toBeUndefined();
      expect(avatarFor(unknown).id).toBe(FALLBACK_AVATAR);
      expect(avatarUrl(unknown)).toBe(avatarUrl(FALLBACK_AVATAR));
      expect(avatarName(unknown)).toBe(avatarName(FALLBACK_AVATAR));
    }
  });

  it('has the picture of every default avatar', () => {
    for (const id of ['acc_00000000000000000000000000', 'acc_7ZZZZZZZZZZZZZZZZZZZZZZZZZ', 'acc_3HJKMNPQRSTVWXYZ0123456789'] as const) {
      expect(avatarById(defaultAvatar(id))?.id).toBe(defaultAvatar(id));
    }
  });

  it('every picture is an SVG document to the browser, with no script, text, link or foreign content', () => {
    const parser = new DOMParser();
    for (const id of AVATAR_IDS) {
      const doc = parser.parseFromString(file(id), 'image/svg+xml');
      expect(doc.getElementsByTagName('parsererror'), id).toHaveLength(0);
      const root = doc.documentElement;
      expect(root.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(root.localName).toBe('svg');
      expect(root.getAttribute('viewBox')).toBe('0 0 256 256');
      expect(root.querySelectorAll('script, foreignObject, image, use, a, style, text, title, desc, iframe, feImage'), id).toHaveLength(0);
      expect(root.textContent?.trim(), id).toBe('');
      for (const el of Array.from(root.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(attr.name === 'href' || attr.localName === 'href' || /^on/i.test(attr.name), `${id}: <${el.localName} ${attr.name}>`).toBe(false);
        }
      }
    }
  });
});
