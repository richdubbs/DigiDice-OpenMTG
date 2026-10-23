/** WP27: rules packs (updates.md, design 12.5): format validation, build, tamper detection, textHash mismatch, requiresEngine, examples stripped. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ABILITY_MODEL_VERSION, compileCardDetailed, type CompiledCardEntry, type OracleCard, type Template } from '@openmtg/engine';
import { faceViews } from '../../src/llm/face-lines';
import { runGates } from '../../src/llm/gates';
import { cardWork } from '../../src/llm/work';
import { buildPack, cardTextIn } from '../../src/pack/build';
import { packApplicability } from '../../src/pack/delta';
import { downloadPack } from '../../src/pack/fetch';
import { STORED_REASON } from '../../src/pack/card-text';
import { MANIFEST_FORMAT, PACK_READER_VERSION, compareVersions, validatePack, type RulesPack } from '../../src/pack/format';
import { INSTALLED_FILE, PACK_FILE, PackError, installPack, loadInstalledPack, sha256, verifyAgainstManifest } from '../../src/pack/install';
import { sourcesWith } from '../../src/pack/sources';
import { tempDir } from '../helpers';
import { bareSources, fixture, goodReply, manualTriggerCard } from '../llm/support';

const NOW = new Date('2026-10-12T10:00:00Z');

/** A reviewed LLM entry for a fixture card the bare parser leaves manual (made through the real gates). */
function entryFor(name: string | OracleCard, review: CompiledCardEntry['review'] = 'reviewed'): CompiledCardEntry {
  const card = typeof name === 'string' ? fixture(name) : name;
  const work = cardWork(card, bareSources())!;
  const g = runGates({ work, sources: bareSources(), views: faceViews(card) }, goodReply(work));
  if (!g.ok) throw new Error(`${card.name}: ${g.message}`);
  return { oracleId: card.oracle_id!, textHash: work.report.textHash, modelVersion: ABILITY_MODEL_VERSION, faces: g.faces, review, source: 'llm', flags: [] };
}

const byId = (...cards: OracleCard[]): Map<string, OracleCard> => new Map(cards.map((c) => [c.oracle_id!, c]));

function build(entries: CompiledCardEntry[], overrides: unknown[] = [], cards = [fixture('Lightning Bolt'), fixture('Giant Growth'), fixture('Doom Blade')]) {
  return buildPack({ llm: entries, overrides, cardsById: byId(...cards), sources: bareSources(), packVersion: '2026.10.12-1', createdAt: NOW.toISOString() });
}

