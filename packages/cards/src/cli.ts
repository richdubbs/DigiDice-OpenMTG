/** OpenMTG card tool. Run: npm run cards -- <command>  (see `npm run cards -- help`). */
import { createInterface } from 'node:readline/promises';
import { main } from './commands';
import { decodeText } from './text';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return decodeText(Buffer.concat(chunks));
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

process.exitCode = await main(process.argv.slice(2), {
  out: (l) => console.log(l),
  err: (l) => console.error(l),
  readStdin,
  ...(process.stdin.isTTY ? { prompt } : {}),
});
