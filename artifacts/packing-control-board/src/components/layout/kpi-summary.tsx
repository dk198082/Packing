import { AlertTriangle, Calendar, Clock, PauseCircle, Package } from 'lucide-react';

interface KPIs {
  total: number;
  overdue: number;
  dueToday: number;
  next3Days: number;
  onHold: number;
}

export function KpiSummary({ kpis }: { kpis: KPIs }) {
  return (
    <div className="grid grid-cols-5 gap-2.5 mt-2 mb-2">
      <KpiCard 
        icon={<Package className="w-6 h-6 text-primary" />}
        value={kpis.total}
        label="IN PACKING"
        borderColor="border-border"
      />
      <KpiCard 
        icon={<AlertTriangle className="w-6 h-6 text-destructive" />}
        value={kpis.overdue}
        label="OVERDUE"
        borderColor="border-border"
      />
      <KpiCard 
        icon={<Calendar className="w-6 h-6 text-attention" />}
        value={kpis.dueToday}
        label="DUE TODAY"
        borderColor="border-border"
      />
      <KpiCard 
        icon={<Clock className="w-6 h-6 text-ready" />}
        value={kpis.next3Days}
        label="NEXT 3 DAYS"
        borderColor="border-border"
      />
      <KpiCard 
        icon={<PauseCircle className="w-6 h-6 text-destructive" />}
        value={kpis.onHold}
        label="ON HOLD"
        borderColor="border-border"
      />
    </div>
  );
}

function KpiCard({ icon, value, label, borderColor }: any) {
  return (
    <div className={`bg-card border ${borderColor} rounded-md p-2.5 flex min-w-0 items-center gap-2.5`}>
      <div className="flex-shrink-0">
        {icon}
      </div>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="text-3xl font-bold font-sans text-foreground leading-none">{value}</span>
        <span className="min-w-0 truncate text-sm font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
    </div>
  );
}
