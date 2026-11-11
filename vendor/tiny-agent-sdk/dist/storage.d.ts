import { type Item } from "./types.ts";
export declare class SessionBusyError extends Error {
    readonly code = "session_busy";
}
export declare class SessionCorruptionError extends Error {
}
/** Another writer got there first: the append wrote nothing. */
export declare class FencedError extends Error {
    readonly code = "session_fenced";
    constructor(message?: string);
}
/**
 * Where sessions are kept. A session is an ordered list of JSON records; the
 * store may serialise them however it likes. Every operation may return its
 * value directly or as a promise.
 */
export interface Storage {
    /** The session's records in order, each with its `sequence` (1..n), or undefined when there is no such session. */
    load(sessionId: string): Item[] | undefined | Promise<Item[] | undefined>;
    /**
     * Store `record` as number `expected + 1` and return that sequence. It must be
     * durable before this returns. When the session does not hold exactly
     * `expected` records, write nothing and throw FencedError. `expected` 0 creates
     * the session. Any other error means the outcome is unknown.
     */
    append(sessionId: string, expected: number, record: Item): number | Promise<number>;
    list(): string[] | Promise<string[]>;
    /** Let go of the session's resources. Never deletes data. */
    release(sessionId: string): void | Promise<void>;
}
/** Sessions that live and die with this object. It can be shared by several Sessions. */
export declare class MemoryStorage implements Storage {
    private readonly sessions;
    load(sessionId: string): Item[] | undefined;
    append(sessionId: string, expected: number, record: Item): number;
    list(): string[];
    release(): void;
}
/**
 * The storage contract as a check any implementation can run. It throws an
 * AssertionError at the first rule the store breaks, and leaves two small
 * sessions behind, because a store never deletes.
 */
export declare function checkStorage(storage: Storage): Promise<void>;
