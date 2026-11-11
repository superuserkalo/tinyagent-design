import { Tool } from "./types.ts";
export interface BashOptions {
    /** Working directory for every command. Default: the process's. */
    cwd?: string;
    /** Variables merged over the process environment. */
    env?: Record<string, string>;
    /** Kill the command's process group after this long. Default: no limit. */
    timeoutSeconds?: number;
}
/**
 * Decide whether a command may run. Return true to run it. Return false, or a
 * string giving the reason, to reject it; the model sees the rejection.
 */
export type Approve = (command: string, signal: AbortSignal) => boolean | string | Promise<boolean | string>;
/** The guard against accidents. It is not a sandbox. */
export declare function deniedReason(command: string): string | undefined;
/**
 * Run one command with `bash -c` in its own process group. Cancellation and
 * the timeout kill the whole group. A timeout rejects with a ToolError holding
 * the output so far and a final line `[timed out after N s]`.
 */
export declare function runBash(command: string, signal?: AbortSignal, options?: BashOptions): Promise<string>;
/**
 * The guarded bash tool. `approve` is asked before each command the blacklist
 * lets through; it is a `beforeTool` hook for this one tool.
 */
export declare function bashTool(options?: BashOptions & {
    approve?: Approve;
}): Tool;
