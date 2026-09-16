import type { Order } from '@/lib/types';
import {
  getDateBucket,
  formatCardDate,
  formatWorkDaysInPackingCompact,
} from '@/lib/order-logic';
import { formatPackStartDay } from '@/lib/operator-fields';
import { AlertTriangle } from 'lucide-react';

export function OrderCard({
  order,
  onClick,
  now,
}: {
  order: Order;
  onClick: () => void;
  now: Date;
}) {
  const bucket = getDateBucket(order.confirmedShipDate);
  const packStartedAt = order.team === 'SYSTEM' ? order.packStartedAt : null;

  const dateColors = {
    OVERDUE: "text-destructive",
    DUE_TODAY: "text-attention",
    NEXT_3_DAYS: "text-ready",
    LATER: "text-muted-foreground"
  };

  return (
    <div 
      onClick={onClick}
      className="bg-card border border-border rounded-md p-1.5 cursor-pointer hover:border-muted-foreground transition-colors group flex flex-col gap-1"
    >
      <div className="flex justify-between items-start">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-base font-bold font-sans text-foreground">{order.salesOrder}</span>
          {order.isRetailOrder && (
            <span
              className="inline-flex shrink-0 border border-primary/60 bg-primary/10 px-1 py-0.5 text-[10px] font-mono font-bold leading-none text-primary"
              title="Retail order"
            >
              ECOMM
            </span>
          )}
          {order.doNotProcess && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 border border-destructive/60 bg-destructive/10 px-1 py-0.5 text-[10px] font-mono font-bold leading-none text-destructive"
              title="Sales order is on hold"
              aria-label="Sales order is on hold"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span>HOLD</span>
            </span>
          )}
        </div>
        <div className="min-w-0 text-right">
          <span className={`block text-xs font-mono font-bold ${dateColors[bucket]}`}>{formatCardDate(order.confirmedShipDate)}</span>
          <span
            className="block whitespace-nowrap text-[9px] font-mono font-bold tracking-wide text-primary"
            title={`In Packing [Work Days] for ${formatWorkDaysInPackingCompact(order.inPackingAt, now)}`}
          >
            IN PACKING [WORK DAYS] {formatWorkDaysInPackingCompact(order.inPackingAt, now)}
          </span>
          {order.team === 'SYSTEM' && (
            <span
              className={`block truncate text-[9px] font-mono font-bold tracking-wide ${packStartedAt ? 'text-ready' : 'text-muted-foreground'}`}
              title={packStartedAt ? `Pack started ${new Date(packStartedAt).toLocaleString()}` : 'Pack not started'}
            >
              {packStartedAt ? `PACK STARTED ${formatPackStartDay(packStartedAt)}` : 'PACK NOT STARTED'}
            </span>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-sans text-primary font-medium">
          {order.customer}
        </span>
        {order.team === 'SYSTEM' && (
          <span className="min-w-0 max-w-[45%] truncate text-right text-xs font-sans font-semibold text-foreground">
            {order.machineModel || '—'}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-sans text-muted-foreground truncate">
          {[order.modeOfDelivery, order.incoterms].filter(Boolean).join(' - ') || '—'}
        </span>
        <span className="min-w-0 max-w-[52%] text-right text-xs font-sans text-muted-foreground truncate">
          {[order.deliveryCity, order.deliveryState, order.country].filter(Boolean).join(', ') || '—'}
        </span>
      </div>
    </div>
  );
}
