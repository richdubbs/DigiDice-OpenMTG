/**
 * Downloading a rules pack (updates.md "Integrity"): the configured URL ($OPENMTG_PACK_URL, no default until the project has a public home) serves a
 * small manifest with the pack's SHA-256 and size; the pack named by the manifest (relative to the manifest's final URL) is downloaded and checked
 * against it before anything is installed. `fetch` is injectable (tests never touch the network).
 *
 * HTTPS on every hop: redirects are followed by hand (at most MAX_REDIRECTS), each Location must be https:, and the final URL of every response is
 * checked too. The manifest is the only integrity anchor, so a plain-HTTP hop would let anyone on the path swap manifest and pack together.
 * Size limits are enforced while reading (a body without Content-Length is cut off as soon as it passes the limit, never read whole first); the pack's
 * limit is the size the manifest announces.
 */
import { validateManifest, type PackManifest } from './format';
import { PackError, verifyAgainstManifest } from './install';

export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_PACK_BYTES = 64 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
const USER_AGENT = 'OpenMTG/0.5 (rules pack update)';

function httpsUrl(u: string, what: string): URL {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new PackError(`${what} is not a URL: ${u}`);
  }
  if (url.protocol !== 'https:') throw new PackError(`${what} must be an https:// URL (got ${url.protocol})`);
  return url;
}

/** Read a body, refusing it as soon as it passes `limit` bytes (the stream is cancelled; nothing beyond the limit is kept). */
async function readLimited(res: Response, limit: number, href: string): Promise<Uint8Array> {
  const over = (): PackError => new PackError(`${href} is over the limit of ${limit} bytes`);
  if (!res.body) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > limit) throw over();
    return bytes;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw over();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/** GET over HTTPS only, following redirects by hand. Returns the bytes and the final URL. */
async function getBytes(start: URL, limit: number, fetchImpl: typeof fetch): Promise<{ bytes: Uint8Array; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'manual' });
    } catch (e) {
      throw new PackError(`cannot download ${url.href}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // the response's own URL (a fetch that followed redirects anyway, or a proxy) must be HTTPS as well
    if (res.url) httpsUrl(res.url, `the download of ${url.href} ended at ${res.url}, which`);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new PackError(`cannot download ${url.href}: HTTP ${res.status} without a Location`);
      if (hop >= MAX_REDIRECTS) throw new PackError(`cannot download ${start.href}: more than ${MAX_REDIRECTS} redirects`);
      url = httpsUrl(new URL(loc, url).href, `the redirect from ${url.href}`);
      await res.body?.cancel().catch(() => undefined);
      continue;
    }
    if (res.type === 'opaqueredirect') throw new PackError(`cannot download ${url.href}: a redirect that cannot be checked`);
    if (!res.ok) throw new PackError(`cannot download ${url.href}: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') ?? '0');
    if (len > limit) throw new PackError(`${url.href} is ${len} bytes, over the limit of ${limit}`);
    return { bytes: await readLimited(res, limit, url.href), url };
  }
}

/** Download the manifest at `manifestUrl`, then the pack it names, verified against it. */
export async function downloadPack(manifestUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Uint8Array; manifest: PackManifest; packUrl: string }> {
  const mStart = httpsUrl(manifestUrl, 'OPENMTG_PACK_URL');
  const { bytes: mBytes, url: mUrl } = await getBytes(mStart, MAX_MANIFEST_BYTES, fetchImpl);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(mBytes));
  } catch {
    throw new PackError(`${mUrl.href} is not a JSON manifest`);
  }
  const manifest = validateManifest(json);
  if (typeof manifest === 'string') throw new PackError(`${mUrl.href}: ${manifest}`);
  const pStart = httpsUrl(new URL(manifest.file, mUrl).href, 'the pack URL in the manifest');
  if (manifest.size > MAX_PACK_BYTES) throw new PackError(`the manifest announces ${manifest.size} bytes, over the limit of ${MAX_PACK_BYTES}`);
  const { bytes, url: pUrl } = await getBytes(pStart, manifest.size, fetchImpl);
  verifyAgainstManifest(bytes, manifest);
  return { bytes, manifest, packUrl: pUrl.href };
}
