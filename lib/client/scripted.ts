// Development only (?scripted=1 with NODE_ENV=development): a fake model, the SDK's
// ScriptedProvider, that builds the starship page through the real UI without auth
// or the gateway. Each turn looks at the history, so a provider created after a
// reload carries on where the journal stopped.
import { ScriptedProvider, type Provider, type ProviderRequest } from "tiny-agent-sdk/browser";
import { PUBLISH_DESIGN } from "../tools.ts";

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});

/** Whether this run (everything after the latest prompt) has published already. */
function published(request: ProviderRequest): boolean {
  const start = request.history.findLastIndex((item) => item.role === "user");
  return request.history.slice(start + 1).some((item) => item.role === "tool_result" && item.toolName === PUBLISH_DESIGN && !item.isError);
}

export function scriptedProvider(delayMs = 1500): Provider {
  const turn = async (request: ProviderRequest) => {
    await sleep(delayMs, request.signal);
    if (published(request)) {
      return {
        text: "The Radian starship hangs over a slowly turning Earth. Drag it anywhere and let go: a spring pulls it back to its orbit slot. Next, I could add a docking station or a night side with city lights.",
        deltas: ["The Radian starship hangs over a slowly turning Earth. ", "Drag it anywhere and let go: a spring pulls it back to its orbit slot. ", "Next, I could add a docking station or a night side with city lights."],
      };
    }
    return {
      text: "Building a Radian starship over a turning Earth, with spring physics on drag.",
      deltas: ["Building a Radian starship ", "over a turning Earth, ", "with spring physics on drag."],
      toolCalls: [{ callId: `call_starship_${request.history.length}`, name: PUBLISH_DESIGN, arguments: { title: "Radian starship over Earth", html: STARSHIP } }],
    };
  };
  // More turns than any run needs; each decides from the history what to answer.
  return new ScriptedProvider(Array.from({ length: 64 }, () => turn));
}

