// The SDK's four-method Storage over a small backend interface, with an in-memory
// backend. The tests use it; the browser uses lib/client/server-storage.ts. The backend's one hard duty is `appendIfCount`: check the count and write in
// one atomic step, which is what keeps two tabs on one chat from corrupting it.
import { FencedError, type Item, type Storage } from "tiny-agent-sdk/browser";

export interface JournalBackend {
  /** The session's records in sequence order, or an empty list. */
  records(sessionId: string): Promise<Item[]>;
  /**
   * Atomically: if the session holds exactly `expected` records, store `record` as
   * number `expected + 1` (with the time it was written) and return true; otherwise
   * write nothing and return false.
   */
  appendIfCount(sessionId: string, expected: number, record: Item, at: number): Promise<boolean>;
  /** Every session that has at least one record. */
  sessions(): Promise<string[]>;
  /** When each record was written, by sequence. Not part of the SDK contract: the UI shows durations from it. */
  stamps(sessionId: string): Promise<Map<number, number>>;
}

export class JournalStorage implements Storage {
  private readonly backend: JournalBackend;
  private readonly now: () => number;

  constructor(backend: JournalBackend, now: () => number = Date.now) {
    this.backend = backend;
    this.now = now;
  }

  async load(sessionId: string): Promise<Item[] | undefined> {
    const records = await this.backend.records(sessionId);
    return records.length ? records : undefined;
  }

  async append(sessionId: string, expected: number, record: Item): Promise<number> {
    if (!Number.isInteger(expected) || expected < 0) throw new TypeError("expected must be a nonnegative integer");
    const stored = await this.backend.appendIfCount(sessionId, expected, { ...structuredClone(record), sequence: expected + 1 }, this.now());
    if (!stored) throw new FencedError();
    return expected + 1;
  }

  async list(): Promise<string[]> {
    return [...await this.backend.sessions()].sort();
  }

  /** Nothing to release: IndexedDB transactions end by themselves. Never deletes data. */
  release(): void {}

  stamps(sessionId: string): Promise<Map<number, number>> {
    return this.backend.stamps(sessionId);
  }
}

/** The backend the tests use. It keeps the same rules as the IndexedDB one. */
export class MemoryJournalBackend implements JournalBackend {
  private readonly data = new Map<string, { record: Item; at: number }[]>();

  async records(sessionId: string): Promise<Item[]> {
    return structuredClone((this.data.get(sessionId) ?? []).map((entry) => entry.record));
  }

  async appendIfCount(sessionId: string, expected: number, record: Item, at: number): Promise<boolean> {
    const list = this.data.get(sessionId) ?? [];
    if (list.length !== expected) return false;
    list.push({ record: structuredClone(record), at });
    this.data.set(sessionId, list);
    return true;
  }

  async sessions(): Promise<string[]> {
    return [...this.data.entries()].filter(([, list]) => list.length > 0).map(([id]) => id);
  }

  async stamps(sessionId: string): Promise<Map<number, number>> {
    return new Map((this.data.get(sessionId) ?? []).map((entry, index) => [index + 1, entry.at]));
  }
}
