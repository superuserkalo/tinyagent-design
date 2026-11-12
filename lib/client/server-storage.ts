// The SDK's four-method Storage, backed by this site's API and Cloudflare D1, so a chat
// follows the radian.sh account to every device. The server applies the fencing rule:
// an append lands only if the journal holds exactly `expected` records and no other tab
// holds the chat's lease; otherwise it answers 409 and this throws FencedError.
import { FencedError, type Item, type Storage } from "tiny-agent-sdk/browser";
import { api, errorMessage } from "./api.ts";

interface Page {
  records: { seq: number; at: number; record: Item }[];
  next: number | null;
}

export class ServerStorage implements Storage {
  private readonly owner: string;
  private readonly times = new Map<string, Map<number, number>>();

  constructor(owner: string) {
    this.owner = owner;
  }

  async load(sessionId: string): Promise<Item[] | undefined> {
    const records = await this.after(sessionId, 0);
    return records === null || records.length === 0 ? undefined : records;
  }

  /** Records after `after`, every page; null when the chat does not exist (or is not ours). */
  async after(sessionId: string, after: number): Promise<Item[] | null> {
    const records: Item[] = [];
    for (let cursor = after; ;) {
      const page = await api<Page>(`/api/chats/${encodeURIComponent(sessionId)}/records?after=${cursor}`);
      if (page.status === 404) return null;
      if (!page.ok) throw new Error(errorMessage(page.body, `loading the chat failed (${page.status})`));
      const stamps = this.stamps(sessionId);
      for (const row of page.body.records) {
        records.push({ ...row.record, sequence: row.seq });
        stamps.set(row.seq, row.at);
      }
      if (page.body.next === null) return records;
      cursor = page.body.next;
    }
  }

  async append(sessionId: string, expected: number, record: Item): Promise<number> {
    const response = await api(`/api/chats/${encodeURIComponent(sessionId)}/records`, {
      body: { expected, owner: this.owner, record: { ...record, sequence: expected + 1 } },
    });
    if (response.status === 409) throw new FencedError("this chat is running in another tab or on another device");
    if (!response.ok) throw new Error(errorMessage(response.body, `saving the chat failed (${response.status})`));
    this.stamps(sessionId).set(expected + 1, Date.now());
    return expected + 1;
  }

  async list(): Promise<string[]> {
    const response = await api<{ chats: { id: string }[] }>("/api/chats");
    if (!response.ok) throw new Error(errorMessage(response.body, "listing chats failed"));
    return response.body.chats.map((chat) => chat.id).sort();
  }

  /** Nothing is held open: every call is a request. Never deletes. */
  release(): void {}

  /** When each record was written, for durations in the chat. */
  stamps(sessionId: string): Map<number, number> {
    let stamps = this.times.get(sessionId);
    if (!stamps) this.times.set(sessionId, (stamps = new Map()));
    return stamps;
  }
}
