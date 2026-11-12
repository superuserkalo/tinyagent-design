// What the chat shows, rebuilt from the TinyAgent journal. The journal is the one
// source of truth: after a reload the same records give the same transcript, and a
// run that was interrupted shows where it stopped until it resumes.
import type { Item } from "tiny-agent-sdk/browser";
import { PUBLISH_DESIGN } from "./tools.ts";

export interface ToolRow {
  key: string;
  name: string;
  status: "running" | "done" | "error";
  /** The design's title, for publish_design. */
  detail?: string;
  /** Size of the page it published, in characters. */
  bytes?: number;
  /** Run again after a reload. */
  rerun?: boolean;
  durationMs?: number;
  output?: string;
}

export type RunState = "running" | "done" | "failed" | "interrupted";

export type Entry =
  | { kind: "user"; key: string; text: string; images: string[] }
  | { kind: "activity"; key: string; state: RunState; tools: ToolRow[]; updates: number; writing: boolean }
  | { kind: "text"; key: string; text: string; streaming?: boolean; interrupted?: boolean }
  | { kind: "status"; key: string; text: string; detail?: string }
  | { kind: "artifact"; key: string; executionId: string; version: number | null }
  | { kind: "error"; key: string; text: string }
  | { kind: "divider"; key: string; durationMs?: number; usage?: { inputTokens: number; outputTokens: number } };

export interface Live {
  /** A run of this session is in progress in this tab. */
  running: boolean;
  /** Text of the model turn streaming now, not yet journaled. */
  text: string;
  /** Another tab or device is running it; this one follows the journal. */
  watching?: boolean;
  /** This tab resumed the run after the record with this sequence. */
  resumedAt?: number | null;
  /** What a reload cut off of the interrupted turn, shown until that turn streams again. */
  partialText?: string;
}

function imagesOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => part?.type === "image" && typeof part.data === "string" && typeof part.mediaType === "string")
    .map((part) => `data:${part.mediaType};base64,${part.data}`);
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("");
}

function hasToolCalls(item: Item): boolean {
  return Array.isArray(item.content) && item.content.some((part: Item) => part?.type === "tool_call");
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  return textOf(output) || JSON.stringify(output);
}

export function errorText(error: unknown): string {
  const record = (typeof error === "object" && error !== null ? error : {}) as { code?: string; message?: string; limit?: string };
  if (record.code === "limit_exceeded") return `The run stopped at its ${record.limit ?? "step"} limit.`;
  if (record.code === "abandoned") return "This run was set aside.";
  const message = record.message ?? "The run failed.";
  // The provider reports the model route's error body; show its message, not the JSON around it.
  const inner = /"message":"([^"]+)"/.exec(message)?.[1];
  return inner ?? message;
}