describe('build-pack (design 12.5)', () => {
  it('packs reviewed entries only, structure only: no card names or Oracle text', () => {
    const r = build([entryFor('Lightning Bolt'), entryFor('Giant Growth', 'autoverified')]);
    expect(r.included).toEqual([fixture('Lightning Bolt').oracle_id]);
    const text = new TextDecoder().decode(r.bytes);
    for (const c of [fixture('Lightning Bolt'), fixture('Giant Growth')]) {
      expect(text).not.toContain(c.name);
      expect(text).not.toContain(c.oracle_text!);
    }
    expect(text).not.toMatch(/"text"|"span"|"label"|"prov"/);
    expect(r.manifest).toMatchObject({ format: MANIFEST_FORMAT, sha256: sha256(r.bytes), size: r.bytes.length, file: PACK_FILE });
    expect(r.pack).toMatchObject({ minEngineVersion: PACK_READER_VERSION, modelVersion: ABILITY_MODEL_VERSION, requiresEngine: {} });
    expect(r.delta).toMatchObject({ cards: 1, up: [{ name: 'Lightning Bolt', from: 'manual', to: 'full' }], down: [] });
  });
  it('excludes entries with card text, stale text hashes and unknown cards; hand-written overrides win', () => {
    const leak = entryFor('Giant Growth');
    (leak.faces[0]!.abilities[0] as Record<string, unknown>)['note'] = 'Giant Growth';
    const stale = { ...entryFor('Doom Blade'), textHash: 'a'.repeat(64) };
    const stranger = { ...entryFor('Lightning Bolt'), oracleId: '00000000-0000-0000-0000-000000000000' };
    const hand = { ...entryFor('Lightning Bolt'), source: 'hand', review: 'unreviewed', flags: ['override'] };
    const r = build([leak, stale, stranger, entryFor('Lightning Bolt')], [hand]);
    expect(r.included).toEqual([fixture('Lightning Bolt').oracle_id]);
    expect(r.pack.cards[fixture('Lightning Bolt').oracle_id!]).toMatchObject({ source: 'hand', review: 'reviewed' });
    expect(r.excluded.map((x) => x.reason)).toEqual(expect.arrayContaining([
      expect.stringMatching(/contains card text/), expect.stringMatching(/another wording/), expect.stringMatching(/not in the local card data/),
    ]));
  });
  it('cardTextIn finds a face name or a run of Oracle text', () => {
    const c = fixture('Lightning Bolt');
    expect(cardTextIn({ faces: [{ abilities: [{ x: 'lightning bolt' }] }] }, c)).toBe('lightning bolt');
    expect(cardTextIn({ faces: [{ abilities: [{ x: 'damage to any target' }] }] }, c)).toBe('damage to any target');
    expect(cardTextIn({ faces: [{ abilities: [{ op: 'damage', ref: 'target' }] }] }, c)).toBeNull();
  });
  it('lists cards that need engine features this build lacks (requiresEngine)', () => {
    const r = build([entryFor('Lightning Bolt')]);
    const pack: RulesPack = { ...r.pack, requiresEngine: { [fixture('Lightning Bolt').oracle_id!]: ['op:damage', 'feature:not-in-this-build'], [fixture('Doom Blade').oracle_id!]: ['op:damage'] } };
    const v = validatePack(JSON.parse(JSON.stringify(pack)));
    if ('fatal' in v) throw new Error(v.fatal);
    const app = packApplicability(v, byId(fixture('Lightning Bolt'), fixture('Doom Blade')), bareSources());
    expect(app.needsNewer).toEqual([{ name: 'Lightning Bolt', missing: ['feature:not-in-this-build'] }]);
    expect(app.matching).toBe(1);
  });
});

describe('updates.md "No Wizards or Scryfall content in packs": free text and contained card text', () => {
  it('a reviewed entry whose manual reason quotes the "~" line is packed with the fixed reason: the pack bytes hold no Oracle text', () => {
    const card = manualTriggerCard(); // M6-4: Huntmaster of the Fells, used here before, now parses (its werewolf lines)
    const e = entryFor(card);
    const line = faceViews(card)[0]!.lines.reduce((a, b) => (b.length > a.length ? b : a), '');
    const quote = `cannot represent "${line}" exactly`;
    const visit = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(visit);
      else if (x && typeof x === 'object') {
        const r = x as Record<string, unknown>;
        if (typeof r['reason'] === 'string') r['reason'] = quote;
        Object.values(r).forEach(visit);
      }
    };
    visit(e.faces);
    expect(JSON.stringify(e.faces)).toContain(line);
    const r = build([e], [], [card]);
    expect(r.included).toEqual([card.oracle_id]);
    const text = new TextDecoder().decode(r.bytes);
    expect(text).not.toContain(line.slice(2, 30));
    expect(text).toContain(STORED_REASON);
  });
  it('an entry with the card name or Oracle text inside a longer string is excluded (containment, not equality)', () => {
    const named = entryFor('Giant Growth');
    (named.faces[0]!.abilities[0] as Record<string, unknown>)['as'] = 'Giant Growth needs a shapeshift effect';
    const quoted = entryFor('Doom Blade');
    (quoted.faces[0]!.abilities[0] as Record<string, unknown>)['as'] = 'see "Destroy target nonblack creature." here';
    const r = build([named, quoted]);
    expect(r.included).toEqual([]);
    expect(r.excluded.map((x) => x.reason)).toEqual([expect.stringMatching(/contains card text/), expect.stringMatching(/contains card text/)]);
  });
  it('validatePack (the installer) rejects an entry carrying a free-text reason', () => {
    const p = JSON.parse(new TextDecoder().decode(build([entryFor('Lightning Bolt')]).bytes)) as RulesPack;
    const id = fixture('Lightning Bolt').oracle_id!;
    p.cards[id]!.faces[0]!.abilities.push({ kind: 'manual', shape: 'static', reason: 'Lightning Bolt deals 3 damage', src: [0] } as never);
    const v = validatePack(p);
    if ('fatal' in v) throw new Error(v.fatal);
    expect(v.entries.size).toBe(0);
    expect(v.problems.map((x) => x.reason)).toEqual([expect.stringMatching(/free text/)]);
  });
  it('the overrides folder takes hand-written entries only: an LLM entry copied there is excluded, whatever its review state', () => {
    const llmCopy = { ...entryFor('Giant Growth'), review: 'autoverified' };
    const r = build([], [llmCopy]);
    expect(r.included).toEqual([]);
    expect(r.excluded).toEqual([{ oracleId: fixture('Giant Growth').oracle_id, reason: expect.stringMatching(/only hand-written entries/) }]);
  });
});

