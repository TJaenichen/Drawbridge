import { closeSync, openSync, readSync, statSync } from "node:fs";

/** One parsed audit record (JSONL line). The monitor forwards these verbatim. */
export type AuditLine = Record<string, unknown>;

export interface Tailer {
  /** Read whatever has been appended since the last call, emitting complete lines. */
  poll(): void;
  /** Begin polling on an interval (no-op if already started). */
  start(): void;
  /** Stop polling and release the interval. */
  stop(): void;
}

export interface TailOptions {
  /** Called for a line that isn't valid JSON or is dropped for being oversize (skipped, not fatal). */
  onMalformed?: (line: string) => void;
  /** Poll cadence in ms (default 250). */
  pollMs?: number;
}

/** Read at most this many bytes per poll; the rest follows on the next tick. */
const MAX_READ_BYTES = 4 << 20; // 4 MiB
/** Drop an unterminated line longer than this — a guard against a local OOM vector. */
const MAX_LINE_BYTES = 1 << 20; // 1 MiB (audit records carry no bodies, §10, so this is generous)

/**
 * Tail an append-only JSONL file: replay existing complete lines, then emit each new
 * line as it is appended. Polling-based (robust across platforms, incl. Windows where
 * fs.watch is flaky for appends). Tolerant of: a file that doesn't exist yet (waits for
 * it), partial trailing lines (buffered until their newline arrives, never splitting a
 * multibyte char — we only decode up to a newline boundary), truncation/rotation
 * (offset resets when the file shrinks), and malformed lines (skipped via onMalformed).
 *
 * The monitor only ever READS the audit log — this is the whole of its file access.
 */
export function createTailer(file: string, onRecord: (record: AuditLine) => void, opts: TailOptions = {}): Tailer {
  const pollMs = opts.pollMs ?? 250;
  let offset = 0;
  let leftover = Buffer.alloc(0);
  let inode: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const emit = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onRecord(JSON.parse(trimmed) as AuditLine);
    } catch {
      opts.onMalformed?.(trimmed);
    }
  };

  const reset = (): void => {
    offset = 0;
    leftover = Buffer.alloc(0);
  };

  const poll = (): void => {
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(file);
    } catch {
      return; // not created yet — try again next poll
    }
    // Rotation: a new file (rename/recreate, inode changes) or a truncation (size shrinks).
    if (inode !== undefined && st.ino !== inode) reset();
    else if (st.size < offset) reset();
    inode = st.ino;
    if (st.size <= offset) return;

    let fd: number;
    try {
      fd = openSync(file, "r"); // may race with an unlink between stat and open
    } catch {
      return; // gone again — retry next poll
    }
    try {
      const want = Math.min(st.size - offset, MAX_READ_BYTES); // bound the per-poll read
      const buf = Buffer.alloc(want);
      const read = readSync(fd, buf, 0, want, offset);
      offset += read;
      let data = Buffer.concat([leftover, buf.subarray(0, read)]);
      let nl: number;
      while ((nl = data.indexOf(0x0a)) !== -1) {
        emit(data.subarray(0, nl).toString("utf8"));
        data = data.subarray(nl + 1);
      }
      if (data.length > MAX_LINE_BYTES) {
        // A single unterminated line over the cap — drop it rather than buffer unboundedly.
        opts.onMalformed?.(`<dropped oversize line: ${data.length} bytes>`);
        data = Buffer.alloc(0);
      }
      leftover = data; // unterminated tail, completed on a later poll
    } catch {
      return; // transient read error — retry next poll
    } finally {
      closeSync(fd);
    }
  };

  return {
    poll,
    start() {
      if (timer) return;
      poll();
      timer = setInterval(poll, pollMs);
      timer.unref?.(); // don't keep the process alive on our account
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
