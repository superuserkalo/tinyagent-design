import type { Agent } from "./agent.ts";
import { Session as BaseSession, type ContextBudget } from "./session.ts";
import { type Storage } from "./storage.ts";
import { type Item } from "./types.ts";
/**
 * One append-only JSONL file per session in `directory`, each record with a
 * SHA-256, plus a lock file per session. Constructing it touches nothing.
 */
export declare class FileStorage implements Storage {
    readonly directory: string;
    private readonly journals;
    constructor(directory: string);
    private open;
    load(sessionId: string): Item[] | undefined;
    append(sessionId: string, expected: number, record: Item): number;
    list(): string[];
    release(sessionId: string): void;
}
/**
 * The Session of session.ts, plus what needs files: the `directory` option,
 * `Session.open` and `Session.list`. This is the Session the package's main
 * entry exports.
 */
export declare class Session extends BaseSession {
    protected static directoryStorage(directory: string): Storage;
    static open(agent: Agent, directory: string, sessionId: string, budget?: ContextBudget): Session;
    static list(directory: string): string[];
}
