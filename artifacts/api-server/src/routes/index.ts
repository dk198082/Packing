import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import packingOrdersRouter from "./packing-orders";
import packStatusRouter from "./pack-status";
import systemOrderPrioritiesRouter from "./system-order-priorities";
import packingMessagesRouter from "./packing-messages";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(packingOrdersRouter);
router.use(packStatusRouter);
router.use(systemOrderPrioritiesRouter);
router.use(packingMessagesRouter);

export default router;
