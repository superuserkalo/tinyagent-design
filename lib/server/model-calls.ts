// Model calls that outlive the tab. The model route starts the gateway request and runs
// it to the end on the server, whether or not the tab is still listening, saving the
// output to the database every few hundred milliseconds. When the tab reloads, the SDK
// repeats the interrupted step with the same request; the route finds the call by its
// id (a hash of user, chat and request) and replays what was saved, then follows it live.
// Nothing is generated or charged twice. Schema in migrations/0003_model_calls.sql.
//
// The model's thinking is saved with the call and never sent to the browser.
import type { SqlExecutor } from "./store.ts";

/** A running call whose saved progress is older than this has died (its function ended). */
export const STALE_MS = 45_000;
/** Saved output is replayable for this long after the call ends; then only the thinking is kept. */
export const KEEP_FRAMES_MS = 60 * 60 * 1000;
const FLUSH_MS = 400;
const HEARTBEAT_MS = 5_000;
const POLL_MS = 500;
const MAX_REASONING = 1_500_000;

export type CallStatus = "running" | "done" | "failed" | "cancelled" | "archived";

export interface CallRow {
  id: string;
  userId: string;
  chatId: string;
  status: CallStatus;
  attempt: number;
  error: string | null;
  reasoning: string;
  frames: number;
  updatedAt: number;
}

/** What one saved frame holds: output in the order it streamed, merged. */
interface Frame {
  c?: string;
  t?: Record<string, { id?: string; name?: string; a: string }>;
  f?: string;
  u?: unknown;
  e?: { message: string };
}

const SQL = {
  get: "SELECT id, user_id, chat_id, status, attempt, error, reasoning, frames, updated_at FROM model_calls WHERE id = ?1",
  // A dead or badly ended call may be started again; a live or finished one may not.
  clearFrames:
    "DELETE FROM model_frames WHERE call_id = ?1 AND EXISTS (SELECT 1 FROM model_calls WHERE id = ?1 AND user_id = ?2 AND " +
    "(status IN ('failed', 'cancelled', 'archived') OR (status = 'running' AND updated_at < CAST(?3 AS INTEGER))))",
  claim:
    "INSERT INTO model_calls (id, user_id, chat_id, model, status, attempt, created_at, updated_at) " +
    "VALUES (?1, ?2, ?4, ?5, 'running', 1, CAST(?6 AS INTEGER), CAST(?6 AS INTEGER)) " +
    "ON CONFLICT (id) DO UPDATE SET status = 'running', attempt = model_calls.attempt + 1, error = NULL, reasoning = '', frames = 0, usage = NULL, " +
    "updated_at = excluded.updated_at WHERE model_calls.user_id = excluded.user_id AND " +
    "(model_calls.status IN ('failed', 'cancelled', 'archived') OR (model_calls.status = 'running' AND model_calls.updated_at < CAST(?3 AS INTEGER))) " +
    "RETURNING attempt",
  frame:
    "INSERT INTO model_frames (call_id, seq, body) SELECT ?1, CAST(?2 AS INTEGER), ?3 " +
    "WHERE EXISTS (SELECT 1 FROM model_calls WHERE id = ?1 AND status = 'running' AND attempt = CAST(?4 AS INTEGER)) ON CONFLICT DO NOTHING",
  progress:
    `UPDATE model_calls SET frames = CAST(?3 AS INTEGER), reasoning = substr(reasoning || ?4, 1, ${MAX_REASONING}), updated_at = CAST(?5 AS INTEGER) ` +
    "WHERE id = ?1 AND status = 'running' AND attempt = CAST(?2 AS INTEGER) RETURNING id",
  finish:
    `UPDATE model_calls SET status = ?3, error = NULLIF(?4, ''), usage = NULLIF(?5, ''), frames = CAST(?6 AS INTEGER), reasoning = substr(reasoning || ?7, 1, ${MAX_REASONING}), ` +
    "updated_at = CAST(?8 AS INTEGER) WHERE id = ?1 AND status = 'running' AND attempt = CAST(?2 AS INTEGER)",
  frames: "SELECT seq, body FROM model_frames WHERE call_id = ?1 AND seq > CAST(?2 AS INTEGER) ORDER BY seq LIMIT 200",
  cancel: "UPDATE model_calls SET status = 'cancelled', updated_at = CAST(?3 AS INTEGER) WHERE chat_id = ?1 AND user_id = ?2 AND status = 'running'",
  sweepFrames:
    "DELETE FROM model_frames WHERE call_id IN (SELECT id FROM model_calls WHERE status IN ('done', 'failed', 'cancelled') AND updated_at < CAST(?1 AS INTEGER))",
  sweepCalls: "UPDATE model_calls SET status = 'archived', frames = 0 WHERE status IN ('done', 'failed', 'cancelled') AND updated_at < CAST(?1 AS INTEGER)",
};

function row(raw: Record<string, unknown>): CallRow {
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    chatId: String(raw.chat_id),
    status: String(raw.status) as CallStatus,
    attempt: Number(raw.attempt),
    error: raw.error == null ? null : String(raw.error),
    reasoning: String(raw.reasoning ?? ""),
    frames: Number(raw.frames),
    updatedAt: Number(raw.updated_at),
  };
}

