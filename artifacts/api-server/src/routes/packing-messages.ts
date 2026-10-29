import { Router, type IRouter, type RequestHandler } from "express";
import {
  AcknowledgePackingMessageParams,
  AcknowledgePackingMessageResponse,
  CreatePackingMessageBody,
  CreatePackingMessageResponse,
  GetPackingMessagesResponse,
} from "@workspace/api-zod";
import { requireLogin, requireRole } from "../middlewares/auth";
import {
  listPackingMessages,
  createPackingMessage,
  acknowledgePackingMessage,
  MessageBoardError,
} from "../lib/packing-messages";

export interface MessageRouterDependencies {
  login: RequestHandler;
  editor: RequestHandler;
  acknowledger: RequestHandler;
  list: typeof listPackingMessages;
  create: typeof createPackingMessage;
  acknowledge: typeof acknowledgePackingMessage;
}

const defaults: MessageRouterDependencies = {
  login: requireLogin,
  editor: requireRole("editor"),
  acknowledger: requireRole("editor", "viewer"),
  list: listPackingMessages,
  create: createPackingMessage,
  acknowledge: acknowledgePackingMessage,
};

export function createPackingMessagesRouter(
  dependencies: MessageRouterDependencies = defaults,
): IRouter {
  const router: IRouter = Router();
  router.use("/messages", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/messages", dependencies.login, async (req, res) => {
    try {
      res.json(GetPackingMessagesResponse.parse({ messages: await dependencies.list() }));
    } catch {
      req.log.error("Message board read unavailable");
      res.status(503).json({ message: "Messages could not be loaded. Please retry." });
    }
  });

  router.post("/messages", dependencies.editor, async (req, res) => {
    const parsed = CreatePackingMessageBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.content.trim()) {
      res.status(400).json({ message: "Enter a message between 1 and 200 characters." });
      return;
    }
    try {
      const message = await dependencies.create(parsed.data.content.trim(), req.session.user!);
      res.status(201).json(CreatePackingMessageResponse.parse(message));
    } catch {
      req.log.error("Message could not be saved");
      res.status(503).json({ message: "Message was not confirmed saved. Your draft has been kept. Refresh the board before retrying." });
    }
  });

  router.post("/messages/:messageId/acknowledgments", dependencies.acknowledger, async (req, res) => {
    const parsed = AcknowledgePackingMessageParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ message: "A valid message ID is required." });
      return;
    }
    try {
      const message = await dependencies.acknowledge(parsed.data.messageId, req.session.user!);
      res.json(AcknowledgePackingMessageResponse.parse(message));
    } catch (error) {
      if (error instanceof MessageBoardError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      req.log.error("Message acknowledgment could not be saved");
      res.status(503).json({ message: "OK was not confirmed saved. Please retry." });
    }
  });

  return router;
}

export default createPackingMessagesRouter();
