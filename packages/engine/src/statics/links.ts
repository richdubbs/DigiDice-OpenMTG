/**
 * Linked abilities (CR 607): the per-object link store `GameObject.links`, and the namespaces of granted pairs. Owner: WP9 (design 3.9, 9.6).
 * WP0 defined the data (`LinkValue`, `GameObject.links`, cloned by `cloneObject`) and the exports design 9.6 fixes (`setLink`, `readLink`, `grantNamespace`).
 *
 * The store lives on the object INSTANCE: a new object (any zone change, CR 400.7) starts with no links, and an object that left keeps its last known links in
 * its `LastKnown.object`. Reading never creates the record; writing creates it. Link ids are plain strings chosen by the card data ("exiled", "chosenColor").
 */
import type { GameObject, LinkValue } from '../types/state';
import type { LinkId } from '../types/ability';

/** What the object's linked ability remembers under `link` (CR 607.2a), or undefined. A missing object or a missing record reads as undefined. */
export function readLink(o: GameObject | undefined, link: LinkId): LinkValue | undefined {
  const store = o?.links;
  return store !== undefined && Object.hasOwn(store, link) ? store[link] : undefined; // hasOwn: a link named "constructor" or "__proto__" is just a name
}

/**
 * Store a link value on the object instance (replacing any earlier one under that id). The value is copied, so later edits of the caller's arrays cannot reach
 * the state (design 4.3: `links` is deep-copied by `cloneObject`, and nothing may alias it).
 */
export function setLink(o: GameObject, link: LinkId, value: LinkValue): void {
  const copy: LinkValue = {};
  if (value.objects !== undefined) copy.objects = value.objects.map((h) => ({ id: h.id, zone: h.zone }));
  if (value.players !== undefined) copy.players = value.players.slice();
  if (value.values !== undefined) copy.values = value.values.slice();
  if (value.secret !== undefined) copy.secret = value.secret.slice(); // std-combat-5 (CR 608.2d)
  if (o.links === undefined) o.links = {};
  // defineProperty keeps a link called "__proto__" an ordinary own property instead of changing the prototype of the record.
  Object.defineProperty(o.links, link, { value: copy, writable: true, enumerable: true, configurable: true });
}

/** Forget one link (CR 607.2a: the link only remembers what is still there). A no-op when nothing was stored. */
export function clearLink(o: GameObject, link: LinkId): void {
  if (o.links !== undefined && Object.hasOwn(o.links, link)) delete o.links[link];
}

/**
 * CR 607.2h, 613.6: a pair of linked abilities granted together shares one link namespace per granting effect, so two copies of the grant (two Auras giving
 * the same pair of abilities) don't read each other's choices. The namespaced id is what both granted halves use.
 */
export function grantNamespace(effectId: string, link: LinkId): LinkId {
  return `${effectId}#${link}`;
}
