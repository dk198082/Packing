import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetMessageRecipientsQueryKey, getGetPackingMessagesQueryKey,
  useAcknowledgePackingMessage, useCreatePackingMessage, useGetMessageRecipients,
  useGetPackingMessages, useRemovePackingMessage, useResetPackingMessage,
  type PackingMessage, type PackingMessagesResponse,
} from '@workspace/api-client-react';
import { mergeMessage } from './message-utils';

export function useMessagesData(entraOid: string, isEditor: boolean, windowOpen: boolean) {
  const queryClient = useQueryClient();
  const messagesKey = useMemo(() => [...getGetPackingMessagesQueryKey(), entraOid], [entraOid]);
  const recipientsKey = useMemo(() => [...getGetMessageRecipientsQueryKey(), entraOid], [entraOid]);

  // Privacy: drop any cached messages/recipients belonging to a different account.
  const prevOid = useRef(entraOid);
  useEffect(() => {
    if (prevOid.current !== entraOid) {
      queryClient.removeQueries({ queryKey: [...getGetPackingMessagesQueryKey(), prevOid.current] });
      queryClient.removeQueries({ queryKey: [...getGetMessageRecipientsQueryKey(), prevOid.current] });
      prevOid.current = entraOid;
    }
  }, [entraOid, queryClient]);

  // Polling continues while the window is closed so popups arrive.
  const messagesQuery = useGetPackingMessages({
    query: { queryKey: messagesKey, refetchInterval: 10_000, refetchOnWindowFocus: true },
  });
  const recipientsQuery = useGetMessageRecipients({
    query: { enabled: isEditor && windowOpen, queryKey: recipientsKey, staleTime: 60_000 },
  });

  const createMessage = useCreatePackingMessage();
  const acknowledge = useAcknowledgePackingMessage();
  const resetMessage = useResetPackingMessage();
  const removeMessage = useRemovePackingMessage();

  async function applyUpdate(update: (old: PackingMessagesResponse | undefined) => PackingMessagesResponse | undefined) {
    await queryClient.cancelQueries({ queryKey: messagesKey });
    queryClient.setQueryData<PackingMessagesResponse>(messagesKey, update);
    void queryClient.invalidateQueries({ queryKey: messagesKey });
  }

  return {
    messagesQuery,
    recipientsQuery,
    createPending: createMessage.isPending,
    actionPending: resetMessage.isPending || removeMessage.isPending,
    async send(content: string, recipientId: string) {
      const created = await createMessage.mutateAsync({ data: { content, recipientId } });
      await applyUpdate(old => mergeMessage(old, created));
    },
    async ack(messageId: string) {
      const updated = await acknowledge.mutateAsync({ messageId });
      await applyUpdate(old => mergeMessage(old, updated));
    },
    async reset(messageId: string) {
      const updated: PackingMessage = await resetMessage.mutateAsync({ messageId });
      await applyUpdate(old => mergeMessage(old, updated));
    },
    async remove(messageId: string) {
      await removeMessage.mutateAsync({ messageId });
      await applyUpdate(old => (old ? { ...old, messages: old.messages.filter(m => m.id !== messageId) } : old));
    },
  };
}

export type MessagesData = ReturnType<typeof useMessagesData>;
