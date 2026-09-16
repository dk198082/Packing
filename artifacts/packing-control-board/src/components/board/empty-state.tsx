import { AlertTriangle, Database, LoaderCircle, LockKeyhole } from 'lucide-react';

type EmptyStateProps = {
  onRefresh: () => void;
  isRefreshing: boolean;
  state: 'LOADING' | 'ERROR' | 'EMPTY' | 'ACCESS_REQUIRED';
  error?: string | null;
};

export function EmptyState({ onRefresh, isRefreshing, state, error }: EmptyStateProps) {
  const isLoading = state === 'LOADING';
  const isError = state === 'ERROR';
  const isAccessRestricted = state === 'ACCESS_REQUIRED';
  const Icon = isLoading ? LoaderCircle : isAccessRestricted ? LockKeyhole : isError ? AlertTriangle : Database;
  const title = isLoading
    ? 'LOADING LIVE ORDER DATA'
    : isAccessRestricted
      ? 'INTERNAL ACCESS REQUIRED'
      : isError
      ? 'LIVE SOURCE UNAVAILABLE'
      : 'NO CURRENT PACKING ORDERS';
  const description = isLoading
    ? 'Reading the current packing queue from Azure Postgres.'
    : isAccessRestricted
      ? 'Live packing data is reserved for internal users. An internal sign-in system must be configured before this board can display the Azure queue.'
      : isError
      ? error || 'The board could not read the live packing source. Retry the sync to continue.'
      : 'The live packing source returned no current orders for the normalized queue.';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-12 text-center h-full border border-dashed border-border rounded-lg bg-card/10 mt-6 min-h-[500px]">
      <div className="w-20 h-20 rounded-full bg-muted/30 border border-border flex items-center justify-center mb-6">
        <Icon className={`w-10 h-10 ${isError ? 'text-destructive' : isAccessRestricted ? 'text-attention' : 'text-muted-foreground'} ${isLoading ? 'animate-spin' : ''}`} />
      </div>
      <h2 className="text-2xl font-bold text-foreground mb-3 font-sans tracking-wide">{title}</h2>
      <p className="text-muted-foreground max-w-md mb-10 font-sans text-sm leading-relaxed">
        {description}
      </p>
      {!isAccessRestricted && <button
        onClick={onRefresh}
        disabled={isRefreshing || isLoading}
        className="px-8 py-3 bg-primary text-primary-foreground font-bold rounded-sm hover:bg-primary/90 transition-colors uppercase text-sm tracking-widest disabled:opacity-50 flex items-center gap-2"
      >
        {isLoading || isRefreshing ? 'SYNCING LIVE SOURCE...' : isError ? 'RETRY LIVE SYNC' : 'REFRESH LIVE DATA'}
      </button>}
    </div>
  );
}
