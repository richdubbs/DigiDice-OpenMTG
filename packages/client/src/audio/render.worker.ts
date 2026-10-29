/**
 * The render worker (Review 2026-10-26, Finding 21): synthesizes sounds off the page's thread. It gets `{ job, id, variant }` (render.ts
 * `RenderRequest`), renders that variant (render.ts `renderStereo`, the recipe and its mastering) and answers with the two channels, transferred
 * rather than copied. Requests are answered one at a time, in the order they came; the page (engine.ts) sends the next when the last is back.
 */
import { answerRender, type RenderReply, type RenderRequest } from './render';

/** The worker's global scope, typed by the two members used here (the client compiles with the DOM's types, not the worker's). */
const scope = globalThis as unknown as {
  onmessage: ((e: { data: RenderRequest }) => void) | null;
  postMessage(message: RenderReply, transfer: ArrayBuffer[]): void;
};

scope.onmessage = (e) => {
  const { reply, transfer } = answerRender(e.data);
  scope.postMessage(reply, transfer);
};