describe('pack validation (updates.md: data only, rejected individually)', () => {
  const base = (): Record<string, unknown> => JSON.parse(new TextDecoder().decode(build([entryFor('Lightning Bolt')]).bytes)) as Record<string, unknown>;
  it('refuses a pack with a wrong header or a format newer than this OpenMTG reads', () => {
    expect(validatePack({ ...base(), format: 'something' })).toMatchObject({ fatal: expect.stringMatching(/not an OpenMTG rules pack/) });
    expect(validatePack({ ...base(), formatVersion: 2 })).toMatchObject({ fatal: expect.stringMatching(/not supported/) });
    expect(validatePack({ ...base(), minEngineVersion: '9.0.0' })).toMatchObject({ fatal: expect.stringMatching(/needs OpenMTG 9.0.0 or newer/) });
    expect(compareVersions('0.10.0', '0.9.1')).toBe(1);
  });
  it('"needs a newer OpenMTG" is per card (design 5.3, 12.5): a pack built at model N+1 installs on a model-N engine, uses the model-N entries and lists the others', () => {
    const p = base() as unknown as RulesPack;
    const boltId = fixture('Lightning Bolt').oracle_id!;
    const growth = fixture('Giant Growth');
    p.modelVersion = ABILITY_MODEL_VERSION + 1;
    p.cards[growth.oracle_id!] = { ...entryFor('Giant Growth'), modelVersion: ABILITY_MODEL_VERSION + 1, faces: [{ abilities: [{ kind: 'futureKind', src: [0] } as never] }] };
    const v = validatePack(JSON.parse(JSON.stringify(p)));
    if ('fatal' in v) throw new Error(v.fatal);
    expect(v.problems).toEqual([]);
    expect(v.newer).toEqual([growth.oracle_id]);
    const src = sourcesWith({ pack: v }, bareSources());
    expect(compileCardDetailed(fixture('Lightning Bolt'), src).def.automation).toMatchObject({ source: 'pack', level: 'full' });
    const g = compileCardDetailed(growth, src);
    expect(g.report.pack).toBe('model');
    expect(g.def.automation.source).not.toBe('pack');
    const app = packApplicability(v, byId(fixture('Lightning Bolt'), growth), bareSources());
    expect(app.matching).toBe(1);
    expect(app.needsNewer).toEqual([{ name: 'Giant Growth', missing: [`model:${ABILITY_MODEL_VERSION + 1}`] }]);
    expect(boltId).toBeDefined();
  });
  it('build-pack stamps minEngineVersion with the oldest reader of the format, not the builder\'s version; --min-engine-version raises it', () => {
    expect(build([entryFor('Lightning Bolt')]).pack.minEngineVersion).toBe(PACK_READER_VERSION);
    const r = buildPack({ llm: [entryFor('Lightning Bolt')], overrides: [], cardsById: byId(fixture('Lightning Bolt')), sources: bareSources(), packVersion: 'v', createdAt: NOW.toISOString(), minEngineVersion: '0.5.3' });
    expect(r.pack.minEngineVersion).toBe('0.5.3');
    expect(() => buildPack({ llm: [], overrides: [], cardsById: new Map(), sources: bareSources(), packVersion: 'v', createdAt: 'x', minEngineVersion: 'latest' })).toThrow(/version like/);
  });
  it('rejects single bad entries (display text, key mismatch, schema) and keeps the rest', () => {
    const p = base();
    const cards = p['cards'] as Record<string, Record<string, unknown>>;
    const good = Object.values(cards)[0]!;
    const withText = structuredClone(good);
    ((withText['faces'] as { abilities: Record<string, unknown>[] }[])[0]!.abilities[0]!)['text'] = 'Lightning Bolt deals 3 damage to any target.';
    const badSchema = structuredClone(good);
    (((badSchema['faces'] as { abilities: Record<string, unknown>[] }[])[0]!.abilities[0]!)['effect'] as { steps: Record<string, unknown>[] }).steps[0]!['op'] = 'obliterate';
    cards['11111111-1111-1111-1111-111111111111'] = { ...withText, oracleId: '11111111-1111-1111-1111-111111111111' };
    cards['22222222-2222-2222-2222-222222222222'] = { ...good };
    cards['33333333-3333-3333-3333-333333333333'] = { ...badSchema, oracleId: '33333333-3333-3333-3333-333333333333' };
    const v = validatePack(p);
    if ('fatal' in v) throw new Error(v.fatal);
    expect([...v.entries.keys()]).toEqual([fixture('Lightning Bolt').oracle_id]);
    expect(v.problems.map((x) => x.reason)).toEqual([expect.stringMatching(/display text/), expect.stringMatching(/key must equal/), expect.stringMatching(/schema/)]);
  });
  it('templates: examples must be stripped; installed templates are experimental; keywords limited to design 7.7', () => {
    const t: Template = { id: 'pack.test.draw', kind: 'effect', cr: ['CR 121.1'], pattern: 'draw a card.', build: { op: 'draw', who: { ref: 'you' }, count: 1 }, examples: [], counterExamples: [], status: 'stable', since: 1 };
    const v = validatePack({ ...base(), templates: [t, { ...t, id: 'pack.with.examples', examples: [{ text: 'Draw a card.' }] }], keywords: [
      { name: 'testkw', rule: 'CR 702.999', params: [], mechanisms: ['expands'], reminder: '', multiple: 'independent', status: 'implemented' },
      { name: 'hooky', rule: 'CR 702.998', params: [], mechanisms: ['hook'], reminder: '', multiple: 'independent', status: 'implemented' },
    ] });
    if ('fatal' in v) throw new Error(v.fatal);
    expect(v.templates.map((x) => [x.id, x.status, x.examples.length])).toEqual([['pack.test.draw', 'experimental', 0]]);
    expect(v.problems.map((p) => p.reason)).toEqual(expect.arrayContaining([expect.stringMatching(/must not carry examples/), expect.stringMatching(/mechanisms limited/)]));
    expect(v.keywords.map((k) => k.name)).toEqual(['testkw']);
  });
});

