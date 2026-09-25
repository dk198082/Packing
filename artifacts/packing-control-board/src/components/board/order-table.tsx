import { useEffect, useMemo, useState } from 'react';
import type { Order, Team } from '@/lib/types';
import {
  getDateBucket,
  formatCardDate,
  formatWorkDaysInPacking,
} from '@/lib/order-logic';
import { formatPackStartDay } from '@/lib/operator-fields';
import { GripVertical } from 'lucide-react';
import { HoldIndicator } from './hold-indicator';

interface OrderTableProps {
  orders: Order[];
  onRowClick: (id: string) => void;
  onReorder: (
    orderIds: string[],
    expectedRevision: string | null,
  ) => Promise<void>;
  canReorder: boolean;
  isReordering: boolean;
  isPrioritySyncing: boolean;
  priorityRevision: string | null;
  team: Team;
  now: Date;
}

export function OrderTable({
  orders,
  onRowClick,
  onReorder,
  canReorder,
  isReordering,
  isPrioritySyncing,
  priorityRevision,
  team,
  now,
}: OrderTableProps) {
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);
  const [dragOverOrderId, setDragOverOrderId] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState('');
  const [draftOrderIds, setDraftOrderIds] = useState<string[]>([]);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [hasDraftChanges, setHasDraftChanges] = useState(false);

  const orderIds = useMemo(() => orders.map((order) => order.id), [orders]);
  const orderIdSignature = orderIds.join('\u0000');

  useEffect(() => {
    if (!hasDraftChanges) {
      setDraftOrderIds(orderIds);
      return;
    }

    const currentIds = new Set(orderIds);
    setDraftOrderIds((currentDraft) => [
      ...currentDraft.filter((orderId) => currentIds.has(orderId)),
      ...orderIds.filter((orderId) => !currentDraft.includes(orderId)),
    ]);
  }, [hasDraftChanges, orderIdSignature]);

  const orderById = useMemo(
    () => new Map(orders.map((order) => [order.id, order])),
    [orders],
  );
  const displayedOrders = (
    draftOrderIds.length > 0 ? draftOrderIds : orderIds
  )
    .map((orderId) => orderById.get(orderId))
    .filter((order): order is Order => Boolean(order));

  if (orders.length === 0) return (
    <div className="p-12 border border-dashed border-border rounded-md text-muted-foreground text-center text-sm font-sans bg-card/30">
      No orders match the selected filters.
    </div>
  );

  const showPackStatus = team === 'SYSTEM';
  const showPriority = team === 'SYSTEM';

  const handleDrop = (targetOrderId: string) => {
    if (!canReorder || !draggedOrderId || draggedOrderId === targetOrderId) {
      setDraggedOrderId(null);
      setDragOverOrderId(null);
      return;
    }

    const nextOrderIds = displayedOrders.map((order) => order.id);
    const fromIndex = nextOrderIds.indexOf(draggedOrderId);
    const toIndex = nextOrderIds.indexOf(targetOrderId);
    if (fromIndex < 0 || toIndex < 0) return;
    nextOrderIds.splice(fromIndex, 1);
    nextOrderIds.splice(toIndex, 0, draggedOrderId);
    const topFiveOrderIds = nextOrderIds.slice(0, 5);
    const remainingOrderIds = nextOrderIds.slice(5).sort((a, b) => {
      const orderA = orderById.get(a);
      const orderB = orderById.get(b);
      const dateA = orderA?.confirmedShipDate || '9999-12-31';
      const dateB = orderB?.confirmedShipDate || '9999-12-31';
      const shipDateComparison = dateA.localeCompare(dateB);
      if (shipDateComparison !== 0) return shipDateComparison;
      return (orderA?.salesOrder ?? '').localeCompare(
        orderB?.salesOrder ?? '',
        undefined,
        { numeric: true, sensitivity: 'base' },
      );
    });
    const normalizedOrderIds = [...topFiveOrderIds, ...remainingOrderIds];
    setDraggedOrderId(null);
    setDragOverOrderId(null);
    if (
      normalizedOrderIds.every(
        (orderId, index) => displayedOrders[index]?.id === orderId,
      )
    ) {
      return;
    }
    setReorderError('');
    if (!hasDraftChanges) setDraftRevision(priorityRevision);
    setDraftOrderIds(normalizedOrderIds);
    setHasDraftChanges(true);
  };

  const handleSaveChanges = () => {
    if (!hasDraftChanges || isReordering || isPrioritySyncing) return;
    setReorderError('');
    void onReorder(draftOrderIds, draftRevision)
      .then(() => {
        setHasDraftChanges(false);
        setDraftRevision(null);
      })
      .catch(() => {
        setHasDraftChanges(false);
        setDraftRevision(null);
        setDraftOrderIds(orderIds);
        setReorderError(
          'Priority changes were not saved. The latest shared order is being loaded.',
        );
      });
  };

  const handleDiscardChanges = () => {
    setDraftOrderIds(orderIds);
    setDraftRevision(null);
    setHasDraftChanges(false);
    setReorderError('');
  };

  return (
    <div className="w-full bg-card border border-border rounded-md overflow-x-auto font-sans text-sm">
      {showPriority && (
        <div className="flex min-h-9 items-center justify-start gap-3 border-b border-border bg-muted/30 px-4 py-1.5 text-[10px] font-mono text-muted-foreground">
          {canReorder && hasDraftChanges && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleDiscardChanges}
                className="border border-border px-2.5 py-1 font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={handleSaveChanges}
                className="bg-primary px-3 py-1 font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
              >
                Commit Changes
              </button>
            </div>
          )}
          <div className="min-w-0">
            {isPrioritySyncing
              ? 'Refreshing the shared System priority before more changes…'
              : isReordering
              ? 'Saving all Priority changes…'
              : canReorder
              ? hasDraftChanges
                ? 'Unsaved Priority changes'
                : 'Drag rows to choose and arrange the Top 5, then save your changes.'
              : 'Priority is read-only. Clear search to reorder, or ask for Read/Write access.'}
            {reorderError && <span className="ml-3 text-destructive">{reorderError}</span>}
          </div>
        </div>
      )}
      <table className="w-full min-w-[1260px] text-left border-collapse">
        <thead>
          <tr className="bg-muted text-muted-foreground border-b border-border">
            {showPriority && (
              <th className="w-[92px] py-3 px-4 font-semibold uppercase tracking-wider text-xs">Priority (Top 5)</th>
            )}
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Sales Order</th>
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Customer</th>
            {team === 'SYSTEM' && (
              <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Machine Type</th>
            )}
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Ship Date</th>
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">In Packing [Work Days]</th>
            {showPackStatus && (
              <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Pack Status</th>
            )}
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Carrier</th>
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Mode of Delivery</th>
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Incoterms</th>
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Delivery Location</th>
          </tr>
        </thead>
        <tbody>
          {displayedOrders.map((o, index) => {
            const bucket = getDateBucket(o.confirmedShipDate);
            const packStartedAt = showPackStatus ? o.packStartedAt : null;
            const draftPriority = index < 5 ? index + 1 : null;
            const savedPriority =
              o.priority !== null && o.priority <= 5 ? o.priority : null;
            const priorityChanged =
              hasDraftChanges && savedPriority !== draftPriority;

            const dateColors = {
              OVERDUE: "text-destructive font-bold",
              DUE_TODAY: "text-attention font-bold",
              NEXT_3_DAYS: "text-ready font-bold",
              LATER: "text-muted-foreground"
            };

            return (
              <tr 
                key={o.id} 
                draggable={canReorder}
                onDragStart={(event) => {
                  setDraggedOrderId(o.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', o.id);
                }}
                onDragEnter={() => canReorder && setDragOverOrderId(o.id)}
                onDragOver={(event) => {
                  if (!canReorder) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  handleDrop(o.id);
                }}
                onDragEnd={() => {
                  setDraggedOrderId(null);
                  setDragOverOrderId(null);
                }}
                onClick={() => onRowClick(o.id)}
                className={`border-b hover:bg-muted/50 cursor-pointer transition-colors group ${
                  index === 4 ? 'border-b-2 border-primary/40' : 'border-border'
                } ${
                  dragOverOrderId === o.id ? 'bg-primary/10' : ''
                } ${draggedOrderId === o.id ? 'opacity-50' : ''}`}
              >
                {showPriority && (
                  <td className="w-[92px] py-3 px-4 font-mono font-bold text-primary">
                    <span className="inline-flex items-center gap-1.5">
                      {canReorder && <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />}
                      <span>
                        {hasDraftChanges
                          ? (draftPriority ?? '—')
                          : (savedPriority ?? '—')}
                      </span>
                      {priorityChanged && (
                        <span
                          className="text-[9px] font-medium text-muted-foreground line-through"
                          title={`Previous priority: ${savedPriority ?? 'none'}`}
                          aria-label={`Previous priority ${savedPriority ?? 'none'}`}
                        >
                          {savedPriority ?? '—'}
                        </span>
                      )}
                    </span>
                  </td>
                )}
                <td className="py-3 px-4 font-bold text-foreground group-hover:text-primary transition-colors">
                  <span className="inline-flex items-center gap-2">
                    <span>{o.id}</span>
                    {o.doNotProcess && (
                      <HoldIndicator />
                    )}
                    {o.isRetailOrder && (
                      <span
                        className="border border-primary/60 bg-primary/10 px-1 py-0.5 text-[10px] font-mono font-bold leading-none text-primary"
                        title="Retail order"
                      >
                        ECOMM
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-3 px-4 text-primary font-medium">{o.customer}</td>
                {team === 'SYSTEM' && (
                  <td className="py-3 px-4 font-semibold text-foreground">{o.machineModel || '—'}</td>
                )}
                <td className={`py-3 px-4 font-mono ${dateColors[bucket]}`}>{formatCardDate(o.confirmedShipDate)}</td>
                <td className="whitespace-nowrap py-3 px-4 font-mono text-xs font-semibold text-primary">
                  {formatWorkDaysInPacking(o.inPackingAt, now)}
                </td>
                {showPackStatus && (
                  <td className={`py-3 px-4 font-medium ${packStartedAt ? 'text-ready' : 'text-muted-foreground'}`}>
                    {packStartedAt
                      ? `Started ${formatPackStartDay(packStartedAt)}`
                      : 'Not Started'}
                  </td>
                )}
                <td className="py-3 px-4 text-muted-foreground">{o.carrierForwarderDescription || o.carrierForwarder || 'TBA'}</td>
                <td className="py-3 px-4 text-muted-foreground">{o.modeOfDelivery || '—'}</td>
                <td className="py-3 px-4 text-muted-foreground">{o.incoterms || '—'}</td>
                <td className="py-3 px-4 text-muted-foreground">
                  {[o.deliveryCity, o.deliveryState, o.country].filter(Boolean).join(', ') || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
