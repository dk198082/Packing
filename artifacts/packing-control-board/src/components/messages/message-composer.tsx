import { useState } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import type { MessagesData } from './use-messages';
import { MAX_LEN, errorText } from './message-utils';

export function MessageComposer({ data, entraOid }: { data: MessagesData; entraOid: string }) {
  const [draft, setDraft] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = data.recipientsQuery;
  const recipients = (q.data?.recipients ?? []).filter(r => r.userId !== entraOid);
  const validRecipient = !q.isError && recipients.some(r => r.userId === recipientId);
  const trimmed = draft.trim();
  const tooLong = draft.length > MAX_LEN;

  async function submit() {
    if (data.createPending) return;
    if (!validRecipient) return setError('Choose an available recipient.');
    if (!trimmed) return setError('Enter a message before sending.');
    if (tooLong) return setError(`Message must be ${MAX_LEN} characters or fewer.`);
    setError(null);
    try {
      await data.send(trimmed, recipientId);
      setDraft('');
    } catch (e) {
      setError(errorText(e, 'Message could not be sent. Your draft is kept; try again.'));
    }
  }

  return (
    <div className="space-y-1.5 rounded-sm border border-border bg-background/40 p-2" data-testid="message-composer">
      <div className="flex items-center gap-2">
        <label htmlFor="message-recipient" className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">To</label>
        {q.isLoading ? (
          <div className="h-7 flex-1 animate-pulse rounded-sm bg-muted" aria-busy="true" />
        ) : q.isError ? (
          <div className="flex flex-1 items-center gap-2 text-xs text-destructive" role="alert">
            Recipients could not be loaded.
            <button type="button" onClick={() => void q.refetch()} className="inline-flex items-center gap-1 rounded-sm border border-destructive/60 px-2 py-0.5 font-semibold uppercase" data-testid="button-retry-recipients">
              <RefreshCw className={`h-3 w-3 ${q.isFetching ? 'animate-spin' : ''}`} /> Retry
            </button>
          </div>
        ) : recipients.length === 0 ? (
          <p className="flex-1 text-xs text-muted-foreground" data-testid="text-no-recipients">
            No recipients yet. Users appear here after they sign in to the board.
          </p>
        ) : (
          <select id="message-recipient" value={recipientId} onChange={e => { setRecipientId(e.target.value); setError(null); }}
            aria-label="Message recipient" data-testid="select-recipient"
            className="h-7 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-sm text-foreground focus:border-primary focus:outline-none">
            <option value="">Select recipient</option>
            {recipients.map(r => <option key={r.userId} value={r.userId}>{r.displayName} ({r.email})</option>)}
          </select>
        )}
      </div>
      <textarea value={draft} maxLength={MAX_LEN} rows={2} disabled={data.createPending}
        onChange={e => { setDraft(e.target.value); setError(null); }}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } }}
        aria-label="Message text" aria-invalid={!!error} data-testid="input-message"
        className="w-full resize-none rounded-sm border border-input bg-background px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-60" />
      <div className="flex items-center gap-2">
        <span className={`font-mono text-[10px] ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="text-message-count">{draft.length}/{MAX_LEN}</span>
        {error && <span className="min-w-0 flex-1 truncate text-[11px] text-destructive" role="alert" title={error} data-testid="text-post-error">{error}</span>}
        <button type="button" onClick={() => void submit()} disabled={data.createPending || !trimmed || tooLong || !validRecipient}
          className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1 text-xs font-bold uppercase text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          aria-label="Send message" data-testid="button-send-message">
          {data.createPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {data.createPending ? 'Sending' : 'Send'}
        </button>
      </div>
    </div>
  );
}
