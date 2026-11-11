import { type Item } from "./types.ts";
export declare const MAX_SSE_BYTES = 1048576;
export interface HttpRequestOptions {
    /** The API root, such as "https://gateway.example/v1". The provider appends its own path. */
    baseUrl?: string;
    /** The complete URL of the endpoint. Wins over `baseUrl`. */
    endpoint?: string;
    /** Extra request headers. One named like the API key header replaces it. */
    headers?: Record<string, string>;
    /** A JSON object merged into every request body after TinyAgent's own fields. */
    extra?: Item;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
}
/** Complete arguments stay bounded across individually small deltas. */
export declare class Arguments {
    private parts;
    private bytes;
    append(value: string): void;
    set(value: string): void;
    value(): string;
}
export declare function objectValue(value: unknown, name: string): Item;
export declare function stringValue(value: Item, key: string, required?: boolean): string;
export declare function indexValue(value: unknown): number;
export declare function objectArray(value: unknown, name: string): Item[];
export declare function parseObject(source: string): Item;
export declare function httpSseEvents(endpoint: string, payload: Item, headers: Record<string, string>, signal: AbortSignal, options?: HttpRequestOptions, 
/** Yielded for a closing `data: [DONE]`. Without it that marker means the stream was cut short. */
done?: Item): AsyncGenerator<Item>;
