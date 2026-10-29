import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, MessageSquare, RefreshCw, Send } from 'lucide-react';
import {
  getGetPackingMessagesQueryKey,
  useAcknowledgePackingMessage,
  useCreatePackingMessage,
  useGetPackingMessages,
  type PackingMessage,
  type PackingMessagesResponse,
} from '@workspace/api-client-react';
import { useAuth } from '@/hooks/use-auth';

const MAX_LEN = 200;

const stampFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatStamp(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : stampFormat.format(d);
}

function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const e = error as { status?: number; data?: { error?: string; message?: string }; message?: string };
    const detail = e.data?.error ?? e.data?.message;
    if (detail) return detail;
    if (e.status === 403) return 'You do not have permission for this action.';
  }
  return fallback;
}

function mergeMessage(old: PackingMessagesResponse | undefined, msg: PackingMessage): PackingMessagesResponse | undefined {
  if (!old) return { messages: [msg] };
  const exists = old.messages.some(m => m.id === msg.id);
  return {
    ...old,
    messages: exists ? old.messages.map(m => (m.id === msg.id ? msg : m)) : [msg, ...old.messages],
  };
}

export function MessageBoard() {
  const { user, entraOid } = useAuth();
  const isEditor = user.role === 'editor';
  const queryClient = useQueryClient();
  const queryKey = getGetPackingMessagesQueryKey();

  const messagesQuery = useGetPackingMessages({
    query: { queryKey, refetchInterval: 15_000, refetchOnWindowFocus: true },
  });
  const createMessage = useCreatePackingMessage();
  const acknowledge = useAcknowledgePackingMessage();

  const [draft, setDraft] = useState('');
  const posting = useRef(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [pendingAck, setPendingAck] = useState<Record<string, boolean>>({});
  const [ackErrors, setAckErrors] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState(false);

  const displayedQuery = messagesQuery;
  const messages = [...(displayedQuery.data?.messages ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const newMessages = messages.filter(message => message.acknowledgments.length === 0);
  const trimmed = draft.trim();
  const tooLong = draft.length > MAX_LEN;

  async function handlePost() {
    if (!isEditor || posting.current) return;
    if (!trimmed) {
      setPostError('Enter a message before posting.');
      return;
    }
    if (tooLong) {
      setPostError(`Message must be ${MAX_LEN} characters or fewer.`);
      return;
    }
    setPostError(null);
    posting.current = true;
    try {
      const created = await createMessage.mutateAsync({ data: { content: trimmed } });
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<PackingMessagesResponse>(queryKey, old => mergeMessage(old, created));
      void queryClient.invalidateQueries({ queryKey });
      setDraft('');
    } catch (error) {
      setPostError(errorText(error, 'Message could not be posted. Your draft is kept; try again.'));
    } finally {
      posting.current = false;
    }
  }

  async function handleAck(messageId: string) {
    setPendingAck(p => ({ ...p, [messageId]: true }));
    setAckErrors(e => {
      const next = { ...e };
      delete next[messageId];
      return next;
    });
    try {
      const updated = await acknowledge.mutateAsync({ messageId });
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<PackingMessagesResponse>(queryKey, old => mergeMessage(old, updated));
      void queryClient.invalidateQueries({ queryKey });
    } catch (error) {
      setAckErrors(e => ({ ...e, [messageId]: errorText(error, 'OK could not be recorded. Retry.') }));
    } finally {
      setPendingAck(p => {
        const next = { ...p };
        delete next[messageId];
        return next;
      });
    }
  }

  return (
    <section
      className={`mt-2 mb-2 flex flex-shrink-0 gap-2.5 rounded-md border border-border bg-card p-2 ${collapsed ? 'h-12' : 'h-[168px]'}`}
      data-testid="panel-message-board"
      aria-label="Shared message board"
    >
      <div
        className={`flex min-w-0 gap-1.5 ${collapsed ? 'w-full flex-row items-center' : 'w-[34%] min-w-[220px] flex-col'}`}
        data-testid="message-composer-column"
      >
        <div className={`flex items-center gap-2 ${collapsed ? 'w-[34%] min-w-[220px]' : ''}`}>
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Messages</span>
          {newMessages.length > 0 && (
            <span className="rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white" data-testid="badge-new-count">
              {newMessages.length} NEW
            </span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(value => !value)}
            className="ml-auto inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground hover:border-primary hover:text-primary"
            aria-expanded={!collapsed}
            aria-controls="message-board-content"
            data-testid="button-toggle-message-board"
          >
            {collapsed ? <><ChevronDown className="h-3.5 w-3.5" /> Expand</> : <><ChevronUp className="h-3.5 w-3.5" /> Collapse</>}
          </button>
        </div>
        {collapsed && (
          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto" data-testid="list-new-messages-collapsed">
            {newMessages.length === 0 ? (
              <span className="text-xs text-muted-foreground">No new messages</span>
            ) : newMessages.map(message => (
              <div
                key={message.id}
                className="flex min-w-0 max-w-[480px] items-center gap-1.5 rounded-sm border border-border/70 bg-background/40 px-2 py-1"
                title={message.content}
                data-testid={`collapsed-new-message-${message.id}`}
              >
                <span className="shrink-0 rounded-sm bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">New!</span>
                <span className="truncate text-sm font-semibold text-red-400">{message.content}</span>
              </div>
            ))}
          </div>
        )}
        {!collapsed && <div className="contents">
        {isEditor ? (
          <>
            <textarea
              value={draft}
              onChange={e => {
                setDraft(e.target.value);
                if (postError) setPostError(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void handlePost();
                }
              }}
              maxLength={MAX_LEN}
              aria-label="Message for Parts and System"
              disabled={createMessage.isPending}
              className="min-h-0 flex-1 resize-none rounded-sm border border-input bg-background px-2 py-1.5 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-60"
              data-testid="input-message"
              aria-invalid={!!postError}
            />
            <div className="flex items-center gap-2">
              <span
                className={`font-mono text-[10px] ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}
                data-testid="text-message-count"
              >
                {draft.length}/{MAX_LEN}
              </span>
              {postError && (
                <span className="min-w-0 flex-1 truncate text-[11px] text-destructive" role="alert" title={postError} data-testid="text-post-error">
                  {postError}
                </span>
              )}
              <button
                type="button"
                onClick={() => void handlePost()}
                disabled={createMessage.isPending || !trimmed || tooLong}
                className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="button-post-message"
              >
                {createMessage.isPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {createMessage.isPending ? 'Posting' : 'Post'}
              </button>
            </div>
          </>
        ) : (
          <p className="flex-1 rounded-sm border border-dashed border-border px-2 py-1.5 text-xs leading-5 text-muted-foreground" data-testid="text-readonly-note">
            Read-only access: only Read/Write users can post. You can still OK messages from others.
          </p>
        )}
        </div>}
      </div>

      <div
        id="message-board-content"
        className={collapsed ? 'hidden' : 'flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border pl-2.5'}
        hidden={collapsed}
        data-testid="message-list-column"
      >
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="list-messages">
          {displayedQuery.isLoading ? (
            <div className="space-y-1.5" aria-busy="true">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-10 animate-pulse rounded-sm bg-muted" />
              ))}
            </div>
          ) : displayedQuery.isError && messages.length === 0 ? (
            <div className="flex h-full items-center gap-3 text-xs text-destructive" role="alert">
              <span data-testid="text-messages-error">Messages could not be loaded.</span>
              <button
                type="button"
                onClick={() => void displayedQuery.refetch()}
                disabled={displayedQuery.isFetching}
                className="inline-flex items-center gap-1 rounded-sm border border-destructive/60 px-2 py-0.5 font-semibold uppercase hover:bg-destructive/10 disabled:opacity-50"
                data-testid="button-retry-messages"
              >
                <RefreshCw className={`h-3 w-3 ${displayedQuery.isFetching ? 'animate-spin' : ''}`} /> Retry
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center text-xs text-muted-foreground" data-testid="text-messages-empty">
              No Messages
            </div>
          ) : (
            <ul className="space-y-1.5">
              {displayedQuery.isError && (
                <li className="text-[11px] text-destructive" role="status">
                  Refresh failed. Showing last loaded messages; retrying automatically.
                </li>
              )}
              {messages.map(m => {
                const cannotAckOwn = m.authorId === entraOid && !isEditor;
                const acked = m.acknowledgments.some(a => a.userId === entraOid);
                const isNew = m.acknowledgments.length === 0;
                const pending = !!pendingAck[m.id];
                const ackError = ackErrors[m.id];
                return (
                  <li key={m.id} className="rounded-sm border border-border/70 bg-background/40 px-3 py-2" data-testid={`card-message-${m.id}`}>
                    <p
                      className={`whitespace-pre-wrap break-words text-base font-semibold leading-6 ${isNew ? 'text-red-400' : 'text-foreground'}`}
                      data-testid={`text-content-${m.id}`}
                    >
                      {m.content}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                          {isNew && (
                            <span className="rounded-sm bg-red-600 px-1.5 py-0.5 font-bold text-white" data-testid={`badge-new-${m.id}`}>
                              New!
                            </span>
                          )}
                          <span className="font-bold text-foreground" data-testid={`text-author-${m.id}`}>{m.authorName}</span>
                          <time className="font-mono text-muted-foreground" dateTime={m.createdAt} data-testid={`text-time-${m.id}`}>
                            {formatStamp(m.createdAt)}
                          </time>
                          <button
                            type="button"
                            onClick={() => void handleAck(m.id)}
                            disabled={cannotAckOwn || acked || pending}
                            title={cannotAckOwn ? 'Read/Write access is required to OK your own message' : acked ? 'You already acknowledged this' : 'Acknowledge with OK'}
                            className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border px-3 py-1 text-xs font-bold uppercase tracking-wide disabled:cursor-not-allowed ${
                              acked
                                ? 'border-ready/60 text-ready'
                                : 'border-primary text-primary hover:bg-primary hover:text-primary-foreground disabled:border-border disabled:text-muted-foreground disabled:hover:bg-transparent'
                            }`}
                            data-testid={`button-ok-${m.id}`}
                          >
                            {pending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                            {acked ? 'DONE' : 'OK'}
                          </button>
                    </div>
                    {m.acknowledgments.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-testid={`list-acks-${m.id}`}>
                        {m.acknowledgments.map(a => (
                          <span key={a.userId}>
                            <span className="text-ready">OK</span> {a.displayName} · {formatStamp(a.acknowledgedAt)}
                          </span>
                        ))}
                      </div>
                    )}
                    {ackError && (
                      <div className="mt-1 text-[11px] text-destructive" role="alert" data-testid={`text-ack-error-${m.id}`}>
                        {ackError}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