export const STARSHIP = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Radian starship</title>
<style>
  :root { --ink: #f4f4f2; --dim: #8a8f98; --line: rgba(255,255,255,.14); }
  * { box-sizing: border-box; margin: 0; }
  html, body { height: 100%; background: #04060b; color: var(--ink); overflow: hidden;
    font: 14px/1.5 ui-monospace, "SF Mono", Menlo, monospace; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: grab; }
  canvas.dragging { cursor: grabbing; }
  header { position: fixed; left: clamp(20px, 4vw, 48px); top: clamp(20px, 4vw, 44px); pointer-events: none; }
  .kicker { color: var(--dim); letter-spacing: .18em; text-transform: uppercase; font-size: 11px; }
  h1 { font: 600 clamp(28px, 5vw, 64px)/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.035em; margin-top: 10px; }
  h1 span { color: var(--dim); font-weight: 400; }
  footer { position: fixed; left: clamp(20px, 4vw, 48px); right: clamp(20px, 4vw, 48px); bottom: clamp(18px, 3vw, 36px);
    display: flex; justify-content: space-between; gap: 16px; color: var(--dim); font-size: 12px; pointer-events: none; }
  .readout { display: grid; grid-template-columns: auto auto; gap: 2px 14px; }
  .readout b { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
  @media (max-width: 560px) { footer { flex-direction: column; } }
</style>
</head>
<body>
<canvas id="sky" aria-label="A starship above Earth. Drag it; it springs back."></canvas>
<header>
  <div class="kicker">Radian · orbital class</div>
  <h1>RSV Meridian <span>over Earth</span></h1>
</header>
<footer>
  <div>Drag the ship. Let go. The spring brings it home.</div>
  <div class="readout"><span>offset</span><b id="offset">0 m</b><span>velocity</span><b id="speed">0 m/s</b></div>
</footer>
<script>
(() => {
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d");
  const offsetOut = document.getElementById("offset");
  const speedOut = document.getElementById("speed");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0, h = 0, dpr = 1, stars = [];

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    stars = Array.from({ length: Math.round(w * h / 2600) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + .2, t: Math.random() * 6.28 }));
  }
  addEventListener("resize", resize);
  resize();

  const home = () => ({ x: w * .56, y: h * .38 });
  const ship = { x: home().x, y: home().y, vx: 0, vy: 0, angle: 0 };
  const STIFFNESS = 90, DAMPING = 9;
  let drag = null;

  canvas.addEventListener("pointerdown", (e) => {
    if (Math.hypot(e.clientX - ship.x, e.clientY - ship.y) > 90) return;
    drag = { dx: ship.x - e.clientX, dy: ship.y - e.clientY, lastX: e.clientX, lastY: e.clientY, lastT: performance.now() };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const now = performance.now(), dt = Math.max(1, now - drag.lastT) / 1000;
    ship.vx = (e.clientX - drag.lastX) / dt; ship.vy = (e.clientY - drag.lastY) / dt;
    ship.x = e.clientX + drag.dx; ship.y = e.clientY + drag.dy;
    drag.lastX = e.clientX; drag.lastY = e.clientY; drag.lastT = now;
  });
  const release = () => { drag = null; canvas.classList.remove("dragging"); };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  function earth(t) {
    const r = Math.max(w, h) * .62, cx = w * .5, cy = h + r * .58;
    const glow = ctx.createRadialGradient(cx, cy, r * .96, cx, cy, r * 1.14);
    glow.addColorStop(0, "rgba(120,170,255,.35)"); glow.addColorStop(1, "rgba(120,170,255,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, r * 1.14, 0, 6.29); ctx.fill();
    const body = ctx.createRadialGradient(cx - r * .3, cy - r * .5, r * .1, cx, cy, r);
    body.addColorStop(0, "#2f6fb8"); body.addColorStop(.55, "#123c6e"); body.addColorStop(1, "#06152b");
    ctx.fillStyle = body; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.29); ctx.clip();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * 6.28 + t * .02, x = cx + Math.cos(a) * r * .72, y = cy - r * .62 + Math.sin(a * 2) * r * .08;
      ctx.fillStyle = "rgba(70,130,80,.5)"; ctx.beginPath(); ctx.ellipse(x, y, r * .07, r * .022, a * .3, 0, 6.29); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.beginPath(); ctx.ellipse(x + r * .05, y - r * .015, r * .09, r * .008, 0, 0, 6.29); ctx.fill();
    }
    ctx.restore();
  }

  function drawShip(t) {
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
    const flame = 18 + Math.sin(t * 22) * 4 + Math.min(40, Math.hypot(ship.vx, ship.vy) / 30);
    const fire = ctx.createLinearGradient(-60, 0, -60 - flame, 0);
    fire.addColorStop(0, "rgba(255,240,200,.95)"); fire.addColorStop(1, "rgba(120,170,255,0)");
    ctx.fillStyle = fire; ctx.beginPath(); ctx.moveTo(-58, -7); ctx.lineTo(-60 - flame, 0); ctx.lineTo(-58, 7); ctx.fill();
    const hull = ctx.createLinearGradient(0, -22, 0, 22);
    hull.addColorStop(0, "#f3f4f6"); hull.addColorStop(.55, "#b8bcc6"); hull.addColorStop(1, "#5d626e");
    ctx.fillStyle = hull;
    ctx.beginPath(); ctx.moveTo(72, 0); ctx.quadraticCurveTo(30, -20, -58, -14); ctx.lineTo(-58, 14); ctx.quadraticCurveTo(30, 20, 72, 0); ctx.fill();
    ctx.fillStyle = "#9aa0ab";
    ctx.beginPath(); ctx.moveTo(-10, -14); ctx.lineTo(-44, -44); ctx.lineTo(-56, -44); ctx.lineTo(-40, -12); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-10, 14); ctx.lineTo(-44, 44); ctx.lineTo(-56, 44); ctx.lineTo(-40, 12); ctx.fill();
    ctx.fillStyle = "#0b0f18"; ctx.beginPath(); ctx.ellipse(34, -4, 13, 5, -.08, 0, 6.29); ctx.fill();
    ctx.fillStyle = "rgba(160,200,255,.7)"; ctx.fillRect(-30, -2, 44, 1.5);
    ctx.fillStyle = "#04060b"; ctx.font = "600 8px ui-monospace, monospace"; ctx.fillText("RADIAN", -22, 9);
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.033, (now - last) / 1000); last = now;
    const t = now / 1000;
    if (!drag) {
      const target = home();
      const bob = reduce ? 0 : Math.sin(t * .8) * 8;
      const ax = -STIFFNESS * (ship.x - target.x) - DAMPING * ship.vx;
      const ay = -STIFFNESS * (ship.y - target.y - bob) - DAMPING * ship.vy;
      ship.vx += ax * dt; ship.vy += ay * dt;
      ship.x += ship.vx * dt; ship.y += ship.vy * dt;
    }
    const tilt = Math.max(-.5, Math.min(.5, ship.vy / 900));
    ship.angle += (tilt - ship.angle) * Math.min(1, dt * 8);

    ctx.fillStyle = "#04060b"; ctx.fillRect(0, 0, w, h);
    for (const s of stars) {
      ctx.globalAlpha = reduce ? .7 : .45 + Math.sin(t * 1.5 + s.t) * .35;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.29); ctx.fill();
    }
    ctx.globalAlpha = 1;
    earth(t);
    const target = home();
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.setLineDash([3, 6]);
    ctx.beginPath(); ctx.moveTo(target.x, target.y); ctx.lineTo(ship.x, ship.y); ctx.stroke(); ctx.setLineDash([]);
    drawShip(t);

    const offset = Math.hypot(ship.x - target.x, ship.y - target.y);
    offsetOut.textContent = Math.round(offset * 12) + " m";
    speedOut.textContent = Math.round(Math.hypot(ship.vx, ship.vy) * 12) + " m/s";
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>`;
