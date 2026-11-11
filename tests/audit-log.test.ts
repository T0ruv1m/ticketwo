import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlAuditLog } from "../src/server/audit-log.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("JsonlAuditLog", () => {
  it("appends one self-contained record per printed batch", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tickets-audit-"));
    directories.push(directory);
    const audit = new JsonlAuditLog(path.join(directory, "nested", "prints.jsonl"));

    await audit.append({
      id: "batch-1",
      printedAt: "2026-11-11T12:00:00.000Z",
      pdfHash: "hash",
      tickets: [{
        ticketId: "t:G1:1",
        groupId: "G1",
        project: "ACME",
        destination: "Berlin",
        kind: "grid",
        volumeIndex: 1,
        totalVolumes: 1,
        nfeNumber: "521604",
        nfeAccessKey: "31240100874929000140550010005216041964324179",
        afOs: "AF 123/2026",
        empenho: "NE 456/2026",
      }],
    });

    const lines = (await readFile(path.join(directory, "nested", "prints.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      type: "print",
      schemaVersion: 1,
      id: "batch-1",
      tickets: [{ afOs: "AF 123/2026", empenho: "NE 456/2026" }],
    });
  });
});
