import { type Server } from "node:http";
import { type ContextBudget, type SessionOptions } from "./session.ts";
import { type Storage } from "./storage.ts";
import type { Agent } from "./agent.ts";
export interface ServerOptions {
    host?: string;
    port?: number;
    token?: string;
    allowRemote?: boolean;
    /** Where sessions are kept. Without `storage` or `directory` they live in memory. */
    storage?: Storage;
    directory?: string;
    budget?: ContextBudget;
    onUncertain?: SessionOptions["onUncertain"];
    /** Host names, besides the bound address, that requests may be addressed to. */
    allowedHosts?: string[];
    /** Origins whose pages may call the server. Default: none, so every request with an Origin header is refused. */
    allowedOrigins?: string[];
}
export interface AgentServer {
    readonly url: string;
    /** Stop accepting requests, cancel runs, and wait for cooperative cleanup. */
    close(): Promise<void>;
}
interface HttpApplication {
    readonly server: Server;
    readonly host: string;
    readonly port: number;
    close(): Promise<void>;
}
/** Construct the native server separately from binding its listener. */
export declare function createHttpServer(agent: Agent, options?: ServerOptions): HttpApplication;
/** Serve one configured Agent. All model and tool execution stays in Agent.run. */
export declare function serve(agent: Agent, options?: ServerOptions): Promise<AgentServer>;
export {};