export function buildTranscript(
  sessionId: string,
  records: Item[],
  stamps: Map<number, number>,
  versions: Map<string, number>,
  live: Live,
): Entry[] {
  const entries: Entry[] = [];
  type Run = { key: string; startSeq: number; activity: Entry & { kind: "activity" }; rows: Map<string, ToolRow & { seq: number }>; artifact?: string; open: boolean };
  let run: Run | null = null;

  const close = (state: RunState) => {
    if (!run) return;
    run.activity.state = state;
    run.open = false;
  };

  const resumedMarker = () => {
    if (run?.open && live.resumedAt != null) entries.push({ kind: "status", key: `${run.key}-resumed`, text: "resumed", detail: "after a reload, from the last saved step" });
  };
  for (const record of records) {
    const seq = Number(record.sequence);
    const item = (record.item ?? {}) as Item;
    if (live.resumedAt != null && seq === live.resumedAt + 1) resumedMarker();
    switch (record.type) {
      case "run_start": {
        if (run?.open) close("failed");
        const key = `run-${seq}`;
        entries.push({ kind: "user", key: `${key}-user`, text: textOf(item.content), images: imagesOf(item.content) });
        const activity: Entry & { kind: "activity" } = { kind: "activity", key: `${key}-activity`, state: "running", tools: [], updates: 0, writing: false };
        entries.push(activity);
        run = { key, startSeq: seq, activity, rows: new Map(), open: true };
        break;
      }
      case "item":
        if (!run || item.role !== "assistant") break;
        if (hasToolCalls(item) && textOf(item.content).trim()) {
          run.activity.updates += 1;
          entries.push({ kind: "text", key: `text-${seq}`, text: textOf(item.content) });
        }
        break;
      case "tool_intent": {
        if (!run) break;
        const args = (record.arguments ?? {}) as Item;
        const row = {
          key: `tool-${seq}`, seq, name: String(record.toolName), status: "running" as const,
          detail: typeof args.title === "string" ? args.title : undefined,
          bytes: typeof args.html === "string" ? args.html.length : undefined,
        } as ToolRow & { seq: number };
        run.rows.set(String(record.callId), row);
        run.activity.tools.push(row);
        break;
      }
      case "tool_rerun":
      case "tool_resumed": {
        const row = run?.rows.get(String(record.callId));
        if (row) { row.status = "running"; row.rerun = true; }
        break;
      }
      case "tool_result": {
        if (!run) break;
        const row = run.rows.get(String(item.callId));
        if (!row) break;
        row.status = item.isError ? "error" : "done";
        row.output = outputText(item.output);
        const started = stamps.get(row.seq);
        const ended = stamps.get(seq);
        if (started !== undefined && ended !== undefined) row.durationMs = ended - started;
        if (!item.isError && row.name === PUBLISH_DESIGN && !record.interrupted) run.artifact = `${sessionId}:${row.seq}`;
        break;
      }
      case "run_commit": {
        if (!run) break;
        const text = String(record.text ?? "");
        if (text.trim()) entries.push({ kind: "text", key: `${run.key}-answer`, text });
        if (run.artifact) entries.push({ kind: "artifact", key: `${run.key}-artifact`, executionId: run.artifact, version: versions.get(run.artifact) ?? null });
        const usage = record.usage as { inputTokens: number; outputTokens: number } | undefined;
        const started = stamps.get(run.startSeq);
        const ended = stamps.get(seq);
        entries.push({ kind: "divider", key: `${run.key}-end`, usage, durationMs: started !== undefined && ended !== undefined ? ended - started : undefined });
        close("done");
        run = null;
        break;
      }
      case "run_failed": {
        if (!run) break;
        if (run.artifact) entries.push({ kind: "artifact", key: `${run.key}-artifact`, executionId: run.artifact, version: versions.get(run.artifact) ?? null });
        entries.push({ kind: "error", key: `${run.key}-error`, text: record.status === "aborted" ? "Stopped." : errorText(record.error) });
        entries.push({ kind: "divider", key: `${run.key}-end` });
        close("failed");
        run = null;
        break;
      }
    }
  }

  if (run?.open && live.resumedAt != null && records.length === live.resumedAt) resumedMarker();
  if (run?.open) {
    run.activity.state = live.running || live.watching ? "running" : "interrupted";
    if (live.running && live.text.trim()) {
      run.activity.writing = true;
      entries.push({ kind: "text", key: `${run.key}-live`, text: live.text, streaming: true });
    } else if (live.partialText?.trim()) {
      // The turn a reload cut off: what had arrived, until the redone turn streams.
      entries.push({ kind: "text", key: `${run.key}-partial`, text: live.partialText, interrupted: true });
    }
    if (run.artifact) entries.push({ kind: "artifact", key: `${run.key}-artifact`, executionId: run.artifact, version: versions.get(run.artifact) ?? null });
  }
  // A run with nothing to show in its activity group (a plain answer) gets no group.
  return entries.filter((entry) => entry.kind !== "activity" || entry.tools.length > 0 || entry.state === "running" || entry.state === "interrupted");
}

/** The first prompt of a chat, for its title until a design names it. */
export function firstPrompt(records: Item[]): string | null {
  const start = records.find((record) => record.type === "run_start");
  return start ? textOf((start.item as Item | undefined)?.content) : null;
}
