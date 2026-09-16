import {
  GetPackStatusesResponse,
  UpdatePackStatusBody,
  UpdatePackStatusParams,
  UpdatePackStatusResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import {
  getSharedPackStatuses,
  saveSharedPackStatus,
} from "../lib/pack-statuses";
import { requireLogin, requireRole } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/pack-status", requireLogin, async (_req, res): Promise<void> => {
  const statuses = await getSharedPackStatuses();
  res.set("Cache-Control", "no-store");
  res.json(GetPackStatusesResponse.parse({ statuses }));
});

router.put(
  "/pack-status/:orderId",
  requireRole("editor"),
  async (req, res): Promise<void> => {
  const parsedParams = UpdatePackStatusParams.safeParse(req.params);
  if (!parsedParams.success || !parsedParams.data.orderId.trim()) {
    res.status(400).json({ error: "A valid order ID is required." });
    return;
  }

  const parsedBody = UpdatePackStatusBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  const status = await saveSharedPackStatus(
    parsedParams.data.orderId.trim(),
    parsedBody.data.packStartedAt,
  );
  res.set("Cache-Control", "no-store");
  res.json(UpdatePackStatusResponse.parse(status));
  },
);

export default router;