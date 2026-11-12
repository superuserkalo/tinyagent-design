// The document each design runs in. The app loads it in <iframe sandbox="allow-scripts">
// (no allow-same-origin), so it has an opaque origin: it cannot read this site's
// cookies, IndexedDB or DOM. It asks its parent for the HTML once, writes it, and from
// then on is the design. Its own CSP replaces the app's: inline scripts and styles
// run, nothing loads from the network except Google Fonts.
// Ahead of the design's own scripts it puts vgpu (WebGPU, the global `vgpu`) and an error
// reporter that posts uncaught errors, with any WGSL compiler messages, to the parent, which
// hands them to the agent after a publish.
import { VGPU_SCRIPT } from "@/lib/vgpu-bundle";

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

/** Runs first inside the design. ES5, no dependencies. */
const REPORTER = `(function () {
  var sent = 0;
  function send(text) {
    if (sent++ >= 12) return;
    try { parent.postMessage({ type: "tinyagent-design-error", message: String(text).slice(0, 1500) }, "*"); } catch (e) {}
  }
  function describe(x) {
    if (!x) return "Unknown error";
    var text = (x.code ? x.code + ": " : "") + (x.message || String(x));
    if (x.where) text += " (at " + x.where + ")";
    if (x.cause && x.cause.message) text += "\\n" + x.cause.message;
    return text;
  }
  addEventListener("error", function (event) { send(describe(event.error || { message: event.message })); });
  addEventListener("unhandledrejection", function (event) { send(describe(event.reason)); });
  var original = console.error;
  console.error = function () {
    send(Array.prototype.map.call(arguments, function (a) { return a && a.message ? describe(a) : String(a); }).join(" "));
    return original.apply(console, arguments);
  };
})();`;

/** The scripts that go ahead of the design's, as one string the shell splices in. */
const PRELUDE = `<script>${VGPU_SCRIPT}</script><script>${REPORTER}</script>`;

// JSON keeps the prelude a plain string inside the shell's script; "</" is escaped so no
// "</script" ends that script early.
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;background:#fff}@media (prefers-color-scheme:dark){html,body{background:#0a0a0a}}</style></head><body><script>
(function () {
  var PRELUDE = ${JSON.stringify(PRELUDE).replace(/<\//g, "<\\/")};
  var done = false;
  addEventListener("message", function (event) {
    if (done || event.source !== parent || !event.data || event.data.type !== "tinyagent-design" || typeof event.data.html !== "string") return;
    done = true;
    var html = event.data.html;
    var head = /<head[^>]*>/i.exec(html);
    html = head ? html.slice(0, head.index + head[0].length) + PRELUDE + html.slice(head.index + head[0].length) : PRELUDE + html;
    document.open();
    document.write(html);
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
