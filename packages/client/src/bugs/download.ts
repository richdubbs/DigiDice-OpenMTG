/**
 * RPL-4: saving a bug report as a file on this machine, through a temporary link, as the replay library exports a replay (replays/ReplaysScreen.tsx).
 * Nothing is sent anywhere: the player keeps the file and chooses whom to give it to (owner rule: no upload, no telemetry).
 */

/** Save `bytes` as `fileName`. False when this browser cannot save files. */
export function saveBytes(fileName: string, bytes: Uint8Array, type = 'application/gzip'): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Its click is not the player's (audio/uiSounds.ts).
  a.dataset.sfx = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
