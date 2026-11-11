import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, RefreshCw } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useMessagesData } from './use-messages';
import { MessageComposer } from './message-composer';
import { MessageItem, type ConfirmAction } from './message-item';
import { MessagePopup } from './message-popup';
import { LATER_MS, errorText, isLegacy, isPendingIncoming } from './message-utils';

/** Header Messages button, Messages window, and automatic popup for incoming messages. */
export function MessagesCenter() {
  const { user, entraOid } = useAuth();
  const isEditor = user.role === 'editor';
  const [open, setOpen] = useState(false);
  const data = useMessagesData(entraOid, isEditor, open);
  const [ackPending, setAckPending] = useState<Record<string, boolean>>({});
  const [ackErrors, setAckErrors] = useState<Record<string, string>>({});
  const [laterUntil, setLaterUntil] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset per-account UI state on account switch.
  useEffect(() => {
    setOpen(false); setAckErrors({}); setAckPending({}); setLaterUntil(0); setConfirm(null);
  }, [entraOid]);

  useEffect(() => {
    if (laterUntil <= nowMs) return;
    const t = window.setTimeout(() => setNowMs(Date.now()), laterUntil - nowMs + 50);
    return () => window.clearTimeout(t);
  }, [laterUntil, nowMs]);

  const q = data.messagesQuery;
  const messages = useMemo(() => [...(q.data?.messages ?? [])]
    .filter(m => !isLegacy(m) || m.authorId === entraOid)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [q.data, entraOid]);
  const pendingIncoming = messages.filter(m => isPendingIncoming(m, entraOid));
  const oldestPending = pendingIncoming[pendingIncoming.length - 1] ?? null;
  const snoozed = laterUntil > nowMs;
  const popupMessage = !open && !snoozed ? oldestPending : null;

  async function handleOk(id: string) {
    if (ackPending[id]) return;
    setAckPending(p => ({ ...p, [id]: true }));
    setAckErrors(e => { const n = { ...e }; delete n[id]; return n; });
    try {
      await data.ack(id);
    } catch (e) {
      setAckErrors(x => ({ ...x, [id]: errorText(e, 'OK could not be recorded. Retry.') }));
    } finally {
      setAckPending(p => { const n = { ...p }; delete n[id]; return n; });
    }
  }

  async function handleConfirmed() {
    if (!isEditor || !confirm || data.actionPending) return;
    setActionError(null);
    try {
      if (confirm.action === 'reset') await data.reset(confirm.message.id);
      else await data.remove(confirm.message.id);
      setConfirm(null);
    } catch (e) {
      setActionError(errorText(e, 'Change was not saved. Retry.'));
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={`relative inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2.5 py-1 font-bold uppercase tracking-wide ${pendingIncoming.length ? 'border-red-600 text-red-400' : 'border-border text-muted-foreground hover:border-primary hover:text-primary'}`}
        aria-label={pendingIncoming.length ? `Messages, ${pendingIncoming.length} new` : 'Messages'}
        data-testid="button-open-messages">
        <MessageSquare className="h-3.5 w-3.5" /> Messages
        {pendingIncoming.length > 0 && (
          <span className="rounded-sm bg-red-600 px-1 text-[10px] text-white" data-testid="badge-new-count">{pendingIncoming.length} NEW</span>
        )}
      </button>

      <MessagePopup message={popupMessage} remaining={pendingIncoming.length}
        pending={popupMessage ? !!ackPending[popupMessage.id] : false}
        error={popupMessage ? ackErrors[popupMessage.id] ?? null : null}
        onOk={id => void handleOk(id)}
        onLater={() => { const n = Date.now(); setNowMs(n); setLaterUntil(n + LATER_MS); }} />

      <Dialog open={open} onOpenChange={o => { if (!o && !data.actionPending) { setOpen(false); setConfirm(null); } }}>
        <DialogContent className="flex max-h-[88dvh] max-w-2xl flex-col gap-2 bg-card p-4" data-testid="dialog-messages">
          <div className="flex items-center gap-2 pr-6">
            <MessageSquare className="h-4 w-4 text-primary" />
            <DialogTitle className="text-sm font-semibold uppercase tracking-wider">Messages</DialogTitle>
            {q.isFetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Refreshing" />}
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            {isEditor ? 'Send a message to one person. It pops up on their board until they press OK.' : 'Read-only access: you can OK messages sent to you. Only Read/Write users can send.'}
          </DialogDescription>
          {isEditor && <MessageComposer data={data} entraOid={entraOid} />}

          {confirm && (
            <div className="space-y-2 rounded-sm border-2 border-destructive/60 bg-background p-2" role="alertdialog" aria-label="Confirm message change" data-testid="panel-confirm-message-action">
              <p className="text-sm font-semibold">{confirm.action === 'reset' ? 'Un-check this message? The recipient will see it as New again.' : 'Remove this DONE message for sender and recipient?'}</p>
              <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{confirm.message.content}</p>
              {actionError && <p className="text-xs text-destructive" role="alert">{actionError}</p>}
              <div className="flex justify-end gap-2 text-xs">
                <button type="button" disabled={data.actionPending} onClick={() => { setConfirm(null); setActionError(null); }} className="rounded-sm border border-border px-3 py-1 font-bold uppercase disabled:opacity-50" data-testid="button-cancel-message-action">Cancel</button>
                <button type="button" disabled={data.actionPending} onClick={() => void handleConfirmed()} className="rounded-sm bg-destructive px-3 py-1 font-bold uppercase text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-message-action">
                  {data.actionPending ? 'Saving' : confirm.action === 'reset' ? 'Make New' : 'Remove'}
                </button>
              </div>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="list-messages">
            {q.isLoading ? (
              <div className="space-y-1.5" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="h-14 animate-pulse rounded-sm bg-muted" />)}</div>
            ) : q.isError && messages.length === 0 ? (
              <div className="flex items-center gap-3 py-4 text-xs text-destructive" role="alert">
                <span data-testid="text-messages-error">Messages could not be loaded.</span>
                <button type="button" onClick={() => void q.refetch()} disabled={q.isFetching} className="inline-flex items-center gap-1 rounded-sm border border-destructive/60 px-2 py-0.5 font-semibold uppercase disabled:opacity-50" data-testid="button-retry-messages">
                  <RefreshCw className={`h-3 w-3 ${q.isFetching ? 'animate-spin' : ''}`} /> Retry
                </button>
              </div>
            ) : messages.length === 0 ? (
              <div className="py-4 text-xs text-muted-foreground" data-testid="text-messages-empty">No messages sent to you or by you.</div>
            ) : (
              <ul className="space-y-1.5">
                {q.isError && <li className="text-[11px] text-destructive" role="status">Refresh failed. Showing last loaded messages; retrying automatically.</li>}
                {messages.map(m => (
                  <MessageItem key={m.id} m={m} entraOid={entraOid} isEditor={isEditor}
                    ackPending={!!ackPending[m.id]} ackError={ackErrors[m.id]} disabled={data.actionPending || !!ackPending[m.id]}
                    onOk={id => void handleOk(id)} onConfirm={c => { setActionError(null); setConfirm(c); }} />
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