describe('integrity: install, tamper detection (updates.md "Integrity")', () => {
  it('installs a verified pack and refuses a tampered or truncated one', async () => {
    const r = build([entryFor('Lightning Bolt')]);
    const dir = await tempDir();
    const tampered = new Uint8Array(r.bytes);
    tampered[tampered.length - 5] = tampered[tampered.length - 5]! ^ 1;
    await expect(installPack(tampered, r.manifest, dir, 'test', NOW)).rejects.toThrow(/SHA-256 .* manifest says .* not installed/);
    expect(() => verifyAgainstManifest(r.bytes.slice(0, 10), r.manifest)).toThrow(/bytes; the manifest says/);
    expect(await loadInstalledPack(dir)).toBeNull();
    const ok = await installPack(r.bytes, r.manifest, dir, 'test', NOW);
    expect(ok.record).toMatchObject({ packVersion: '2026.10.12-1', verifiedBy: 'manifest', sha256: r.manifest.sha256 });
    const loaded = await loadInstalledPack(dir);
    expect([...loaded!.entries.keys()]).toEqual([fixture('Lightning Bolt').oracle_id]);
  });
  it('detects an installed pack that was changed afterwards', async () => {
    const r = build([entryFor('Lightning Bolt')]);
    const dir = await tempDir();
    await installPack(r.bytes, r.manifest, dir, 'test', NOW);
    const file = path.join(dir, PACK_FILE);
    await writeFile(file, (await readFile(file, 'utf8')).replace('"reviewed"', '"reviewed" '));
    await expect(loadInstalledPack(dir)).rejects.toThrow(PackError);
    expect(JSON.parse(await readFile(path.join(dir, INSTALLED_FILE), 'utf8'))).toMatchObject({ sha256: r.manifest.sha256 });
  });
  it('downloads the manifest, then the pack it names (relative URL), over HTTPS only', async () => {
    const r = build([entryFor('Lightning Bolt')]);
    const seen: string[] = [];
    const serve = (body: Uint8Array | string): Response => new Response(typeof body === 'string' ? body : new Blob([body]), { status: 200 });
    const fetchOk = (async (u: URL | string) => {
      const url = String(u);
      seen.push(url);
      if (url.endsWith('manifest.json')) return serve(JSON.stringify(r.manifest));
      return serve(r.bytes);
    }) as unknown as typeof fetch;
    const got = await downloadPack('https://example.test/packs/manifest.json', fetchOk);
    expect(got.packUrl).toBe(`https://example.test/packs/${PACK_FILE}`);
    expect(seen).toEqual(['https://example.test/packs/manifest.json', `https://example.test/packs/${PACK_FILE}`]);
    await expect(downloadPack('http://example.test/manifest.json', fetchOk)).rejects.toThrow(/https/);
    const fetchTampered = (async (u: URL | string) => (String(u).endsWith('manifest.json') ? serve(JSON.stringify(r.manifest)) : serve(new TextEncoder().encode(new TextDecoder().decode(r.bytes).replace('reviewed', 'reviewes'))))) as unknown as typeof fetch;
    await expect(downloadPack('https://example.test/packs/manifest.json', fetchTampered)).rejects.toThrow(/tampered/);
  });
  it('HTTPS on every hop: a redirect to http:// is refused for the manifest and for the pack; an https redirect is followed and its final URL used', async () => {
    const r = build([entryFor('Lightning Bolt')]);
    const seen: string[] = [];
    const redirect = (to: string): Response => new Response(null, { status: 302, headers: { location: to } });
    const via = (map: (url: string) => Response) => (async (u: URL | string, init?: RequestInit) => {
      seen.push(`${String(u)} ${init?.redirect ?? ''}`);
      return map(String(u));
    }) as unknown as typeof fetch;
    await expect(downloadPack('https://example.test/m.json', via(() => redirect('http://example.test/m.json')))).rejects.toThrow(/https/);
    const toPlainPack = via((u) => (u.endsWith('m.json') ? new Response(JSON.stringify({ ...r.manifest, file: 'pack.json' })) : redirect('http://example.test/pack.json')));
    await expect(downloadPack('https://example.test/m.json', toPlainPack)).rejects.toThrow(/https/);
    seen.length = 0;
    const moved = via((u) => (u === 'https://example.test/m.json' ? redirect('https://cdn.example.test/v2/m.json')
      : u.endsWith('m.json') ? new Response(JSON.stringify({ ...r.manifest, file: 'pack.json' })) : new Response(new Blob([r.bytes]))));
    const got = await downloadPack('https://example.test/m.json', moved);
    expect(got.packUrl).toBe('https://cdn.example.test/v2/pack.json');
    expect(seen.every((s) => s.endsWith(' manual'))).toBe(true);
  });
  it('size limits hold while reading: a body without Content-Length is cut off as soon as it passes the limit', async () => {
    let pulled = 0;
    const huge = (): Response => new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1024 * 1024;
        c.enqueue(new Uint8Array(1024 * 1024));
        if (pulled > 300 * 1024 * 1024) c.close();
      },
    }));
    await expect(downloadPack('https://example.test/m.json', (async () => huge()) as unknown as typeof fetch)).rejects.toThrow(/over the limit of 65536 bytes/);
    expect(pulled).toBeLessThan(4 * 1024 * 1024);
  });
});

