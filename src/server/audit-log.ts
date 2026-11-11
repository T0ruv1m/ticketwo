import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Batch } from "../domain/types.ts";
import type { PrintAuditLog } from "../domain/store.ts";

/** An append-only, newline-delimited JSON audit log for completed print batches. */
export class JsonlAuditLog implements PrintAuditLog {
  constructor(private readonly filePath: string) {}

  async append(batch: Batch): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify({ type: "print", schemaVersion: 1, ...batch })}\n`,
      "utf8",
    );
  }
}
