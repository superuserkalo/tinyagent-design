// Chats on the server, keyed by the radian.sh user: each chat's TinyAgent journal,
// its published designs and its lease (which tab is running it). Schema in
// migrations/0002_sessions.sql. Every check-and-write is one SQL statement:
//   - append succeeds only if the session holds exactly `expected` records, the chat
//     belongs to the user and no other tab holds a live lease (the SDK's fencing rule);
//   - a lease is claimed only when it is free, expired or already ours.
import type { SqlExecutor } from "./store.ts";

export const SESSION_ID = /^s_[A-Za-z0-9_-]{1,100}$/;
export const EXECUTION_ID = /^(s_[A-Za-z0-9_-]{1,100}):([1-9][0-9]{0,8})$/;
export const LEASE_OWNER = /^[A-Za-z0-9_-]{8,64}$/;

/** A record over this many characters is stored in parts (D1 rows are limited to 2 MB). */
export const CHUNK_CHARS = 450_000;
/** Largest record accepted: a prompt with five images and its text fits well inside. */
export const MAX_RECORD_CHARS = 3_000_000;
export const MAX_DESIGN_CHARS = 400_000;
/** A page of records returned by load stays under this, below Vercel's 4.5 MB response limit. */
export const PAGE_CHARS = 2_500_000;
export const LEASE_MS = 20_000;

export interface ChatRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  grant: { id: string; expiresAt: number } | null;
  lease: { owner: string; until: number } | null;
}

export interface LoadedRecord {
  seq: number;
  at: number;
  record: Record<string, unknown>;
}

export type AppendResult = "ok" | "fenced" | "not_found";

const SQL = {
  ensureChat:
    "INSERT INTO chats (id, user_id, title, created_at, updated_at) VALUES (?1, ?2, ?3, CAST(?4 AS INTEGER), CAST(?4 AS INTEGER)) ON CONFLICT (id) DO NOTHING",
  owner: "SELECT user_id FROM chats WHERE id = ?1",
  claim:
    "UPDATE chats SET lease_owner = ?3, lease_until = CAST(?4 AS INTEGER) + CAST(?5 AS INTEGER) " +
    "WHERE id = ?1 AND user_id = ?2 AND (lease_until <= CAST(?4 AS INTEGER) OR lease_owner = ?3) RETURNING lease_until",
  release:
    "UPDATE chats SET lease_owner = NULL, lease_until = 0, grant_id = NULL, grant_expires_at = NULL, updated_at = CAST(?4 AS INTEGER) " +
    "WHERE id = ?1 AND user_id = ?2 AND lease_owner = ?3",
  setGrant:
    "UPDATE chats SET grant_id = ?3, grant_expires_at = CAST(?4 AS INTEGER), updated_at = CAST(?5 AS INTEGER) WHERE id = ?1 AND user_id = ?2",
  setTitle: "UPDATE chats SET title = ?3, updated_at = CAST(?4 AS INTEGER) WHERE id = ?1 AND user_id = ?2",
  hide: "UPDATE chats SET hidden = 1 WHERE id = ?1 AND user_id = ?2",
  list:
    "SELECT id, title, created_at, updated_at, grant_id, grant_expires_at, lease_owner, lease_until FROM chats " +
    "WHERE user_id = ?1 AND hidden = 0 ORDER BY updated_at DESC LIMIT 200",
  chat:
    "SELECT id, title, created_at, updated_at, grant_id, grant_expires_at, lease_owner, lease_until FROM chats WHERE id = ?1 AND user_id = ?2",
  chunk: "INSERT INTO record_chunks (chunk_id, part, session_id, body) VALUES (?1, CAST(?2 AS INTEGER), ?3, ?4)",
  // The fencing rule in one statement: the next sequence is written only if exactly
  // `expected` records exist, the chat is the user's, every part of a large record
  // arrived, and no other tab holds a live lease.
  append:
    "INSERT INTO records (session_id, seq, body, chunk_id, chunks, bytes, created_at) " +
    "SELECT ?1, CAST(?2 AS INTEGER) + 1, ?3, NULLIF(?4, ''), CAST(?5 AS INTEGER), CAST(?6 AS INTEGER), CAST(?7 AS INTEGER) " +
    "WHERE EXISTS (SELECT 1 FROM chats WHERE id = ?1 AND user_id = ?8 AND (lease_until <= CAST(?7 AS INTEGER) OR lease_owner = ?9)) " +
    "AND (SELECT COUNT(*) FROM records WHERE session_id = ?1) = CAST(?2 AS INTEGER) " +
    "AND (SELECT COUNT(*) FROM record_chunks WHERE chunk_id = ?4) = CAST(?5 AS INTEGER) " +
    "ON CONFLICT DO NOTHING RETURNING seq",
  touch: "UPDATE chats SET updated_at = CAST(?3 AS INTEGER) WHERE id = ?1 AND user_id = ?2",
  sizes: "SELECT seq, bytes FROM records WHERE session_id = ?1 AND seq > CAST(?2 AS INTEGER) ORDER BY seq LIMIT 1000",
  page:
    "SELECT seq, body, chunk_id, chunks, created_at FROM records WHERE session_id = ?1 AND seq > CAST(?2 AS INTEGER) AND seq <= CAST(?3 AS INTEGER) ORDER BY seq",
  parts: "SELECT body FROM record_chunks WHERE chunk_id = ?1 ORDER BY part",
  putDesign:
    "INSERT INTO designs (id, session_id, user_id, title, html, seq, created_at, updated_at) " +
    "SELECT ?1, ?2, ?3, ?4, ?5, CAST(?6 AS INTEGER), CAST(?7 AS INTEGER), CAST(?7 AS INTEGER) " +
    "WHERE EXISTS (SELECT 1 FROM chats WHERE id = ?2 AND user_id = ?3) " +
    "ON CONFLICT (id) DO UPDATE SET title = excluded.title, html = excluded.html, updated_at = excluded.updated_at " +
    "WHERE designs.user_id = excluded.user_id RETURNING id",
  designs: "SELECT id, title, seq, created_at FROM designs WHERE session_id = ?1 AND user_id = ?2 ORDER BY seq",
  design: "SELECT id, session_id, title, html, seq FROM designs WHERE id = ?1 AND user_id = ?2",
};

