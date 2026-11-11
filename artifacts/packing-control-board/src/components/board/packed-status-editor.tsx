import { useState } from 'react';
import { Pencil } from 'lucide-react';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

interface PackedStatusEditorProps {
  packedAt: string | null;
  canOperate: boolean;
  disabled: boolean;
  onChange: (packedAt: string | null) => Promise<string | null>;
}

export function PackedStatusEditor({ packedAt, canOperate, disabled, onChange }: PackedStatusEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [clearing, setClearing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!packedAt) return null;

  const busy = disabled || saving;
  const validDraft = Boolean(draft) && !Number.isNaN(new Date(draft).getTime());
  const buttonClass = 'rounded-sm border border-current px-2 py-1 text-[10px] font-bold uppercase disabled:opacity-50';
  function beginEdit() {
    const date = new Date(packedAt!);
    setDraft(new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
    setError('');
    setEditing(true);
  }
  async function save(value: string | null) {
    if (!canOperate || busy) return;
    setSaving(true);
    setError('');
    try {
      await onChange(value);
      setEditing(false);
      setClearing(false);
    } catch {
      setError('PACKED change could not be saved. Please retry.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-sm border border-ready/60 bg-ready/10 px-3 py-2 text-ready" data-testid="packed-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold tracking-wide">PACKED</div>
        {canOperate && !editing && (
          <div className="flex gap-2">
            <button type="button" onClick={beginEdit} disabled={busy} className={buttonClass} data-testid="button-edit-packed">
              <Pencil className="mr-1 inline h-3 w-3" /> Edit
            </button>
            <button type="button" onClick={() => { setError(''); setClearing(true); }} disabled={busy} className={buttonClass} data-testid="button-clear-packed">
              Clear
            </button>
          </div>
        )}
      </div>
      <time dateTime={packedAt} className="text-xs font-mono">
        {new Date(packedAt).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </time>
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="datetime-local" value={draft} onChange={event => setDraft(event.target.value)}
            aria-label="Packed date and time" disabled={busy}
            className="pack-start-datetime min-w-0 rounded-sm border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            data-testid="input-packed-datetime"
          />
          <button type="button" onClick={() => { if (validDraft) void save(new Date(draft).toISOString()); }} disabled={busy || !validDraft} className={buttonClass} data-testid="button-save-packed">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => { setEditing(false); setError(''); }} disabled={busy} className={buttonClass}>Cancel</button>
        </div>
      )}
      {error && !clearing && <p className="mt-1 text-xs text-destructive" role="alert">{error}</p>}
      <AlertDialog open={clearing} onOpenChange={open => { if (!saving) setClearing(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear PACKED status?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the PACKED indicator and packed date/time for everyone. The Start Pack date/time will not change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={event => { event.preventDefault(); void save(null); }} disabled={busy} data-testid="button-confirm-clear-packed">
              {saving ? 'Saving…' : 'Clear PACKED'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
