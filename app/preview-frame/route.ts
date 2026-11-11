// The document each design runs in. The app loads it in <iframe sandbox="allow-scripts">
// (no allow-same-origin), so it has an opaque origin: it cannot read this site's
// cookies, IndexedDB or DOM. It asks its parent for the HTML once, writes it, and from
// then on is the design. Its own CSP replaces the app's: inline scripts and styles
// run, nothing loads from the network except Google Fonts.
export const dynamic = "force-static";

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

const SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:#fff}@media (prefers-color-scheme:dark){html,body{background:#0a0a0a}}</style></head><body><script>
(function () {
  var done = false;
  addEventListener("message", function (event) {
    if (done || event.source !== parent || !event.data || event.data.type !== "tinyagent-design" || typeof event.data.html !== "string") return;
    done = true;
    document.open();
    document.write(event.data.html);
    document.close();
  });
  parent.postMessage({ type: "tinyagent-design-ready" }, "*");
})();
</script></body></html>`;

export function GET(): Response {
  return new Response(SHELL, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": CSP,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
