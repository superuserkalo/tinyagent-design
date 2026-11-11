// Everything that needs the file system: FileStorage, and the Session that accepts a `directory`.
// Node only. The browser entry does not import this file.
import { createHash } from "node:crypto";
import { openSync, closeSync, readSync, fstatSync, statSync, writeSync, ftruncateSync, fsyncSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Session as BaseSession } from "./session.js";
import { FencedError, SessionBusyError, SessionCorruptionError } from "./storage.js";
import { isItem } from "./types.js";
const SESSION_FILE = /^(s_[a-zA-Z0-9_-]{1,100})\.jsonl$/;
/**
 * One open journal file and its writer lock. The lock is native and released
 * by the operating system when the process exits, including a crash. It makes
 * a second writer fail fast; the fenced append is what keeps the journal correct.
 */
class Journal {
    file;
    lock;
    offset = 0;
    failed = false;
    count = 0;
    constructor(path, create) {
        // Loaded on first durable use: Node 22 prints an experimental warning for
        // node:sqlite, which importing the SDK or an in-memory session should not trigger.
        const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
        this.lock = new DatabaseSync(`${path}.lock`);
        try {
            this.lock.exec("BEGIN EXCLUSIVE");
        }
        catch (error) {
            this.lock.close();
            throw new SessionBusyError("session is open in another writer", { cause: error });
        }
        try {
            this.file = openSync(path, create ? "wx+" : "r+", 0o600);
            if (create && process.platform !== "win32") {
                const directory = openSync(dirname(path), "r");
                try {
                    fsyncSync(directory);
                }
                finally {
                    closeSync(directory);
                }
            }
        }
        catch (error) {
            this.close();
            throw isItem(error) && error.code === "EEXIST" ? new FencedError("session already exists") : error;
        }
    }
    /** Every complete record. A torn final record, left by a crash mid-write, is discarded. */
    read() {
        if (this.file === undefined)
            throw new Error("journal is closed");
        const data = Buffer.alloc(fstatSync(this.file).size);
        for (let done = 0; done < data.length;) {
            const count = readSync(this.file, data, done, data.length - done, done);
            if (!count)
                throw new Error("session read made no progress");
            done += count;
        }
        const end = data.lastIndexOf(0x0a) + 1;
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const records = [];
        let start = 0;
        while (start < end) {
            const newline = data.indexOf(0x0a, start);
            try {
                const envelope = JSON.parse(decoder.decode(data.subarray(start, newline)));
                if (!isItem(envelope) || typeof envelope.payload !== "string" ||
                    envelope.sha256 !== createHash("sha256").update(envelope.payload).digest("hex"))
                    throw new Error("invalid checksum");
                const record = JSON.parse(envelope.payload);
                if (!isItem(record) || record.sequence !== records.length + 1)
                    throw new Error("invalid record");
                records.push(record);
            }
            catch (error) {
                throw new SessionCorruptionError(`invalid session record ${records.length + 1}`, { cause: error });
            }
            start = newline + 1;
        }
        if (end !== data.length) {
            ftruncateSync(this.file, end);
            fsyncSync(this.file);
        }
        this.offset = end;
        this.count = records.length;
        return records;
    }
    write(record) {
        if (this.failed || this.file === undefined)
            throw new Error("journal is closed or failed; reopen the session");
        if (fstatSync(this.file).size !== this.offset)
            throw new FencedError();
        const payload = JSON.stringify(record);
        const encoded = Buffer.from(`${JSON.stringify({ payload, sha256: createHash("sha256").update(payload).digest("hex") })}\n`);
        try {
            let written = 0;
            while (written < encoded.length) {
                const count = writeSync(this.file, encoded, written, encoded.length - written, this.offset + written);
                if (!count)
                    throw new Error("session write made no progress");
                written += count;
            }
            fsyncSync(this.file);
            this.offset += written;
            this.count += 1;
        }
        catch (error) {
            this.failed = true;
            throw error;
        }
    }
    close() {
        if (this.file !== undefined) {
            closeSync(this.file);
            this.file = undefined;
        }
        if (this.lock.isOpen)
            this.lock.close();
    }
}
/**
 * One append-only JSONL file per session in `directory`, each record with a
 * SHA-256, plus a lock file per session. Constructing it touches nothing.
 */
export class FileStorage {
    directory;
    journals = new Map();
    constructor(directory) {
        this.directory = directory;
    }
    open(sessionId, create) {
        if (!SESSION_FILE.test(`${sessionId}.jsonl`))
            throw new TypeError("invalid session ID");
        const path = join(this.directory, `${sessionId}.jsonl`);
        if (create)
            mkdirSync(this.directory, { recursive: true });
        else {
            // Checked first so a mistyped ID fails without leaving a lock file behind.
            try {
                statSync(path);
            }
            catch (error) {
                if (isItem(error) && error.code === "ENOENT")
                    return undefined;
                throw error;
            }
        }
        const journal = new Journal(path, create);
        this.journals.set(sessionId, journal);
        return journal;
    }
    load(sessionId) {
        const journal = this.journals.get(sessionId) ?? this.open(sessionId, false);
        try {
            return journal?.read();
        }
        catch (error) {
            this.release(sessionId);
            throw error;
        }
    }
    append(sessionId, expected, record) {
        let journal = this.journals.get(sessionId);
        if (!journal) {
            journal = this.open(sessionId, expected === 0);
            if (!journal)
                throw new FencedError("session does not exist");
            if (expected)
                this.load(sessionId);
        }
        if (journal.count !== expected)
            throw new FencedError();
        journal.write({ ...record, sequence: expected + 1 });
        return expected + 1;
    }
    list() {
        try {
            return readdirSync(this.directory).flatMap((name) => SESSION_FILE.exec(name)?.[1] ?? []).sort();
        }
        catch (error) {
            if (isItem(error) && error.code === "ENOENT")
                return [];
            throw error;
        }
    }
    release(sessionId) {
        this.journals.get(sessionId)?.close();
        this.journals.delete(sessionId);
    }
}
/**
 * The Session of session.ts, plus what needs files: the `directory` option,
 * `Session.open` and `Session.list`. This is the Session the package's main
 * entry exports.
 */
export class Session extends BaseSession {
    static directoryStorage(directory) {
        return new FileStorage(directory);
    }
    static open(agent, directory, sessionId, budget) {
        return new Session(agent, { directory, sessionId, resume: true, budget });
    }
    static list(directory) {
        return new FileStorage(directory).list();
    }
}
