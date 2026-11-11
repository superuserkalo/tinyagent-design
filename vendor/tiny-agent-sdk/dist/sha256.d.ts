/**
 * SHA-256 of a string's UTF-8 bytes, as lowercase hex. The Session uses it for
 * the digests in its journal (the agent configuration, a compaction's history),
 * which are computed synchronously and must match what node:crypto wrote, in a
 * runtime that has no node:crypto. Web Crypto's digest is asynchronous only.
 * FIPS 180-4, section 6.2.
 */
export declare function sha256Hex(text: string): string;
