import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.ts";
import { pingDb } from "../db/index.ts";
import { R } from "../runtime.ts";

export function healthRouter(): Router {
  const router = Router();

  router.get(
    "/",
    asyncHandler(async (_req, res) => {
      const db = await R().getDb();
      try {
        await pingDb(db);
      } catch (e: unknown) {
        const message = String((e as { message?: string })?.message || e);
        res.status(503).json({
          ok: false,
          engine: db.engine,
          db: "down",
          error: message,
        });
        return;
      }
      res.json({
        ok: true,
        engine: db.engine,
        db: "up",
      });
    })
  );

  return router;
}
