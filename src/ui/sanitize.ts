import DOMPurify from 'dompurify';

const highlightCache = new Map<string, string>();

/** GitHub's syntax-highlighted line HTML: keep only spans with classes. Cached — lines repeat across renders. */
export function cleanHighlight(html: string): string {
  let clean = highlightCache.get(html);
  if (clean === undefined) {
    clean = DOMPurify.sanitize(html, { ALLOWED_TAGS: ['span'], ALLOWED_ATTR: ['class'] });
    if (highlightCache.size > 50_000) highlightCache.clear();
    highlightCache.set(html, clean);
  }
  return clean;
}

/** Rendered markdown from an untrusted PR: scripts, handlers, forms, iframes and styles are stripped. */
export function cleanMarkdown(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}
