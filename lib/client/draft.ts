// While the model writes publish_design's arguments, the page grows in the preview.
// The SDK gets the model's SSE stream untouched; a copy of it is read here only to
// pull the partial "html" argument out as it arrives.

/** The value of `key` in a JSON object that may still be arriving, decoded as far as it goes. */
export function partialJsonString(json: string, key: string): string | null {
  const match = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!match) return null;
  let out = "";
  for (let i = match.index + match[0].length; i < json.length; i++) {
    const char = json[i];
    if (char === '"') return out;
    if (char !== "\\") { out += char; continue; }
    const next = json[i + 1];
    if (next === undefined) return out;
    i += 1;
    switch (next) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "u": {
        const hex = json.slice(i + 1, i + 5);
        if (hex.length < 4) return out;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      default: out += next;
    }
  }
  return out;
}

/** Reads a Chat Completions SSE stream and reports the growing tool-call arguments. */
export async function watchToolArguments(body: ReadableStream<Uint8Array>, onArguments: (args: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let args = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      let changed = false;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const event = JSON.parse(data);
          for (const call of event?.choices?.[0]?.delta?.tool_calls ?? []) {
            if (typeof call?.function?.arguments === "string") { args += call.function.arguments; changed = true; }
          }
        } catch {}
      }
      if (changed) onArguments(args);
    }
  } catch {
    // The copy is best effort; the SDK's own stream decides the outcome.
  }
}
