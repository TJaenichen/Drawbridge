import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTailer, type AuditLine } from "../src/monitor/tail.js";

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), "drawbridge-tail-")), "audit.jsonl");
}

describe("createTailer", () => {
  it("replays existing complete lines on the first poll", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n{"i":2}\n');
    const seen: AuditLine[] = [];
    createTailer(file, (r) => seen.push(r)).poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2]);
    rmSync(file, { force: true });
  });

  it("emits lines appended after the previous poll", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n');
    const seen: AuditLine[] = [];
    const t = createTailer(file, (r) => seen.push(r));
    t.poll();
    appendFileSync(file, '{"i":2}\n{"i":3}\n');
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2, 3]);
    rmSync(file, { force: true });
  });

  it("buffers a partial trailing line until its newline arrives", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n{"i":2', "utf8"); // second line has no newline yet
    const seen: AuditLine[] = [];
    const t = createTailer(file, (r) => seen.push(r));
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([1]); // partial line not emitted
    appendFileSync(file, '}\n');
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2]);
    rmSync(file, { force: true });
  });

  it("skips malformed lines via onMalformed and keeps going", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\nnot json\n{"i":2}\n');
    const seen: AuditLine[] = [];
    const bad: string[] = [];
    createTailer(file, (r) => seen.push(r), { onMalformed: (l) => bad.push(l) }).poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2]);
    expect(bad).toEqual(["not json"]);
    rmSync(file, { force: true });
  });

  it("waits for a file that doesn't exist yet (no throw)", () => {
    const file = tmpFile();
    rmSync(file, { force: true }); // ensure absent
    const seen: AuditLine[] = [];
    const t = createTailer(file, (r) => seen.push(r));
    expect(() => t.poll()).not.toThrow();
    expect(seen).toEqual([]);
    writeFileSync(file, '{"i":7}\n');
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([7]);
    rmSync(file, { force: true });
  });

  it("recovers when the file is truncated/rotated under it", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n{"i":2}\n');
    const seen: AuditLine[] = [];
    const t = createTailer(file, (r) => seen.push(r));
    t.poll();
    truncateSync(file, 0); // rotation: file shrinks
    writeFileSync(file, '{"i":9}\n');
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2, 9]);
    rmSync(file, { force: true });
  });

  it("skips blank/whitespace-only lines without calling onMalformed", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n\n   \n{"i":2}\n');
    const seen: AuditLine[] = [];
    const bad: string[] = [];
    createTailer(file, (r) => seen.push(r), { onMalformed: (l) => bad.push(l) }).poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2]);
    expect(bad).toEqual([]);
    rmSync(file, { force: true });
  });

  it("advances cumulatively across three separate appends (offset is not reset)", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n');
    const seen: AuditLine[] = [];
    const t = createTailer(file, (r) => seen.push(r));
    t.poll();
    appendFileSync(file, '{"i":2}\n{"i":3}\n');
    t.poll();
    appendFileSync(file, '{"i":4}\n{"i":5}\n');
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([1, 2, 3, 4, 5]);
    rmSync(file, { force: true });
  });

  it("emits nothing on a poll when the file hasn't changed (no duplicates)", () => {
    const file = tmpFile();
    writeFileSync(file, '{"i":1}\n');
    const seen: AuditLine[] = [];
    const t = createTailer(file, (r) => seen.push(r));
    t.poll();
    t.poll(); // unchanged
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([1]);
    rmSync(file, { force: true });
  });

  it("drops a single unterminated line larger than the cap (OOM guard) and keeps going", () => {
    const file = tmpFile();
    writeFileSync(file, "x".repeat((1 << 20) + 16)); // > 1 MiB, no newline
    const seen: AuditLine[] = [];
    const bad: string[] = [];
    const t = createTailer(file, (r) => seen.push(r), { onMalformed: (l) => bad.push(l) });
    t.poll();
    expect(seen).toEqual([]);
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain("oversize");
    appendFileSync(file, '\n{"i":5}\n'); // the next real line still streams
    t.poll();
    expect(seen.map((r) => r.i)).toEqual([5]);
    rmSync(file, { force: true });
  });
});
