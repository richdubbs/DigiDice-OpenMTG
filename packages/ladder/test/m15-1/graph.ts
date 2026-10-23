/**
 * The import graph of the ladder's sources, read with the TypeScript parser (M15-1's tests: browser-safe, load, accounts). Every module a file
 * names (static imports and re-exports, import() and require() calls, import types and `declare module`), whether it is erased at run time
 * (`import type`, `export type`, only `type` names, or a type position), and where a relative one leads. test/m15-1/graph.test.ts pins the forms.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const PKG = fileURLToPath(new URL('../../', import.meta.url));
export const SRC = join(PKG, 'src');
export const API = join(SRC, 'api.ts');
export const LEAF = join(SRC, 'api', 'constants.ts');

export interface Edge {
  from: string;
  /** The module specifier as written. */
  spec: string;
  /** The file a relative specifier names; null for a package specifier. */
  to: string | null;
  /** Erased at run time. */
  typeOnly: boolean;
  /** The statement's first line, for messages. */
  text: string;
}

/** The path relative to src/, with forward slashes. */
export function rel(file: string): string {
  return relative(SRC, file).split('\\').join('/');
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The file a relative specifier names (bundler resolution: the .ts file before a directory's index.ts), or null. */
export function resolveRelative(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const p of [base.endsWith('.ts') ? base : `${base}.ts`, join(base, 'index.ts')]) if (isFile(p)) return p;
  return null;
}

/**
 * Every static import and re-export of a file, its dynamic import() and require() calls (never type-only), and the modules it names only in types:
 * import types (`import('x').T`, `typeof import('x')`) and `declare module 'x'` (always type-only).
 */
export function edges(file: string): Edge[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: Edge[] = [];
  const push = (spec: ts.Expression | undefined, typeOnly: boolean, node: ts.Node) => {
    if (spec === undefined || !ts.isStringLiteral(spec)) return;
    const relativeSpec = spec.text.startsWith('.');
    out.push({
      from: file,
      spec: spec.text,
      to: relativeSpec ? resolveRelative(file, spec.text) : null,
      typeOnly,
      text: node.getText(sf).split('\n')[0]!,
    });
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const c = st.importClause;
      const named = c?.namedBindings !== undefined && ts.isNamedImports(c.namedBindings) ? c.namedBindings.elements : null;
      const typeOnly = c !== undefined && (c.isTypeOnly || (c.name === undefined && named !== null && named.length > 0 && named.every((e) => e.isTypeOnly)));
      push(st.moduleSpecifier, typeOnly, st);
    } else if (ts.isExportDeclaration(st)) {
      const named = st.exportClause !== undefined && ts.isNamedExports(st.exportClause) ? st.exportClause.elements : null;
      push(st.moduleSpecifier, st.isTypeOnly || (named !== null && named.length > 0 && named.every((e) => e.isTypeOnly)), st);
    } else if (ts.isImportEqualsDeclaration(st) && ts.isExternalModuleReference(st.moduleReference)) {
      push(st.moduleReference.expression, st.isTypeOnly, st);
    }
  }
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.arguments.length > 0) {
      const callee = n.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) push(n.arguments[0], false, n);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      // an import type, `import('x').T` or `typeof import('x')`: no statement, but it reaches the module through the type system
      push(n.argument.literal, true, n);
    } else if (ts.isModuleDeclaration(n) && ts.isStringLiteral(n.name)) {
      // `declare module 'x' { ... }`: an ambient module or an augmentation of 'x'
      push(n.name, true, n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The files reachable from `start` through relative imports (type-only ones too), with their edges. */
export function graph(start: readonly string[]): Map<string, Edge[]> {
  const seen = new Map<string, Edge[]>();
  const todo = [...start];
  while (todo.length > 0) {
    const file = todo.pop()!;
    if (seen.has(file)) continue;
    const e = edges(file);
    seen.set(file, e);
    for (const x of e) if (x.to !== null) todo.push(x.to);
  }
  return seen;
}

/** Every .ts file under a directory, recursively. */
export function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

/** The api parts: src/api/*.ts. */
export function apiParts(): string[] {
  return readdirSync(join(SRC, 'api')).filter((f) => f.endsWith('.ts')).sort().map((f) => join(SRC, 'api', f));
}
