import { Check, Clock, RefreshCw } from 'lucide-react';
import type { PackingMessage } from '@workspace/api-client-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { formatStamp } from './message-utils';

interface Props {
  message: PackingMessage | null;
  remaining: number;
  pending: boolean;
  error: string | null;
  onOk: (id: string) => void;
  onLater: () => void;
}

/** Automatic popup for a directed message awaiting this user's OK. */
export function MessagePopup({ message, remaining, pending, error, onOk, onLater }: Props) {
  return (
    <Dialog open={message !== null} onOpenChange={open => { if (!open && !pending) onLater(); }}>
      {message && (
        <DialogContent className="max-w-lg border-2 border-red-600/80 bg-card p-5" data-testid="popup-new-message">
          <div className="flex items-center gap-2">
            <span className="rounded-sm bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">New!</span>
            <DialogTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Message from {message.authorName}
            </DialogTitle>
            {remaining > 1 && <span className="ml-auto mr-6 font-mono text-[10px] text-muted-foreground">+{remaining - 1} more</span>}
          </div>
          <p className="whitespace-pre-wrap break-words text-lg font-semibold leading-7 text-red-400" data-testid={`popup-content-${message.id}`}>
            {message.content}
          </p>
          <DialogDescription className="font-mono text-xs text-muted-foreground">
            Sent {formatStamp(message.createdAt)}
          </DialogDescription>
          {error && <p className="text-xs text-destructive" role="alert" data-testid="text-popup-error">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onLater} disabled={pending}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs font-bold uppercase text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              aria-label="Later: hide for two minutes" data-testid="button-popup-later">
              <Clock className="h-3.5 w-3.5" /> Later
            </button>
            <button type="button" onClick={() => onOk(message.id)} disabled={pending} autoFocus
              className="inline-flex items-center gap-1 rounded-sm bg-primary px-5 py-1.5 text-sm font-bold uppercase text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              aria-label={`OK message from ${message.authorName}`} data-testid={`button-popup-ok-${message.id}`}>
              {pending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} OK
            </button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
