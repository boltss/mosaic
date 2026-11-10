// Serves dist-dev/ for the harness: http://localhost:5173/harness.html
const root = new URL('../dist-dev/', import.meta.url).pathname;
const server = Bun.serve({
  port: Number(process.env.PORT ?? 5173),
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/$/, '/harness.html');
    const file = Bun.file(root + path.slice(1));
    return (await file.exists()) ? new Response(file) : new Response('not found', { status: 404 });
  },
});
console.log(`harness: http://localhost:${server.port}/harness.html`);
