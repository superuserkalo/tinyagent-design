// After a publish, run the scene for a few seconds in a hidden frame and collect what it
// throws: WGSL compile errors, vgpu binding errors, exceptions. The agent gets them back
// as the tool's result and fixes the scene. The frame is the same sandboxed /preview-frame
// the preview uses, so the check sees exactly what a visitor would.

/** How long a scene runs before it counts as working. Shaders compile on the first frames. */
const RUN_MS = 3000;
/** Longest wait for the frame to load before the check gives up. */
const LOAD_MS = 8000;

export type SceneCheck =
  | { ran: true; errors: string[] }
  | { ran: false; reason: string };

export function checkScene(html: string, signal?: AbortSignal): Promise<SceneCheck> {
  if (typeof navigator === "undefined" || !("gpu" in navigator))
    return Promise.resolve({ ran: false, reason: "this browser has no WebGPU" });
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = "/preview-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // In the viewport (browsers pause hidden and offscreen frames) but invisible and inert.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:480px;height:320px;opacity:0;pointer-events:none;border:0;z-index:-1";
    const errors: string[] = [];
    let timer = setTimeout(() => finish({ ran: false, reason: "the scene did not load" }), LOAD_MS);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      if (event.data?.type === "tinyagent-design-ready") {
        frame.contentWindow!.postMessage({ type: "tinyagent-design", html }, "*");
        clearTimeout(timer);
        timer = setTimeout(() => finish({ ran: true, errors }), RUN_MS);
      } else if (event.data?.type === "tinyagent-design-error" && typeof event.data.message === "string") {
        if (!errors.includes(event.data.message)) errors.push(event.data.message);
      }
    };
    const onAbort = () => finish({ ran: false, reason: "cancelled" });
    function finish(result: SceneCheck) {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      frame.remove();
      resolve(result);
    }
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    document.body.append(frame);
  });
}
