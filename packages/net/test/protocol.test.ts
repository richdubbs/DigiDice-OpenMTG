/** What the protocol lets through: text from the network, action preconditions, legal-action kinds, the engine build in the handshake, deck sizes. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as api from '../src/index';
import { checkDeckSubmission, parseGuestMessage, parseHostMessage, PROTOCOL_VERSION } from '../src/protocol/messages';
import { compareVersions, fingerprintDirectory, localVersions } from '../src/protocol/versions';
import { printable } from '../src/protocol/text';
import { deck } from './helpers';

const ESC = '\u001b';
const hostile = `${ESC}]0;pwned\u0007${ESC}[2JBob\u009b‮`;

describe('text from the network', () => {
  const hello = { v: PROTOCOL_VERSION, type: 'hello', versions: localVersions(null), name: hostile, deck: deck({ Forest: 1 }), proof: 'a'.repeat(64) };

  it('strips control characters (C0, C1, bidi overrides) from names, chat and reasons the guest sends', () => {
    const r = parseGuestMessage(hello);
    expect(r.ok).toBe(true);
    if (!r.ok || r.message.type !== 'hello') return;
    expect(r.message.name).toBe(']0;pwned[2JBob');
    const chat = parseGuestMessage({ v: PROTOCOL_VERSION, type: 'chat', text: `${ESC}]52;c;ZWNobw==\u0007hi` });
    expect(chat).toMatchObject({ ok: true, message: { text: ']52;c;ZWNobw==hi' } });
    const bye = parseGuestMessage({ v: PROTOCOL_VERSION, type: 'bye', reason: `${ESC}[2Jbye` });
    expect(bye).toMatchObject({ ok: true, message: { reason: '[2Jbye' } });
  });

  it('strips them from what the host sends too (names, chat, errors, warnings)', () => {
    expect(parseHostMessage({ v: PROTOCOL_VERSION, type: 'chat', text: `${ESC}[2Jhi` })).toMatchObject({ text: '[2Jhi' });
    const w = parseHostMessage({ v: PROTOCOL_VERSION, type: 'welcome', player: 'p2', session: 'a'.repeat(32), host: { id: 'p1', name: hostile }, format: 'casual', versions: localVersions(null), warnings: [`${ESC}[1mx`], resumed: false, lastAction: 0 });
    expect(w).toMatchObject({ host: { name: ']0;pwned[2JBob' }, warnings: ['[1mx'] });
    expect(parseHostMessage({ v: PROTOCOL_VERSION, type: 'error', code: 'badMessage', message: `${ESC}[2Jno`, details: [`${ESC}x`] })).toMatchObject({ message: '[2Jno', details: ['x'] });
  });

  it('printable() makes anything safe for a terminal', () => {
    expect(printable(hostile)).not.toMatch(/[\u0000-\u001f\u007f-\u009f‮]/);
  });

  it('refuses card names with control characters', () => {
    expect(checkDeckSubmission({ main: [{ name: `Forest${ESC}[2J`, count: 1 }], sideboard: [] })).toMatch(/malformed/);
  });
});

describe('deck submission limits', () => {
  it('counts copies, not entries: at most 250 cards in the deck and 15 in the sideboard, in every format', () => {
    expect(checkDeckSubmission(deck({ Mountain: 250 }))).toBeNull();
    expect(checkDeckSubmission({ main: [{ name: 'Mountain', count: 250 }, { name: 'Mountain', count: 1 }], sideboard: [] })).toMatch(/too many cards/);
    expect(checkDeckSubmission({ main: Array(300).fill({ name: 'Mountain', count: 250 }), sideboard: [] })).toMatch(/too/);
    expect(checkDeckSubmission(deck({ Mountain: 60 }, { Forest: 16 }))).toMatch(/sideboard/);
  });
});

describe('actions', () => {
  it('audit M5: the host\'s ack (an action that changed nothing) names the current seq and the action it answers', () => {
    expect(parseHostMessage({ v: PROTOCOL_VERSION, type: 'ack', seq: 4, ref: 2 })).toEqual({ v: PROTOCOL_VERSION, type: 'ack', seq: 4, ref: 2 });
    expect(parseHostMessage({ v: PROTOCOL_VERSION, type: 'ack', seq: 4 })).toBeNull();
    expect(parseHostMessage({ v: PROTOCOL_VERSION, type: 'ack', seq: -1, ref: 2 })).toBeNull();
  });

  it('an action names the view it was chosen from (seq)', () => {
    expect(parseGuestMessage({ v: PROTOCOL_VERSION, type: 'action', id: 1, seq: 3, action: { type: 'pass', player: 'p2' } }).ok).toBe(true);
    expect(parseGuestMessage({ v: PROTOCOL_VERSION, type: 'action', id: 1, action: { type: 'pass', player: 'p2' } }).ok).toBe(false);
  });

  it('a view\'s legal actions have the engine\'s LegalAction kinds', () => {
    const view = (kind: string) => ({ v: PROTOCOL_VERSION, type: 'view', seq: 1, view: {}, events: [], legal: [{ action: { type: 'pass', player: 'p2' }, kind, label: 'Pass', isMana: false }] });
    expect(parseHostMessage(view('pass'))).not.toBeNull();
    expect(parseHostMessage(view('teleport'))).toBeNull();
  });
});

describe('engine build in the handshake', () => {
  it('the engine build is a hash of the engine sources; a different build is refused even with the same compiler version', () => {
    const v = localVersions(null);
    expect(v.build).toMatch(/^[0-9a-f]{64}$/);
    expect(compareVersions(v, { ...v, build: '0'.repeat(64) }).fatal?.code).toBe('version');
    expect(compareVersions(v, v)).toEqual({ warnings: [] });
  });

  it('the fingerprint changes with any source change, and ignores line endings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'openmtg-fp-'));
    try {
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n');
      const one = fingerprintDirectory(dir);
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\r\n');
      expect(fingerprintDirectory(dir)).toBe(one);
      writeFileSync(join(dir, 'a.ts'), 'export const a = 2;\n');
      expect(fingerprintDirectory(dir)).not.toBe(one);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('public API', () => {
  it('does not export a deck validator of its own (milestone 7 owns format validation) or a renaming layer for hidden cards (the engine hides them, H1)', () => {
    expect('formatValidator' in api).toBe(false);
    expect('constructedValidator' in api).toBe(false);
    expect('GuestRedactor' in api).toBe(false);
  });
});
