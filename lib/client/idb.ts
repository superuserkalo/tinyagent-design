// Everything this site keeps lives in one IndexedDB database in the visitor's browser:
//   records  the TinyAgent journal, keyed [sessionId, sequence]
//   stamps   when each record was written, same key (for durations in the chat)
//   designs  the published HTML, keyed by the tool call's executionId
//   chats    per-chat metadata: title and the prompt grant of the current run
// The design preview runs in an opaque-origin iframe and cannot open this database.
import type { Item } from "tiny-agent-sdk/browser";
import type { JournalBackend } from "../storage.ts";

const VERSION = 1;

export function openDatabase(name = "tinyagent-design"): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name, VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records");
      if (!db.objectStoreNames.contains("stamps")) db.createObjectStore("stamps");
      if (!db.objectStoreNames.contains("designs")) db.createObjectStore("designs", { keyPath: "id" }).createIndex("session", "sessionId");
      if (!db.objectStoreNames.contains("chats")) db.createObjectStore("chats", { keyPath: "id" });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

const range = (sessionId: string) => IDBKeyRange.bound([sessionId, 0], [sessionId, Infinity]);

export class IdbJournalBackend implements JournalBackend {
  private readonly db: Promise<IDBDatabase>;

  constructor(db: Promise<IDBDatabase>) {
    this.db = db;
  }

  async records(sessionId: string): Promise<Item[]> {
    const tx = (await this.db).transaction("records", "readonly");
    return request(tx.objectStore("records").getAll(range(sessionId))) as Promise<Item[]>;
  }

  async appendIfCount(sessionId: string, expected: number, record: Item, at: number): Promise<boolean> {
    // One readwrite transaction counts and writes: IndexedDB runs overlapping readwrite
    // transactions on the same store one after another, so two tabs cannot both pass the check.
    const tx = (await this.db).transaction(["records", "stamps"], "readwrite", { durability: "strict" });
    const done = committed(tx);
    const records = tx.objectStore("records");
    const count = await request(records.count(range(sessionId)));
    if (count !== expected) {
      tx.abort();
      await done.catch(() => {});
      return false;
    }
    records.add(record, [sessionId, expected + 1]);
    tx.objectStore("stamps").put(at, [sessionId, expected + 1]);
    await done;
    return true;
  }

  async sessions(): Promise<string[]> {
    const tx = (await this.db).transaction("records", "readonly");
    const keys = await request(tx.objectStore("records").getAllKeys()) as unknown as [string, number][];
    return keys.filter(([, sequence]) => sequence === 1).map(([sessionId]) => sessionId);
  }

  async stamps(sessionId: string): Promise<Map<number, number>> {
    const tx = (await this.db).transaction("stamps", "readonly");
    const store = tx.objectStore("stamps");
    const [keys, values] = await Promise.all([
      request(store.getAllKeys(range(sessionId))) as unknown as Promise<[string, number][]>,
      request(store.getAll(range(sessionId))) as Promise<number[]>,
    ]);
    return new Map(keys.map(([, sequence], index) => [sequence, values[index]]));
  }
}

export interface StoredDesign {
  /** The publish_design call's executionId, "<sessionId>:<journal sequence>". A rerun after a reload reuses it. */
  id: string;
  sessionId: string;
  title: string;
  html: string;
  createdAt: number;
}

export interface ChatMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** The prompt grant of the run in progress, so a resume after a reload is not charged again. */
  grant?: { id: string; expiresAt: number };
  /** The title came from a published design rather than the first prompt. */
  designTitled?: boolean;
  /** Removed from the list. The journal itself is never deleted. */
  hidden?: boolean;
}

export class SiteDatabase {
  readonly db: Promise<IDBDatabase>;

  constructor(db: Promise<IDBDatabase>) {
    this.db = db;
  }

  /** Idempotent: the same executionId always lands on the same row. */
  async putDesign(design: StoredDesign): Promise<void> {
    const tx = (await this.db).transaction("designs", "readwrite", { durability: "strict" });
    const done = committed(tx);
    tx.objectStore("designs").put(design);
    await done;
  }

  async designs(sessionId: string): Promise<StoredDesign[]> {
    const tx = (await this.db).transaction("designs", "readonly");
    const rows = await request(tx.objectStore("designs").index("session").getAll(sessionId)) as StoredDesign[];
    return rows.sort((a, b) => designSequence(a.id) - designSequence(b.id));
  }

  async chat(id: string): Promise<ChatMeta | undefined> {
    const tx = (await this.db).transaction("chats", "readonly");
    return request(tx.objectStore("chats").get(id)) as Promise<ChatMeta | undefined>;
  }

  async chats(): Promise<ChatMeta[]> {
    const tx = (await this.db).transaction("chats", "readonly");
    return request(tx.objectStore("chats").getAll()) as Promise<ChatMeta[]>;
  }

  async putChat(chat: ChatMeta): Promise<void> {
    const tx = (await this.db).transaction("chats", "readwrite");
    const done = committed(tx);
    tx.objectStore("chats").put(chat);
    await done;
  }
}

export function designSequence(executionId: string): number {
  const sequence = Number(executionId.slice(executionId.lastIndexOf(":") + 1));
  return Number.isFinite(sequence) ? sequence : 0;
}
