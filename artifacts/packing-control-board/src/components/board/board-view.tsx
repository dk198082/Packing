import type { Order, DateBucket } from '@/lib/types';
import { getDateBucket } from '@/lib/order-logic';
import { OrderCard } from './order-card';
import { AlertTriangle, Calendar, Clock, Inbox } from 'lucide-react';

interface BoardViewProps {
  orders: Order[];
  onOrderClick: (id: string) => void;
  now: Date;
}

export function BoardView({ orders, onOrderClick, now }: BoardViewProps) {
  const grouped: Record<DateBucket, Order[]> = {
    OVERDUE: [],
    DUE_TODAY: [],
    NEXT_3_DAYS: [],
    LATER: []
  };
  
  orders.forEach(o => {
    const bucket = getDateBucket(o.confirmedShipDate);
    grouped[bucket].push(o);
  });
  
  return (
    <div className="flex gap-2.5 h-full overflow-x-auto pb-2">
      <BoardColumn 
        title="OVERDUE" 
        count={grouped.OVERDUE.length} 
        icon={<AlertTriangle className="w-4 h-4" />}
        colorClass="text-destructive border-destructive"
        orders={grouped.OVERDUE}
         onOrderClick={onOrderClick}
         now={now}
      />
      <BoardColumn 
        title="DUE TODAY" 
        count={grouped.DUE_TODAY.length} 
        icon={<Calendar className="w-4 h-4" />}
        colorClass="text-attention border-attention"
        orders={grouped.DUE_TODAY}
         onOrderClick={onOrderClick}
         now={now}
      />
      <BoardColumn 
        title="NEXT 3 DAYS" 
        count={grouped.NEXT_3_DAYS.length} 
        icon={<Clock className="w-4 h-4" />}
        colorClass="text-ready border-ready"
        orders={grouped.NEXT_3_DAYS}
         onOrderClick={onOrderClick}
         now={now}
      />
      <BoardColumn 
        title="LATER" 
        count={grouped.LATER.length} 
        icon={<Inbox className="w-4 h-4" />}
        colorClass="text-muted-foreground border-border"
        orders={grouped.LATER}
         onOrderClick={onOrderClick}
         now={now}
      />
    </div>
  );
}

function BoardColumn({ title, count, icon, colorClass, orders, onOrderClick, now }: any) {
  return (
    <div className="flex-1 min-w-[170px] max-w-none flex flex-col gap-2 border border-border bg-card/20 rounded-md p-2">
      <div className={`flex items-center gap-1.5 pb-2 border-b border-border ${colorClass} uppercase font-bold tracking-wider text-xs`}>
        {icon} {title} ({count})
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto pb-4 pr-0.5">
        {orders.map((o: any) => (
          <OrderCard key={o.id} order={o} onClick={() => onOrderClick(o.id)} now={now} />
        ))}
        {orders.length === 0 && (
          <div className="p-3 border border-dashed border-border rounded-md text-muted-foreground text-center text-xs font-sans mt-1">
            No orders
          </div>
        )}
      </div>
    </div>
  );
}
