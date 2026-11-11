import type { Readable, Writable } from "node:stream";
import type { Agent } from "./agent.ts";
import { Session } from "./file_storage.ts";
import { type SessionOptions } from "./session.ts";
import { type Item } from "./types.ts";
/** A run's signal also lets a transport stop waiting for a stalled consumer. */
export type RpcEmitter = (value: object, signal?: AbortSignal) => void | Promise<void>;
export declare class RpcSession {
    readonly agent: Agent;
    private readonly emit;
    private readonly diagnostics;
    session: Session;
    private readonly options;
    private active;
    private closing;
    constructor(agent: Agent, emit: RpcEmitter, diagnostics?: (message: string) => void, options?: SessionOptions);
    handle(request: Item): Promise<void>;
    waitIdle(timeoutMs?: number): Promise<boolean>;
    close(): Promise<void>;
    stop(): Promise<void>;
    private execute;
    private commandError;
}
export declare function runRpc(agent: Agent, input?: Readable, output?: Writable, options?: SessionOptions): Promise<void>;
/** The standalone RPC process owns exit; the imported stream driver does not. */
export declare function runRpcProcess(agent: Agent, options?: SessionOptions): Promise<never>;
