import { GetPackingOrdersResponse } from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { getPackingOrders } from "../lib/packing-source";
import { getSharedPackStatuses } from "../lib/pack-statuses";
import { getOrCreateInPackingEntryTimes } from "../lib/in-packing-entries";
import { requireLogin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/packing-orders", requireLogin, async (req, res) => {
  try {
    const [result, statuses] = await Promise.all([
      getPackingOrders(),
      getSharedPackStatuses(),
    ]);
    const packStartedAtByOrderId = new Map(
      statuses.map((status) => [status.orderId, status.packStartedAt]),
    );
    const inPackingAtByOrderId = await getOrCreateInPackingEntryTimes(
      result.orders.map((order) => ({
        orderId: order.id,
        sourceModifiedAt: order.sourceModifiedAt,
      })),
    );
    const response = {
      ...result,
      orders: result.orders.map(({ sourceModifiedAt: _sourceModifiedAt, ...order }) => ({
        ...order,
        inPackingAt: inPackingAtByOrderId.get(order.id) ?? result.fetchedAt,
        packStartedAt: packStartedAtByOrderId.get(order.id) ?? null,
      })),
    };
    res.set("Cache-Control", "no-store");
    res.json(GetPackingOrdersResponse.parse(response));
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "unknown";
    req.log.error({ code }, "Live packing source unavailable");
    res.status(503).json({
      message:
        "The live packing source is currently unavailable. Please retry the sync.",
    });
  }
});

export default router;