import { Check, RefreshCw, Trash2, Undo2 } from 'lucide-react';
import type { PackingMessage } from '@workspace/api-client-react';
import { formatStamp, isLegacy, isPendingIncoming, recipientAck } from './message-utils';

export type ConfirmAction = { message: PackingMessage; action: 'reset' | 'remove' };

interface Props {
  m: PackingMessage;
  entraOid: string;
  isEditor: boolean;
  ackPending: boolean;
  ackError?: string;
  disabled: boolean;
  onOk: (id: string) => void;
  onConfirm: (c: ConfirmAction) => void;
}

export function MessageItem({ m, entraOid, isEditor, ackPending, ackError, disabled, onOk, onConfirm }: Props) {
  const legacy = isLegacy(m);
  const sent = m.authorId === entraOid;
  const pending = isPendingIncoming(m, entraOid);
  const rAck = recipientAck(m);
  const isNew = legacy ? m.acknowledgments.length === 0 : !rAck;
  const done = !isNew;
  const canAck = pending || (legacy && sent && isEditor && isNew);
  return (
    <li className="rounded-sm border border-border/70 bg-background/40 px-3 py-2" data-testid={`card-message-${m.id}`}>
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {legacy ? (
          <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground" data-testid={`badge-legacy-${m.id}`}>Previous board message</span>
        ) : (
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {sent ? <>To <span className="text-foreground">{m.recipientName ?? 'Unknown recipient'}</span></> : <>From <span className="text-foreground">{m.authorName}</span></>}
          </span>
        )}
        {isNew && !legacy && <span className="rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white" data-testid={`badge-new-${m.id}`}>New!</span>}
        <time className="ml-auto font-mono text-muted-foreground" dateTime={m.createdAt}>{formatStamp(m.createdAt)}</time>
      </div>
      <p className={`whitespace-pre-wrap break-words text-base font-semibold leading-6 ${isNew && !legacy ? 'text-red-400' : 'text-foreground'}`} data-testid={`text-content-${m.id}`}>
        {m.content}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
        {!legacy && (rAck ? (
          <span className="text-muted-foreground" data-testid={`text-receipt-${m.id}`}>
            <span className="font-bold text-ready">OK</span> {rAck.displayName} · {formatStamp(rAck.acknowledgedAt)}
          </span>
        ) : (
          <span className="text-muted-foreground" data-testid={`text-receipt-${m.id}`}>
            {sent ? 'Awaiting recipient OK' : 'Awaiting your OK'}
          </span>
        ))}
        <span className="ml-auto flex gap-1.5">
          {canAck && (
            <button type="button" onClick={() => onOk(m.id)} disabled={ackPending}
              className="inline-flex items-center gap-1 rounded-sm border border-primary px-3 py-1 font-bold uppercase text-primary hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              aria-label={`OK message from ${m.authorName}`} data-testid={`button-ok-${m.id}`}>
              {ackPending ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} OK
            </button>
          )}
          {!pending && !legacy && !sent && rAck && (
            <span className="inline-flex items-center gap-1 rounded-sm border border-ready/60 px-3 py-1 font-bold uppercase text-ready">
              <Check className="h-3 w-3" /> DONE
            </span>
          )}
          {isEditor && done && (
            <>
              <button type="button" disabled={disabled} onClick={() => onConfirm({ message: m, action: 'reset' })}
                className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 font-bold hover:border-primary hover:text-primary disabled:opacity-50"
                aria-label="Un-check message" data-testid={`button-reset-${m.id}`}>
                <Undo2 className="h-3 w-3" /> Un-check
              </button>
              <button type="button" disabled={disabled} onClick={() => onConfirm({ message: m, action: 'remove' })}
                className="inline-flex items-center gap-1 rounded-sm border border-destructive/60 px-2 py-1 font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                aria-label="Remove DONE message" data-testid={`button-remove-${m.id}`}>
                <Trash2 className="h-3 w-3" /> Remove
              </button>
            </>
          )}
        </span>
      </div>
      {ackError && <div className="mt-1 text-[11px] text-destructive" role="alert" data-testid={`text-ack-error-${m.id}`}>{ackError}</div>}
    </li>
  );
}
