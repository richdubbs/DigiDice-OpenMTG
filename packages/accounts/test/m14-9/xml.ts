/**
 * A strict XML reader for the avatar test (test/m14-9): Node has no XML parser, and accounts takes no dependency. It reads well-formed XML 1.0 made of
 * elements, attributes, character data and comments, and refuses anything else with an `XmlError` that says where: an unclosed, unopened or
 * mismatched tag, an attribute without a quoted value or given twice, an `&` that is not one of the five named or a numeric reference, a `<` in an
 * attribute value, `]]>` in text, a character XML does not allow, anything but comments and white space around the root, and (nothing an avatar
 * needs, so kept out) a document type, processing instructions other than the XML declaration, and CDATA sections. Names are the ASCII subset of
 * XML's (letters, digits, `_`, `-`, `.`, one `:` for a prefix).
 */
export interface XmlElement {
  name: string;
  attrs: ReadonlyMap<string, string>;
  children: XmlNode[];
}
export type XmlNode = XmlElement | { text: string } | { comment: string };

export class XmlError extends Error {}

const NAME = /[A-Za-z_][A-Za-z0-9._-]*(?::[A-Za-z_][A-Za-z0-9._-]*)?/y;
const SPACE = /[ \t\r\n]*/y;
const REF = /&(?:(amp|lt|gt|quot|apos)|#([0-9]+)|#x([0-9A-Fa-f]+));/y;
const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/** C0 controls but tab, CR and LF; U+FFFE and U+FFFF; surrogates that are not in a pair. */
const BAD_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function parseXml(src: string): XmlElement {
  let i = 0;
  const fail = (what: string): never => {
    throw new XmlError(`${what} at offset ${i}`);
  };
  const bad = BAD_CHAR.exec(src);
  if (bad) {
    i = bad.index;
    fail('a character XML does not allow');
  }
  const space = (): void => {
    SPACE.lastIndex = i;
    SPACE.exec(src);
    i = SPACE.lastIndex;
  };
  const name = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(src);
    if (!m) return fail('a name expected');
    i = NAME.lastIndex;
    return m[0];
  };
  const decode = (raw: string, at: number): string => {
    let out = '';
    let j = 0;
    for (;;) {
      const k = raw.indexOf('&', j);
      if (k < 0) return out + raw.slice(j);
      REF.lastIndex = k;
      const m = REF.exec(raw);
      if (!m) {
        i = at + k;
        return fail("an '&' that starts no reference");
      }
      let ch: string;
      if (m[1] !== undefined) ch = NAMED[m[1]]!;
      else {
        const code = parseInt(m[2] ?? m[3]!, m[2] !== undefined ? 10 : 16);
        if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || BAD_CHAR.test(String.fromCodePoint(code))) {
          i = at + k;
          return fail('a reference to a character XML does not allow');
        }
        ch = String.fromCodePoint(code);
      }
      out += raw.slice(j, k) + ch;
      j = REF.lastIndex;
    }
  };
  const comment = (): string => {
    const end = src.indexOf('-->', i + 4);
    if (end < 0) return fail('an unclosed comment');
    const body = src.slice(i + 4, end);
    if (body.includes('--') || body.endsWith('-')) fail("'--' inside a comment");
    i = end + 3;
    return body;
  };
  /** White space and comments outside the root; anything else markup-like is refused. */
  const misc = (): void => {
    for (;;) {
      space();
      if (src.startsWith('<!--', i)) comment();
      else if (src.startsWith('<!DOCTYPE', i) || src.startsWith('<!doctype', i)) fail('a document type');
      else if (src.startsWith('<?', i)) fail('a processing instruction');
      else return;
    }
  };
  const element = (): XmlElement => {
    i++; // '<'
    const tag = name();
    const attrs = new Map<string, string>();
    for (;;) {
      const before = i;
      space();
      if (src.startsWith('/>', i)) {
        i += 2;
        return { name: tag, attrs, children: [] };
      }
      if (src[i] === '>') {
        i++;
        break;
      }
      if (i === before) fail(`white space expected in <${tag}>`);
      const key = name();
      space();
      if (src[i] !== '=') fail(`'=' expected after ${key}`);
      i++;
      space();
      const quote = src[i];
      if (quote !== '"' && quote !== "'") fail(`a quoted value expected for ${key}`);
      const end = src.indexOf(quote!, i + 1);
      if (end < 0) fail(`an unclosed value of ${key}`);
      const raw = src.slice(i + 1, end);
      if (raw.includes('<')) fail(`'<' in the value of ${key}`);
      if (attrs.has(key)) fail(`${key} given twice`);
      attrs.set(key, decode(raw, i + 1));
      i = end + 1;
    }
    const children: XmlNode[] = [];
    for (;;) {
      if (i >= src.length) fail(`</${tag}> expected`);
      if (src.startsWith('</', i)) {
        i += 2;
        const close = name();
        space();
        if (src[i] !== '>') fail(`'>' expected after </${close}`);
        if (close !== tag) fail(`</${close}> closing <${tag}>`);
        i++;
        return { name: tag, attrs, children };
      }
      if (src.startsWith('<!--', i)) children.push({ comment: comment() });
      else if (src.startsWith('<![CDATA[', i)) fail('a CDATA section');
      else if (src.startsWith('<!', i)) fail('a declaration');
      else if (src.startsWith('<?', i)) fail('a processing instruction');
      else if (src[i] === '<') children.push(element());
      else {
        const next = src.indexOf('<', i);
        const end = next < 0 ? src.length : next;
        const raw = src.slice(i, end);
        if (raw.includes(']]>')) fail("']]>' in text");
        children.push({ text: decode(raw, i) });
        i = end;
      }
    }
  };

  if (src.startsWith('<?xml ')) {
    const end = src.indexOf('?>');
    if (end < 0) fail('an unclosed XML declaration');
    i = end + 2;
  }
  misc();
  if (src[i] !== '<') fail('the root element expected');
  const root = element();
  misc();
  if (i < src.length) fail('content after the root element');
  return root;
}

/** Every element of a tree, the root first. */
export function elements(root: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (e: XmlElement): void => {
    out.push(e);
    for (const c of e.children) if ('name' in c) walk(c);
  };
  walk(root);
  return out;
}
