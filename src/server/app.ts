import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { isDomainError } from "../domain/errors.ts";
import { Store } from "../domain/store.ts";

const createGroupSchema = z.object({
  id: z.string().optional(),
  project: z.string(),
  destination: z.string().optional(),
  totalVolumes: z.number(),
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

export interface AppOptions {
  enableTestRoutes?: boolean;
}

export function createApp(store: Store, options: AppOptions = {}): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (options.enableTestRoutes) {
    app.post("/api/test/reset", (_req, res) => {
      store.reset();
      res.json({ ok: true });
    });
  }

  app.get("/api/board", (_req, res) => {
    res.json(store.board());
  });

  app.post("/api/groups", (req, res) => {
    const input = createGroupSchema.parse(req.body);
    res.status(201).json(store.addGroup(input));
  });

  app.delete("/api/groups/:id", (req, res) => {
    store.deleteGroup(req.params.id);
    res.json(store.board());
  });

  app.post("/api/move", (req, res) => {
    const { ticketId, sheetId, slot } = moveSchema.parse(req.body);
    res.json(store.move(ticketId, sheetId, slot));
  });

  app.post("/api/key-move", (req, res) => {
    const { ticketId, direction } = keyMoveSchema.parse(req.body);
    res.json(store.keyMove(ticketId, direction));
  });

  app.post("/api/auto-arrange", (_req, res) => {
    res.json(store.autoArrange());
  });

  app.post("/api/print", async (req, res) => {
    const { idempotencyKey } = printSchema.parse(req.body);
    res.json(await store.print(idempotencyKey));
  });

  app.get("/api/batches", (_req, res) => {
    res.json({ batches: store.listBatches() });
  });

  app.get("/api/batches/:id", (req, res) => {
    res.json({ batch: store.getBatch(req.params.id) });
  });

  app.get("/api/batches/:id/pdf", (req, res) => {
    const bytes = store.getPdf(req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${req.params.id}.pdf"`);
    res.send(Buffer.from(bytes));
  });

  app.delete("/api/batches/:id", (req, res) => {
    store.deleteBatch(req.params.id);
    res.json({ batches: store.listBatches() });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
