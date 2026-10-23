/**
 * Generates packages/engine/src/model/schema.generated.json from packages/engine/src/types/ability.ts (design 11.3, D29).
 *
 *   npm run gen:schema              # write the file
 *   npm run gen:schema -- --check   # exit 1 if the checked-in file differs (the drift test does the same in-process)
 *
 * The output is deterministic (sorted properties, two-space JSON, trailing newline). The validator in
 * packages/engine/src/model/validate.ts reads the file; `ts-json-schema-generator` is a root dev dependency only.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGenerator } from 'ts-json-schema-generator';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const engine = join(root, 'packages', 'engine');
export const SCHEMA_PATH = join(engine, 'src', 'model', 'schema.generated.json');

/** The schema text exactly as it must be checked in. */
export function generateSchemaText(): string {
  const generator = createGenerator({
    path: join(engine, 'src', 'types', 'ability.ts'),
    tsconfig: join(engine, 'tsconfig.json'),
    type: 'AbilityDef',
    expose: 'export',
    topRef: true,
    jsDoc: 'none',
    additionalProperties: false,
    skipTypeCheck: false,
    sortProps: true,
  });
  const schema = generator.createSchema('AbilityDef');
  return `${JSON.stringify(schema, null, 2)}\n`;
}

if (process.argv[1]?.endsWith('gen-ability-schema.ts')) {
  const text = generateSchemaText();
  if (process.argv.includes('--check')) {
    // a Windows checkout with core.autocrlf turns the file's line feeds into CRLF: compare the content, not the line endings
    const current = readFileSync(SCHEMA_PATH, 'utf8').replaceAll('\r\n', '\n');
    if (current !== text) {
      console.error('model/schema.generated.json is stale: run `npm run gen:schema`.');
      process.exit(1);
    }
    console.log('model/schema.generated.json is up to date.');
  } else {
    writeFileSync(SCHEMA_PATH, text);
    console.log(`wrote ${SCHEMA_PATH} (${text.length} bytes)`);
  }
}
