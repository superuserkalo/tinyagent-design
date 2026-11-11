// The agent's one tool. It runs in the browser: the handler stores the page in
// IndexedDB and the preview shows it. Nothing here touches the network.
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

export function publishDesignTool(save: (design: PublishedDesign, signal: AbortSignal) => Promise<number>): Tool {
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
    timeoutSeconds: 30,
    handler: async ({ title, html }, signal, { executionId }) => {
      const page = String(html).trim();
      const name = String(title).trim();
      if (!/^<!doctype html>/i.test(page) || !/<\/html>\s*$/i.test(page))
        throw new ToolError("The document must start with <!doctype html> and end with </html>. Send the complete page.");
      if (new TextEncoder().encode(page).length > MAX_DESIGN_BYTES)
        throw new ToolError(`The document is over ${MAX_DESIGN_BYTES / 1000} KB. Make it more compact and publish again.`);
      const version = await save({ executionId, title: name, html: page }, signal);
      return `Published version ${version}: ${name}. The preview is showing it.`;
    },
  });
}
