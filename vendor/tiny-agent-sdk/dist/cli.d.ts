import type { Readable, Writable } from "node:stream";
import { type Provider } from "./types.ts";
/** What the command line was given. The process's own values are read only where this file is the program. */
export interface CliOptions {
    /** Arguments after the program name. */
    argv: string[];
    env: Record<string, string | undefined>;
    /** Replaces the provider chosen by TINYAGENT_PROVIDER. */
    provider?: Provider;
    stdin?: Readable;
    stdout?: Writable;
    stderr?: Writable;
}
/** The coding CLI as a function. It resolves to the exit code. */
export declare function runCli(options: CliOptions): Promise<number>;