function chatRow(row: Record<string, unknown>): ChatRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    grant: row.grant_id ? { id: String(row.grant_id), expiresAt: Number(row.grant_expires_at) } : null,
    lease: row.lease_owner && Number(row.lease_until) > 0 ? { owner: String(row.lease_owner), until: Number(row.lease_until) } : null,
  };
}

export class SessionStore {
  private readonly exec: SqlExecutor;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(exec: SqlExecutor, now: () => number = Date.now, newId: () => string = () => crypto.randomUUID()) {
    this.exec = exec;
    this.now = now;
    this.newId = newId;
  }

  async list(userId: string): Promise<ChatRow[]> {
    const [rows] = await this.exec([{ sql: SQL.list, params: [userId] }]);
    return rows.map(chatRow);
  }

  async chat(userId: string, id: string): Promise<ChatRow | null> {
    if (!SESSION_ID.test(id)) return null;
    const [rows] = await this.exec([{ sql: SQL.chat, params: [id, userId] }]);
    return rows[0] ? chatRow(rows[0]) : null;
  }

  /** Create the chat if it is new, then take its lease. False when another tab holds it or it is someone else's. */
  async claim(userId: string, id: string, owner: string, title?: string): Promise<{ ok: boolean; chat: ChatRow | null }> {
    if (!SESSION_ID.test(id) || !LEASE_OWNER.test(owner)) return { ok: false, chat: null };
    const now = this.now();
    const [, claimed, rows] = await this.exec([
      { sql: SQL.ensureChat, params: [id, userId, (title ?? "").slice(0, 120), now] },
      { sql: SQL.claim, params: [id, userId, owner, now, LEASE_MS] },
      { sql: SQL.chat, params: [id, userId] },
    ]);
    return { ok: claimed.length > 0, chat: rows[0] ? chatRow(rows[0]) : null };
  }

  async release(userId: string, id: string, owner: string): Promise<void> {
    await this.exec([{ sql: SQL.release, params: [id, userId, owner, this.now()] }]);
  }

  async setGrant(userId: string, id: string, grant: { id: string; expiresAt: number }): Promise<void> {
    await this.exec([{ sql: SQL.setGrant, params: [id, userId, grant.id, grant.expiresAt, this.now()] }]);
  }

  async setTitle(userId: string, id: string, title: string): Promise<void> {
    await this.exec([{ sql: SQL.setTitle, params: [id, userId, title.slice(0, 120), this.now()] }]);
  }

