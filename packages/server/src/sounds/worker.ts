/**
 * A sound render thread (pool.ts): renders `{ job, id, variant }` with the catalog's recipe (@openmtg/play/audio/render `renderStereo`, at RENDER_RATE)
 * and answers with the WAV file's bytes (transferred, not copied), or why it could not. One job at a time, in the order asked.
 */
import { parentPort } from 'node:worker_threads';
import { SOUND_IDS, type SoundId } from '@openmtg/play/audio/catalog';
import { RENDER_RATE, renderStereo } from '@openmtg/play/audio/render';
import { wavBytes } from '@openmtg/play/audio/wav';
import type { RenderJob, RenderJobReply } from './pool';

const port = parentPort!;
port.on('message', (job: RenderJob) => {
  let reply: RenderJobReply;
  let transfer: ArrayBuffer[] = [];
  try {
    if (!(SOUND_IDS as string[]).includes(job.id)) throw new Error(`No sound ${job.id}`);
    const bytes = wavBytes(renderStereo(job.id as SoundId, job.variant), RENDER_RATE);
    reply = { job: job.job, ok: true, wav: bytes.buffer as ArrayBuffer };
    transfer = [bytes.buffer as ArrayBuffer];
  } catch (e) {
    reply = { job: job.job, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  port.postMessage(reply, transfer);
});