describe('precedence and text hashes (updates.md "Precedence"; design 11.4)', () => {
  it('a pack entry applies only to the text it was made for; errata fall back to the parser', () => {
    const r = build([entryFor('Lightning Bolt')]);
    const v = validatePack(JSON.parse(new TextDecoder().decode(r.bytes)));
    if ('fatal' in v) throw new Error(v.fatal);
    const src = sourcesWith({ pack: v }, bareSources());
    const bolt = fixture('Lightning Bolt');
    expect(compileCardDetailed(bolt, src).def.automation).toMatchObject({ level: 'full', source: 'pack' });
    const errata = { ...bolt, oracle_text: 'Lightning Bolt deals 3 damage to any target. You gain 1 life.' };
    const e = compileCardDetailed(errata, src);
    expect(e.report.pack).toBe('hash');
    expect(e.def.automation.level).toBe('manual');
    const app = packApplicability(v, byId(errata), src);
    expect(app.textChanged).toEqual(['Lightning Bolt']);
  });
  it('design 12.5: on install each entry passes the exact render gate on the player\'s own text; a refused entry is reported, not counted as applying', () => {
    const r = build([entryFor('Lightning Bolt'), entryFor('Doom Blade')]);
    const p = JSON.parse(new TextDecoder().decode(r.bytes)) as RulesPack;
    const boltId = fixture('Lightning Bolt').oracle_id!;
    ((p.cards[boltId]!.faces[0]!.abilities[0] as Record<string, unknown>)['effect'] as { steps: Record<string, unknown>[] }).steps[0]!['amount'] = 4;
    const v = validatePack(p);
    if ('fatal' in v) throw new Error(v.fatal);
    expect(v.entries.size).toBe(2); // schema and lint pass: only the render gate on the card text can tell
    const app = packApplicability(v, byId(fixture('Lightning Bolt'), fixture('Doom Blade')), bareSources());
    expect(app.matching).toBe(1);
    expect(app.rejected).toEqual([{ name: 'Lightning Bolt', reason: expect.stringMatching(/^gate-mismatch/) }]);
  });
  it('pack entry > LLM cache: a pack entry and an LLM entry for the same card, the pack drives', () => {
    const r = build([entryFor('Lightning Bolt')]);
    const v = validatePack(JSON.parse(new TextDecoder().decode(r.bytes)));
    if ('fatal' in v) throw new Error(v.fatal);
    const llm = entryFor('Lightning Bolt');
    const src = sourcesWith({ pack: v, llm: new Map([[llm.oracleId, llm]]), trust: 'reviewed' }, bareSources());
    expect(compileCardDetailed(fixture('Lightning Bolt'), src).def.automation.source).toBe('pack');
  });
});