  async hide(userId: string, id: string): Promise<void> {
    await this.exec([{ sql: SQL.hide, params: [id, userId] }]);
  }

  /** The SDK's conditional append, for one user's session. */
  async append(userId: string, sessionId: string, expected: number, record: Record<string, unknown>, owner: string): Promise<AppendResult> {
    if (!SESSION_ID.test(sessionId) || !Number.isSafeInteger(expected) || expected < 0) return "not_found";
    const body = JSON.stringify(record);
    if (body.length > MAX_RECORD_CHARS) throw new RangeError("record too large");
    const now = this.now();
    const large = body.length > CHUNK_CHARS;
    const chunkId = large ? this.newId() : "";
    const parts = large ? Array.from({ length: Math.ceil(body.length / CHUNK_CHARS) }, (_, index) => body.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS)) : [];
    const statements = [
      // The first record creates the chat (the SDK's "expected 0 creates the session").
      ...(expected === 0 ? [{ sql: SQL.ensureChat, params: [sessionId, userId, "", now] }] : []),
      ...parts.map((part, index) => ({ sql: SQL.chunk, params: [chunkId, index, sessionId, part] })),
      { sql: SQL.append, params: [sessionId, expected, large ? "" : body, chunkId, parts.length, body.length, now, userId, owner] },
      { sql: SQL.touch, params: [sessionId, userId, now] },
    ];
    const results = await this.exec(statements);
    if (results[statements.length - 2].length) return "ok";
    // Fenced, including a session that does not exist yet (the SDK's contract); a chat
    // that belongs to someone else is not found.
    const [owners] = await this.exec([{ sql: SQL.owner, params: [sessionId] }]);
    return owners[0] && owners[0].user_id !== userId ? "not_found" : "fenced";
  }

  /** Records after `after`, a page at a time. `next` is set when more remain. */
  async load(userId: string, sessionId: string, after = 0): Promise<{ records: LoadedRecord[]; next: number | null } | null> {
    if (!(await this.chat(userId, sessionId))) return null;
    const [sizes] = await this.exec([{ sql: SQL.sizes, params: [sessionId, after] }]);
    if (!sizes.length) return { records: [], next: null };
    let total = 0;
    let last = after;
    for (const row of sizes) {
      const bytes = Number(row.bytes);
      if (last !== after && total + bytes > PAGE_CHARS) break;
      total += bytes;
      last = Number(row.seq);
    }
    const [rows] = await this.exec([{ sql: SQL.page, params: [sessionId, after, last] }]);
    const records: LoadedRecord[] = [];
    for (const row of rows) {
      let body = String(row.body);
      if (Number(row.chunks) > 0) {
        const [parts] = await this.exec([{ sql: SQL.parts, params: [String(row.chunk_id)] }]);
        if (parts.length !== Number(row.chunks)) throw new Error(`record ${String(row.seq)} of ${sessionId} is missing parts`);
        body = parts.map((part) => String(part.body)).join("");
      }
      records.push({ seq: Number(row.seq), at: Number(row.created_at), record: JSON.parse(body) });
    }
    const more = sizes.length === 1000 || Number(sizes.at(-1)!.seq) > last;
    return { records, next: more ? last : null };
  }

  async putDesign(userId: string, executionId: string, title: string, html: string): Promise<boolean> {
    const match = EXECUTION_ID.exec(executionId);
    if (!match || html.length > MAX_DESIGN_CHARS) return false;
    const [rows] = await this.exec([{ sql: SQL.putDesign, params: [executionId, match[1], userId, title.slice(0, 120), html, Number(match[2]), this.now()] }]);
    return rows.length > 0;
  }

  async designs(userId: string, sessionId: string): Promise<{ id: string; title: string; seq: number; createdAt: number }[]> {
    const [rows] = await this.exec([{ sql: SQL.designs, params: [sessionId, userId] }]);
    return rows.map((row) => ({ id: String(row.id), title: String(row.title), seq: Number(row.seq), createdAt: Number(row.created_at) }));
  }

  async design(userId: string, id: string): Promise<{ id: string; sessionId: string; title: string; html: string } | null> {
    const [rows] = await this.exec([{ sql: SQL.design, params: [id, userId] }]);
    const row = rows[0];
    return row ? { id: String(row.id), sessionId: String(row.session_id), title: String(row.title), html: String(row.html) } : null;
  }
}
