import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { isDomainError } from "../domain/errors.ts";
import { DEFAULT_PROJECT, isKnownProject } from "../shared/picklists.ts";
import { normalizeAccessKey, NfeLookupError, type NfeLookupClient } from "./nfe.ts";
import type { Sessions } from "./sessions.ts";

const nfeBatchSchema = z.object({
  code: z.string(),
  expiry: z.string(),
  quantity: z.number(),
});

const createGroupSchema = z.object({
  id: z.string().optional(),
  project: z.string(),
  destination: z.string().optional(),
  totalVolumes: z.number(),
  nfeNumber: z.string().optional(),
  batches: z.array(nfeBatchSchema).optional(),
  // Manually typed batch codes; no lookup metadata exists for them.
  codes: z.array(z.string()).optional(),
});

const moveSchema = z.object({
  ticketId: z.string(),
  sheetId: z.string(),
  slot: z.number(),
});

const keyMoveSchema = z.object({
  ticketId: z.string(),
  direction: z.enum(["left", "right", "up", "down", "page-up", "page-down"]),
});

const printSchema = z.object({
  idempotencyKey: z.string(),
});

export const PROJECT_COOKIE = "project";

/** The board a request belongs to, from its cookie. Unknown values fall back. */
export function projectFrom(req: Request): string {
  const header = req.headers.cookie;
  if (!header) return DEFAULT_PROJECT;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== PROJECT_COOKIE) continue;
    let value = "";
    try {
      value = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      value = "";
    }
    return isKnownProject(value) ? value : DEFAULT_PROJECT;
  }
  return DEFAULT_PROJECT;
}

export interface AppOptions {
  enableTestRoutes?: boolean;
  nfeClient?: NfeLookupClient;
}

export function createApp(sessions: Sessions, options: AppOptions = {}): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/nfe/:key", async (req, res, next) => {
    const nfe = options.nfeClient;
    if (!nfe) {
      res.status(503).json({ error: { code: "nfe-disabled", message: "nfe-lookup is not configured" } });
      return;
    }
    try {
      const key = normalizeAccessKey(req.params.key ?? "");
      res.json(await nfe.lookup(key));
    } catch (error) {
      next(error);
    }
  });

  if (options.enableTestRoutes) {
    app.post("/api/test/reset", (_req, res) => {
      sessions.reset();
      res.json({ ok: true });
    });
  }

  app.get("/api/board", (req, res) => {
    res.json(sessions.forProject(projectFrom(req)).board());
  });

  app.post("/api/groups", (req, res) => {
    const project = projectFrom(req);
    const store = sessions.forProject(project);
    const input = createGroupSchema.parse({ ...req.body, project });
    if (input.codes?.length) {
      const known = new Set((input.batches ?? []).map((batch) => batch.code));
      input.batches = [
        ...(input.batches ?? []),
        ...input.codes.filter((code) => !known.has(code)).map((code) => ({ code, expiry: "", quantity: 0 })),
      ];
    }
    res.status(201).json(store.addGroup(input));
  });

  app.delete("/api/groups/:id", (req, res) => {
    const store = sessions.forProject(projectFrom(req));
    store.deleteGroup(req.params.id);
    res.json(store.board());
  });

  app.post("/api/move", (req, res) => {
    const { ticketId, sheetId, slot } = moveSchema.parse(req.body);
    res.json(sessions.forProject(projectFrom(req)).move(ticketId, sheetId, slot));
  });

  app.post("/api/key-move", (req, res) => {
    const { ticketId, direction } = keyMoveSchema.parse(req.body);
    res.json(sessions.forProject(projectFrom(req)).keyMove(ticketId, direction));
  });

  app.post("/api/auto-arrange", (req, res) => {
    res.json(sessions.forProject(projectFrom(req)).autoArrange());
  });

  app.post("/api/print", async (req, res) => {
    const { idempotencyKey } = printSchema.parse(req.body);
    res.json(await sessions.forProject(projectFrom(req)).print(idempotencyKey));
  });

  app.get("/api/batches", (req, res) => {
    res.json({ batches: sessions.forProject(projectFrom(req)).listBatches() });
  });

  app.get("/api/batches/:id", (req, res) => {
    res.json({ batch: sessions.forProject(projectFrom(req)).getBatch(req.params.id) });
  });

  app.get("/api/batches/:id/pdf", (req, res) => {
    const bytes = sessions.forProject(projectFrom(req)).getPdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${req.params.id}.pdf"`);
    res.send(Buffer.from(bytes));
  });

  app.delete("/api/batches/:id", (req, res) => {
    const store = sessions.forProject(projectFrom(req));
    store.deleteBatch(req.params.id);
    res.json({ batches: store.listBatches() });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof NfeLookupError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (isDomainError(error)) {
      res.status(400).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: { code: "invalid-request", message: error.message } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: "internal", message: "internal error" } });
  });

  const uiDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../dist/ui");
  if (existsSync(uiDir)) {
    app.use(express.static(uiDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(uiDir, "index.html"));
    });
  }

  return app;
}
