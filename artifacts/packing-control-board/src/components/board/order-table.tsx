import type { Order, Team } from '@/lib/types';
import {
  getDateBucket,
  formatCardDate,
  formatWorkDaysInPacking,
} from '@/lib/order-logic';
import { formatPackStartDay } from '@/lib/operator-fields';

interface OrderTableProps {
  orders: Order[];
  onRowClick: (id: string) => void;
  team: Team;
  now: Date;
}

export function OrderTable({ orders, onRowClick, team, now }: OrderTableProps) {
  if (orders.length === 0) return (
    <div className="p-12 border border-dashed border-border rounded-md text-muted-foreground text-center text-sm font-sans bg-card/30">
      No orders match the selected filters.
    </div>
  );

  const showPackStatus = team === 'SYSTEM';

  return (
    <div className="w-full bg-card border border-border rounded-md overflow-x-auto font-sans text-sm">
      <table className="w-full min-w-[1260px] text-left border-collapse">
        <thead>
          <tr className="bg-muted text-muted-foreground border-b border-border">
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Order ID</th>
            {team === 'SYSTEM' && (
              <th aria-label="Machine Type" className="py-3 px-4 font-semibold uppercase tracking-wider text-xs" />
            )}
            <th className="py-3 px-4 font-semibold uppercase tracking-wider text-xs">Customer</th>
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
          {orders.map(o => {
            const bucket = getDateBucket(o.confirmedShipDate);
            const packStartedAt = showPackStatus ? o.packStartedAt : null;

            const dateColors = {
              OVERDUE: "text-destructive font-bold",
              DUE_TODAY: "text-attention font-bold",
              NEXT_3_DAYS: "text-ready font-bold",
              LATER: "text-muted-foreground"
            };

            return (
              <tr 
                key={o.id} 
                onClick={() => onRowClick(o.id)}
                className="border-b border-border hover:bg-muted/50 cursor-pointer transition-colors group"
              >
                <td className="py-3 px-4 font-bold text-foreground group-hover:text-primary transition-colors">
                  <span className="inline-flex items-center gap-2">
                    <span>{o.id}</span>
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
                {team === 'SYSTEM' && (
                  <td className="py-3 px-4 font-semibold text-foreground">{o.machineModel || '—'}</td>
                )}
                <td className="py-3 px-4 text-primary font-medium">{o.customer}</td>
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
