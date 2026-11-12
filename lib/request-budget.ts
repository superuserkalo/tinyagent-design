// Every model request re-sends the whole chat. Before one leaves the tab, drop what the
// model no longer needs, so long chats stay under the 4.5 MB request limit and cost less:
//   - the HTML of every publish_design call except the latest (the latest page is kept whole);
//   - images in older messages once the images in the request pass their budget.
// The journal keeps everything; only the request is trimmed.
import { MAX_REQUEST_IMAGE_CHARS } from "./images.ts";
import { PUBLISH_DESIGN } from "./tools.ts";

type Part = { type?: string; text?: string; image_url?: { url?: string } };
type Message = { role?: string; content?: unknown; tool_calls?: { function?: { name?: string; arguments?: string } }[] };

export const OMITTED_DESIGN = "[an earlier version of the page; the latest version is in a later publish_design call]";
export const OMITTED_IMAGE = "[an image attached earlier, left out of this request to save space]";

export function compactRequest<T extends { messages?: unknown }>(body: T): T {
  if (!Array.isArray(body.messages)) return body;
  const messages = structuredClone(body.messages) as Message[];

  const publishes = messages.flatMap((message) => (message.tool_calls ?? []).filter((call) => call.function?.name === PUBLISH_DESIGN));
  for (const call of publishes.slice(0, -1)) {
    try {
      const args = JSON.parse(call.function!.arguments ?? "{}");
      if (typeof args.html === "string") call.function!.arguments = JSON.stringify({ ...args, html: OMITTED_DESIGN });
    } catch {}
  }

  let budget = MAX_REQUEST_IMAGE_CHARS;
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index].content;
    if (!Array.isArray(content)) continue;
    messages[index].content = (content as Part[]).map((part) => {
      if (part?.type !== "image_url") return part;
      const size = part.image_url?.url?.length ?? 0;
      if (size <= budget) {
        budget -= size;
        return part;
      }
      budget = -1;
      return { type: "text", text: OMITTED_IMAGE };
    });
  }
  return { ...body, messages };
}
