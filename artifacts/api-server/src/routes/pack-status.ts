import {
  GetPackStatusesResponse,
  UpdatePackStatusBody,
  UpdatePackStatusParams,
  UpdatePackStatusResponse,
  MarkOrderPackedBody,
  MarkOrderPackedParams,
  MarkOrderPackedResponse,
  EditOrderPackedBody,
  EditOrderPackedParams,
  EditOrderPackedResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  getSharedPackStatuses,
  saveSharedPackStatus,
  markSharedOrderPacked,
  editSharedOrderPacked,
} from "../lib/pack-statuses";
import { requireLogin, requireRole } from "../middlewares/auth";
import { getPackingOrders } from "../lib/packing-source";
import { z } from "zod";

interface PackStatusDependencies {
  login: RequestHandler;
  editor: RequestHandler;
  completer: RequestHandler;
  list: typeof getSharedPackStatuses;
  save: typeof saveSharedPackStatus;
  complete: typeof markSharedOrderPacked;
  editPacked: typeof editSharedOrderPacked;
  orders: typeof getPackingOrders;
}

export function createPackStatusRouter(deps: PackStatusDependencies = {
  login: requireLogin, editor: requireRole("editor"),
  completer: requireRole("editor", "viewer"),
  list: getSharedPackStatuses, save: saveSharedPackStatus,
  complete: markSharedOrderPacked, orders: getPackingOrders,
  editPacked: editSharedOrderPacked,
}): IRouter {
const router: IRouter = Router();

router.get("/pack-status", deps.login, async (_req, res): Promise<void> => {
  const statuses = await deps.list();
  res.set("Cache-Control", "no-store");
  res.json(GetPackStatusesResponse.parse({ statuses }));
});

router.put(
  "/pack-status/:orderId",
  deps.completer,
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

  const startOnly = req.session.user?.role !== "editor";
  if (startOnly && parsedBody.data.packStartedAt === null) {
    res.status(403).json({ error: "Read/Write access is required to reset Pack Started." });
    return;
  }
  const status = await deps.save(
    parsedParams.data.orderId.trim(),
    startOnly ? new Date() : parsedBody.data.packStartedAt,
    startOnly,
  );
  res.set("Cache-Control", "no-store");
  res.json(UpdatePackStatusResponse.parse(status));
  },
);

router.post("/pack-status/:orderId/packed", deps.completer, async (req, res): Promise<void> => {
  const params = MarkOrderPackedParams.safeParse(req.params);
  const body = MarkOrderPackedBody.safeParse(req.body);
  if (!params.success || !params.data.orderId.trim() || !body.success) {
    res.status(400).json({ error: "A valid order ID and completion trigger are required." });
    return;
  }
  try {
    const result = await deps.orders();
    const order = result.orders.find(item => item.id === params.data.orderId);
    if (!order) {
      res.status(404).json({ error: "Order is no longer on the packing board." });
      return;
    }
    if ((order.team === "PARTS" && body.data.trigger !== "label") ||
        (order.team === "SYSTEM" && body.data.trigger !== "manual")) {
      res.status(400).json({ error: "Parts orders are packed by label printing; System orders use Finish Pack." });
      return;
    }
    const status = await deps.complete(order.id);
    res.set("Cache-Control", "no-store");
    res.json(MarkOrderPackedResponse.parse(status));
  } catch {
    req.log.error("Packed status could not be saved");
    res.status(503).json({ error: "PACKED was not confirmed saved. Please retry." });
  }
});
router.put("/pack-status/:orderId/packed", deps.completer, async (req, res): Promise<void> => {
  const params = EditOrderPackedParams.safeParse(req.params);
  // Codegen coerces dates (including numeric values), so enforce the wire
  // contract before converting the ISO timestamp to a Date.
  const wireTimestamp = z.string().datetime({ offset: true }).nullable().safeParse(req.body?.packedAt);
  const body = EditOrderPackedBody.safeParse(req.body);
  if (!params.success || !params.data.orderId.trim() || !wireTimestamp.success || !body.success) {
    res.status(400).json({ error: "A valid order ID and packed date/time (or null to clear) are required." });
    return;
  }
  try {
    const result = await deps.orders();
    if (!result.orders.some(order => order.id === params.data.orderId)) {
      res.status(404).json({ error: "Order is no longer on the packing board." });
      return;
    }
    const status = await deps.editPacked(params.data.orderId, body.data.packedAt);
    res.set("Cache-Control", "no-store");
    res.json(EditOrderPackedResponse.parse(status));
  } catch {
    req.log.error("Packed date/time could not be updated");
    res.status(503).json({ error: "PACKED change was not confirmed saved. Please retry." });
  }
});
return router;
}

export default createPackStatusRouter();