/** The call's id: the same user, chat and request always give the same id. */
export async function callId(userId: string, chatId: string, request: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([userId, chatId, request]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "mc_" + Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const encoder = new TextEncoder();
const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const DONE = encoder.encode("data: [DONE]\n\n");

/** One OpenAI-style chunk for a frame; the SDK reads it like any gateway chunk. */
function chunk(frame: Frame): Uint8Array | null {
  if (frame.e) return sse({ error: frame.e });
  const delta: Record<string, unknown> = {};
  if (frame.c) delta.content = frame.c;
  if (frame.t) {
    delta.tool_calls = Object.entries(frame.t).map(([index, call]) => ({
      index: Number(index), ...(call.id ? { id: call.id, type: "function" } : {}),
      function: { ...(call.name ? { name: call.name } : {}), arguments: call.a },
    }));
  }
  const hasChoice = Object.keys(delta).length > 0 || frame.f !== undefined;
  if (!hasChoice && frame.u === undefined) return null;
  return sse({
    choices: hasChoice ? [{ index: 0, delta, finish_reason: frame.f ?? null }] : [],
    ...(frame.u !== undefined ? { usage: frame.u } : {}),
  });
}

function empty(frame: Frame): boolean {
  return !frame.c && !frame.t && frame.f === undefined && frame.u === undefined && !frame.e;
}

function merge(into: Frame, from: Frame) {
  if (from.c) into.c = (into.c ?? "") + from.c;
  if (from.t) {
    into.t ??= {};
    for (const [index, call] of Object.entries(from.t)) {
      const target = (into.t[index] ??= { a: "" });
      if (call.id) target.id = call.id;
      if (call.name) target.name = call.name;
      target.a += call.a;
    }
  }
  if (from.f !== undefined) into.f = from.f;
  if (from.u !== undefined) into.u = from.u;
  if (from.e) into.e = from.e;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Split one gateway chunk into what the browser may see and the thinking it may not. */
export function readEvent(event: Record<string, unknown>): { frame: Frame; reasoning: string } {
  const frame: Frame = {};
  let reasoning = "";
  const error = record(event.error);
  if (error) frame.e = { message: String(error.message ?? "The model stream failed.").slice(0, 500) };
  if (record(event.usage)) frame.u = event.usage;
  const choice = Array.isArray(event.choices) ? record(event.choices[0]) : null;
  if (choice) {
    const delta = record(choice.delta) ?? {};
    for (const key of ["reasoning_content", "reasoning"]) if (typeof delta[key] === "string") reasoning += delta[key];
    if (typeof delta.content === "string" && delta.content) frame.c = delta.content;
    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const part = record(raw);
        if (!part) continue;
        const fn = record(part.function) ?? {};
        const index = String(Number.isSafeInteger(part.index) ? part.index : 0);
        frame.t ??= {};
        const call = (frame.t[index] ??= { a: "" });
        if (typeof part.id === "string" && part.id) call.id = part.id;
        if (typeof fn.name === "string" && fn.name) call.name = fn.name;
        if (typeof fn.arguments === "string") call.a += fn.arguments;
      }
    }
    if (typeof choice.finish_reason === "string") frame.f = choice.finish_reason;
  }
  return { frame, reasoning };
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown> | "done"> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") { yield "done"; continue; }
      try {
        const event = record(JSON.parse(data));
        if (event) yield event;
      } catch { /* not JSON: skip, as the SDK does */ }
    }
  }
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class ModelCalls {
  private readonly exec: SqlExecutor;
  private readonly now: () => number;

  constructor(exec: SqlExecutor, now: () => number = Date.now) {
    this.exec = exec;
    this.now = now;
  }

  async get(id: string): Promise<CallRow | null> {
    const [rows] = await this.exec([{ sql: SQL.get, params: [id] }]);
    return rows[0] ? row(rows[0]) : null;
  }

  /** True when this call can be replayed instead of started: it is live, or it finished and its output is still saved. */
  replayable(call: CallRow | null): boolean {
    if (!call) return false;
    return call.status === "done" || (call.status === "running" && this.now() - call.updatedAt < STALE_MS);
  }

  /** Start the call, or start it again after it died. Returns its attempt number, or null when another request started it first. */
  async claim(id: string, userId: string, chatId: string, model: string): Promise<number | null> {
    const now = this.now();
    const cutoff = now - KEEP_FRAMES_MS;
    const [, , , claimed] = await this.exec([
      { sql: SQL.sweepFrames, params: [cutoff] },
      { sql: SQL.sweepCalls, params: [cutoff] },
      // The old output of a call that is about to start again.
      { sql: SQL.clearFrames, params: [id, userId, now - STALE_MS] },
      { sql: SQL.claim, params: [id, userId, now - STALE_MS, chatId, model, now] },
    ]);
    return claimed[0] ? Number(claimed[0].attempt) : null;
  }

  /** Stop every running call of a chat (the stop button). Its function sees it at the next save and aborts the gateway request. */
  async cancel(userId: string, chatId: string): Promise<void> {
    await this.exec([{ sql: SQL.cancel, params: [chatId, userId, this.now()] }]);
  }

  async fail(id: string, attempt: number, message: string): Promise<void> {
    await this.exec([{ sql: SQL.finish, params: [id, attempt, "failed", message.slice(0, 500), "", 0, "", this.now()] }]);
  }

  /**
   * Run the gateway stream to its end, saving it as it goes. Returns the stream for the
   * tab that started the call (without the thinking) and a promise for the whole run,
   * which the route hands to waitUntil so the function lives until the call ends.
   */
  run(id: string, attempt: number, upstream: ReadableStream<Uint8Array>, abort: AbortController): { live: ReadableStream<Uint8Array>; done: Promise<void> } {
    const pipe = new TransformStream<Uint8Array, Uint8Array>();
    const writer = pipe.writable.getWriter();
    let listening = true;
    const send = (bytes: Uint8Array | null) => {
      if (!bytes || !listening) return;
      writer.write(bytes).catch(() => { listening = false; });
    };

    let pending: Frame = {};
    let thinking = "";
    let usage = "";
    let seq = 0;
    let savedAt = this.now();
    let cancelled = false;
    let saving: Promise<void> = Promise.resolve();

    const save = (force = false) => {
      saving = saving.then(async () => {
        if (cancelled) return;
        const frame = pending;
        const reasoning = thinking;
        if (empty(frame) && !reasoning && !force && this.now() - savedAt < HEARTBEAT_MS) return;
        pending = {};
        thinking = "";
        const statements = [];
        if (!empty(frame)) statements.push({ sql: SQL.frame, params: [id, ++seq, JSON.stringify(frame), attempt] });
        statements.push({ sql: SQL.progress, params: [id, attempt, seq, reasoning, this.now()] });
        try {
          const results = await this.exec(statements);
          savedAt = this.now();
          if (!results.at(-1)!.length) {
            // Stopped (or started again elsewhere): end the gateway request.
            cancelled = true;
            abort.abort();
          }
        } catch {
          // The database blipped: keep the output and try again with the next save.
          if (!empty(frame)) { seq -= 1; const later = pending; pending = frame; merge(pending, later); }
          thinking = reasoning + thinking;
        }
      });
      return saving;
    };

    const done = (async () => {
      let finished = false;
      const ticker = (async () => {
        while (!finished) { await sleep(FLUSH_MS); if (!finished) await save(); }
      })();
      let sawEnd = false;
      let error: string | null = null;
      try {
        for await (const event of sseEvents(upstream)) {
          if (event === "done") { sawEnd = true; break; }
          const { frame, reasoning } = readEvent(event);
          thinking += reasoning;
          if (frame.e) error = frame.e.message;
          if (frame.u !== undefined) usage = JSON.stringify(frame.u);
          merge(pending, frame);
          send(chunk(frame));
          if (frame.f !== undefined) sawEnd = true;
        }
      } catch (caught) {
        if (!cancelled) error = caught instanceof Error ? caught.message : "The model stream broke off.";
      }
      finished = true;
      await ticker;
      if (!error && !sawEnd && !cancelled) error = "The model stream ended early.";
      if (error && !pending.e) {
        const frame = { e: { message: error } };
        merge(pending, frame);
        send(chunk(frame));
      }
      await save(true);
      if (!cancelled) {
        await this.exec([{ sql: SQL.finish, params: [id, attempt, error ? "failed" : "done", error ?? "", usage, seq, thinking, this.now()] }])
          .catch(() => {});
      }
      if (!error && !cancelled) send(DONE);
      if (listening) await writer.close().catch(() => {});
    })();

    return { live: pipe.readable, done };
  }

  /** Replay a call's saved output from the start, then follow it until it ends. */
  follow(id: string): ReadableStream<Uint8Array> {
    const stop = new AbortController();
    let after = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        while (!stop.signal.aborted) {
          const call = await this.get(id);
          const [frames] = await this.exec([{ sql: SQL.frames, params: [id, after] }]);
          for (const frame of frames) {
            after = Number(frame.seq);
            const bytes = chunk(JSON.parse(String(frame.body)) as Frame);
            if (bytes) controller.enqueue(bytes);
          }
          if (frames.length) return;
          if (!call || call.status === "archived") {
            controller.enqueue(sse({ error: { message: "This model call is no longer available." } }));
            return controller.close();
          }
          if (call.status === "done") { controller.enqueue(DONE); return controller.close(); }
          if (call.status === "failed" || call.status === "cancelled") {
            // A failure was saved as an error frame and replayed above; a stop ends the stream.
            if (call.status === "cancelled") controller.enqueue(sse({ error: { message: "The run was stopped." } }));
            return controller.close();
          }
          if (this.now() - call.updatedAt >= STALE_MS) {
            controller.enqueue(sse({ error: { message: "The model call was interrupted." } }));
            return controller.close();
          }
          await sleep(POLL_MS, stop.signal);
        }
      },
      cancel: () => stop.abort(),
    });
  }
}
