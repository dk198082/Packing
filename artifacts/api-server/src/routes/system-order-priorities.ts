import { Router, type IRouter } from "express";
import { requireRole } from "../middlewares/auth";

const router: IRouter = Router();

// Reject stale clients rather than silently accepting manual rankings.
router.put("/system-order-priorities", requireRole("editor"), (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.status(410).json({
    error: "Manual priorities are no longer supported. System priorities are calculated automatically by Ship Date, then Sales Order number.",
  });
});

export default router;