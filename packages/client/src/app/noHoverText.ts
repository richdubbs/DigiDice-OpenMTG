/**
 * No hover text boxes (owner, 2026-10-25: "it makes it feel like a website and not a video game"). The browser draws a box for every `title` attribute
 * when the pointer rests on it: the card pictures, the counters, the phase bar, the deck tools. The components keep their titles (tests read them as
 * before); this watcher takes each one off the page as soon as it is set, on every screen. An element whose only name was its title (an icon with no
 * text and no label) keeps it as `aria-label`, so screen readers still name it.
 */
export function installNoHoverText(doc: Document): () => void {
  const strip = (el: Element): void => {
    const text = el.getAttribute('title');
    if (text === null) return;
    el.removeAttribute('title');
    const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || (el.textContent ?? '').trim() !== '';
    if (text !== '' && !named) el.setAttribute('aria-label', text);
  };
  const sweep = (node: Node): void => {
    if (!(node instanceof Element)) return;
    strip(node);
    for (const el of node.querySelectorAll('[title]')) strip(el);
  };
  sweep(doc.documentElement);
  const watcher = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') strip(r.target as Element);
      else r.addedNodes.forEach(sweep);
    }
  });
  watcher.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  return () => watcher.disconnect();
}
