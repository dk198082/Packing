import { Router, type IRouter, type RequestHandler } from "express";
import {
  AcknowledgePackingMessageParams,
  AcknowledgePackingMessageResponse,
  CreatePackingMessageBody,
  CreatePackingMessageResponse,
  GetPackingMessagesResponse,
  ResetPackingMessageParams,
  ResetPackingMessageResponse,
  RemovePackingMessageParams,
  GetMessageRecipientsResponse,
} from "@workspace/api-zod";
import { requireLogin, requireRole } from "../middlewares/auth";
import {
  listPackingMessages,
  createPackingMessage,
  acknowledgePackingMessage,
  resetPackingMessage,
  removePackingMessage,
  rememberMessageUser,
  getKnownMessageUsers,
  MessageBoardError,
} from "../lib/packing-messages";
import { authorizeWithAdminConsole, AccessDeniedError } from "../lib/auth";

export interface MessageRouterDependencies {
  login: RequestHandler;
  editor: RequestHandler;
  acknowledger: RequestHandler;
  list: typeof listPackingMessages;
  create: typeof createPackingMessage;
  acknowledge: typeof acknowledgePackingMessage;
  reset: typeof resetPackingMessage;
  remove: typeof removePackingMessage;
  remember: typeof rememberMessageUser;
  users: typeof getKnownMessageUsers;
  authorizeRecipient: typeof authorizeWithAdminConsole;
}

const defaults: MessageRouterDependencies = {
  login: requireLogin,
  editor: requireRole("editor"),
  acknowledger: requireRole("editor", "viewer"),
  list: listPackingMessages,
  create: createPackingMessage,
  acknowledge: acknowledgePackingMessage,
  reset: resetPackingMessage,
  remove: removePackingMessage,
  remember: rememberMessageUser,
  users: getKnownMessageUsers,
  authorizeRecipient: authorizeWithAdminConsole,
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
      const user = req.session.user!;
      await dependencies.remember(user);
      res.json(GetPackingMessagesResponse.parse({ messages: await dependencies.list(user) }));
    } catch {
      req.log.error("Message board read unavailable");
      res.status(503).json({ message: "Messages could not be loaded. Please retry." });
    }
  });

  router.get("/messages/recipients", dependencies.editor, async (req, res): Promise<void> => {
    try {
      await dependencies.remember(req.session.user!);
      const known = (await dependencies.users()).filter(user => user.userId !== req.session.user!.entraOid);
      const recipients = [];
      // Bound concurrent central authorization requests; never treat outages as permission.
      for (let i = 0; i < known.length; i += 5) {
        const allowed = await Promise.all(known.slice(i, i + 5).map(async user => {
          try {
            await dependencies.authorizeRecipient(user.userId);
            return user;
          } catch (error) {
            if (error instanceof AccessDeniedError) return null;
            throw error;
          }
        }));
        recipients.push(...allowed.filter(user => user !== null));
      }
      res.json(GetMessageRecipientsResponse.parse({ recipients }));
    } catch {
      req.log.error("Message recipients unavailable");
      res.status(503).json({ message: "Recipients could not be verified. Please retry." });
    }
  });

  router.post("/messages", dependencies.editor, async (req, res) => {
    const parsed = CreatePackingMessageBody.safeParse(req.body);
    if (!parsed.success || !parsed.data.content.trim()) {
      res.status(400).json({ message: "Choose a recipient and enter a message between 1 and 200 characters." });
      return;
    }
    try {
      const user = req.session.user!;
      const recipient = (await dependencies.users()).find(item => item.userId === parsed.data.recipientId);
      if (!recipient || recipient.userId === user.entraOid) {
        res.status(400).json({ message: "Choose another previously signed-in user as the recipient." });
        return;
      }
      await dependencies.authorizeRecipient(recipient.userId);
      const message = await dependencies.create(parsed.data.content.trim(), recipient.userId, user);
      res.status(201).json(CreatePackingMessageResponse.parse(message));
    } catch (error) {
      if (error instanceof MessageBoardError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      if (error instanceof AccessDeniedError) {
        res.status(400).json({ message: "This recipient no longer has Packing Board access. Choose another user." });
        return;
      }
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

  router.delete("/messages/:messageId/acknowledgments", dependencies.editor, async (req, res): Promise<void> => {
    const parsed = ResetPackingMessageParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ message: "A valid message ID is required." });
      return;
    }
    try {
      const message = await dependencies.reset(parsed.data.messageId, req.session.user!);
      res.json(ResetPackingMessageResponse.parse(message));
    } catch (error) {
      if (error instanceof MessageBoardError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      req.log.error("Message could not be reset");
      res.status(503).json({ message: "Message reset was not confirmed. Refresh the board before retrying." });
    }
  });

  router.delete("/messages/:messageId", dependencies.editor, async (req, res): Promise<void> => {
    const parsed = RemovePackingMessageParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ message: "A valid message ID is required." });
      return;
    }
    try {
      await dependencies.remove(parsed.data.messageId, req.session.user!);
      res.sendStatus(204);
    } catch (error) {
      if (error instanceof MessageBoardError) {
        res.status(error.status).json({ message: error.message });
        return;
      }
      req.log.error("Message could not be removed");
      res.status(503).json({ message: "Message removal was not confirmed. Refresh the board before retrying." });
    }
  });

  return router;
}

export default createPackingMessagesRouter();
