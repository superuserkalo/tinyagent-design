// The agent's one tool. It runs in the browser: the handler saves the scene, the preview
// shows it, and a test run's errors (if any) go back to the model so it can fix them.
import { Tool, ToolError } from "tiny-agent-sdk/browser";

export const PUBLISH_DESIGN = "publish_design";

/** Every tool name the model route lets through to the gateway. */
export const TOOL_NAMES = [PUBLISH_DESIGN] as const;

/** Big enough for a rich single page, small enough to keep each chat's journal light. */
export const MAX_DESIGN_BYTES = 200_000;

export interface PublishedDesign {
  /** The SDK's executionId for this call: the same after a reload, so a rerun overwrites instead of duplicating. */
  executionId: string;
  title: string;
  html: string;
}

/** What a short test run of a published scene found. */
export type RunReport =
  | { ran: true; errors: string[]; shot: { image: string | null; spread: number | null } | null }
  | { ran: false; reason: string };

/** Below this spread of brightness (0 to 255) a picture is one flat colour: nothing is drawn. */
const BLANK_SPREAD = 2;

export function publishDesignTool(
  save: (design: PublishedDesign, signal: AbortSignal) => Promise<number>,
  run?: (html: string, signal: AbortSignal) => Promise<RunReport>,
): Tool {
  return new Tool({
    name: PUBLISH_DESIGN,
    description:
      "Publish the complete design as one self-contained HTML document. The preview shows it at once. " +
      "Call it with the whole page every time, including for small changes: it replaces the previous version.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 80, description: "A short name for the page, 2 to 6 words." },
        html: {
          type: "string",
          minLength: 1,
          description: "The full document, from <!doctype html> to </html>, with all CSS and JavaScript inline.",
        },
      },
      required: ["title", "html"],
      additionalProperties: false,
    },
    // Safe to repeat: the design is stored under the call's executionId, so running it
    // again after an interrupted run writes the same row.
    idempotent: true,
    timeoutSeconds: 45,
    handler: async ({ title, html }, signal, { executionId }) => {
      const page = String(html).trim();
      const name = String(title).trim();
      if (!/^<!doctype html>/i.test(page) || !/<\/html>\s*$/i.test(page))
        throw new ToolError("The document must start with <!doctype html> and end with </html>. Send the complete page.");
      if (new TextEncoder().encode(page).length > MAX_DESIGN_BYTES)
        throw new ToolError(`The document is over ${MAX_DESIGN_BYTES / 1000} KB. Make it more compact and publish again.`);
      const version = await save({ executionId, title: name, html: page }, signal);
      const published = `Published version ${version}: ${name}. The preview is showing it.`;
      if (!run) return published;
      const report = await run(page, signal);
      if (!report.ran) return `${published} It could not be test-run here (${report.reason}).`;
      if (report.errors.length)
        return `${published} But it failed when it ran:\n${report.errors.map((error, index) => `${index + 1}. ${error}`).join("\n")}\n` +
          "Fix exactly these problems and publish the complete document again.";
      const shot = report.shot;
      if (!shot?.image) return `${published} It ran for 3 seconds without errors (no screenshot was available).`;
      const blank = shot.spread !== null && shot.spread < BLANK_SPREAD;
      const words = blank
        ? `${published} It ran without errors, but the canvas is one flat colour after 3 seconds: nothing visible is drawn. ` +
          "Find why (camera, scale, positions, depth, blending, alpha) and publish again."
        : `${published} It ran for 3 seconds without errors. This is the canvas at that moment. ` +
          "Judge it as a visitor would: is the hero clearly visible and filling the frame, is it lit and coloured as intended, " +
          "does it look like the scene you meant? If not, fix what is wrong and publish again; if it does, reply to the user.";
      const [, data] = shot.image.split(",", 2);
      return [{ type: "text", text: words }, { type: "image", mediaType: "image/jpeg", data }];
    },
  });
}
