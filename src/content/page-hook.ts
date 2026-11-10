// Runs in GitHub's own page world. Only purpose: notice when the user marks a file
// "Viewed" in GitHub's native view, so Mosaic can measure the user's GitHub-native pace.
// It forwards the file path and nothing else.
//
// This script is injected into every github.com page before anything else runs, so it stays
// dependency-free: the request body is checked by hand here, and the message it posts is validated
// with its schema (fileReviewMessageSchema) by the content script that receives it.
import type { FileReviewMessage } from '../shared/messages.ts';

(() => {
  const FILE_REVIEW_PATH = /\/pull\/\d+\/file_review(?:\?|$)/;
  const originalFetch = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      if (FILE_REVIEW_PATH.test(new URL(url, location.href).pathname) && typeof init?.body === 'string') {
        const body: unknown = JSON.parse(init.body);
        if (body && typeof body === 'object' && 'path' in body && typeof body.path === 'string') {
          const isDelete = '_method' in body && body._method === 'delete';
          const message: FileReviewMessage = {
            source: 'mosaic-hook',
            type: 'file_review',
            path: body.path,
            viewed: method === 'POST' && !isDelete,
          };
          window.postMessage(message, location.origin);
        }
      }
    } catch {
      /* never interfere with GitHub */
    }
    return originalFetch.apply(this, [input, init] as [RequestInfo | URL, RequestInit | undefined]);
  } as typeof fetch;
})();
