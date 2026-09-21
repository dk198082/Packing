import {
  UpdateSystemOrderPrioritiesBody,
  UpdateSystemOrderPrioritiesResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getPackingOrders } from "../lib/packing-source";
import { replaceSystemOrderPriorities } from "../lib/system-order-priorities";
import { requireRole } from "../middlewares/auth";

const router: IRouter = Router();

router.put(
  "/system-order-priorities",
  requireRole("editor"),
  async (req, res): Promise<void> => {
    const parsedBody = UpdateSystemOrderPrioritiesBody.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: parsedBody.error.message });
      return;
    }

    const requestedOrderIds = parsedBody.data.orderIds;
    if (new Set(requestedOrderIds).size !== requestedOrderIds.length) {
      res.status(400).json({ error: "Each System order must appear once." });
      return;
    }

    const currentOrders = await getPackingOrders();
    const currentSystemOrderIds = currentOrders.orders
      .filter((order) => order.team === "SYSTEM")
      .map((order) => order.id);
    const currentSet = new Set(currentSystemOrderIds);
    const matchesCurrentSchedule =
      requestedOrderIds.length === currentSystemOrderIds.length &&
      requestedOrderIds.every((orderId) => currentSet.has(orderId));

    if (!matchesCurrentSchedule) {
      res.status(409).json({
        error:
          "The System schedule changed. Refresh the board before reordering.",
      });
      return;
    }

    const result = await replaceSystemOrderPriorities(
      requestedOrderIds,
      parsedBody.data.expectedRevision?.toISOString() ?? null,
    );
    if (result.priorities.length === 0) {
      res.status(409).json({
        error:
          "Priorities changed in another session. Refresh before reordering.",
      });
      return;
    }
    res.set("Cache-Control", "no-store");
    res.json(UpdateSystemOrderPrioritiesResponse.parse(result));
  },
);

export default router;
