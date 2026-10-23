/**
 * Decode the bytes of a text file or stdin. Windows tools write more than plain UTF-8: PowerShell 5.1
 * `>` / Out-File and Notepad's "Unicode" option produce UTF-16 LE with a BOM. Detects a UTF-8, UTF-16 LE
 * or UTF-16 BE byte order mark (and BOM-less UTF-16 LE of mostly-ASCII text); everything else is UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16le').decode(swapBytes(b.subarray(2)));
  if (b.length >= 4 && b[0] !== 0 && b[1] === 0 && b[2] !== 0 && b[3] === 0) return new TextDecoder('utf-16le').decode(b); // no BOM, ASCII-range UTF-16 LE
  return new TextDecoder('utf-8').decode(b);
}

function swapBytes(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length - (b.length % 2));
  for (let i = 0; i + 1 < b.length; i += 2) {
    out[i] = b[i + 1]!;
    out[i + 1] = b[i]!;
  }
  return out;
}
