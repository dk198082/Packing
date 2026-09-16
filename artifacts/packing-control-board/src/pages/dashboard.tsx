import { useEffect, useState } from 'react';
import { useOrders } from '@/store/use-orders';
import { Header } from '@/components/layout/header';
import { KpiSummary } from '@/components/layout/kpi-summary';
import { BoardView } from '@/components/board/board-view';
import { OrderTable } from '@/components/board/order-table';
import { OrderDrawer } from '@/components/board/order-drawer';
import { EmptyState } from '@/components/board/empty-state';
import { useAuth } from '@/hooks/use-auth';

export function Dashboard() {
  const { user } = useAuth();
  const canEditPackStatus = user.role === 'editor';
  const [nowMs, setNowMs] = useState(() => Date.now());
  const now = new Date(nowMs);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const {
    orders,
    rawOrders,
    isLoading,
    isRefreshing,
    loadError,
    accessRestricted,
    dataNotice,
    refresh,
    activeTeam,
    setActiveTeam,
    searchTerm,
    setSearchTerm,
    viewMode,
    setViewMode,
    selectedOrderId,
    setSelectedOrderId,
    updatePackStartedAt,
    kpis
  } = useOrders(canEditPackStatus);

  const selectedOrder = rawOrders.find(o => o.id === selectedOrderId) || null;

  return (
    <div className="h-[100dvh] overflow-hidden bg-background text-foreground flex flex-col p-6 font-sans">
      <Header 
        activeTeam={activeTeam} 
        setActiveTeam={setActiveTeam} 
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />
      
      <KpiSummary kpis={kpis} />
      
      <div className="flex-1 flex flex-col min-h-0">
        {loadError && rawOrders.length > 0 && (
          <div
            className="mb-2 border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[11px] font-mono text-destructive"
            role="status"
          >
            {loadError}. The board will retry automatically.
          </div>
        )}

        {dataNotice && (
          <div className="mb-2 border border-attention/40 bg-attention/10 px-3 py-1.5 text-[11px] font-mono text-attention">
            {dataNotice}
          </div>
        )}

        {rawOrders.length === 0 ? (
          <EmptyState
            onRefresh={refresh}
            isRefreshing={isRefreshing}
            state={isLoading ? 'LOADING' : accessRestricted ? 'ACCESS_REQUIRED' : loadError ? 'ERROR' : 'EMPTY'}
            error={loadError}
          />
        ) : (
          <div className="flex-1 min-h-0">
            {viewMode === 'CARD' ? (
              <BoardView orders={orders} onOrderClick={setSelectedOrderId} now={now} />
            ) : (
              <OrderTable orders={orders} onRowClick={setSelectedOrderId} team={activeTeam} now={now} />
            )}
          </div>
        )}
      </div>

      <OrderDrawer 
        order={selectedOrder} 
        onClose={() => setSelectedOrderId(null)} 
        onPackStartedChange={updatePackStartedAt}
        canEditPackStatus={canEditPackStatus}
        now={now}
      />
    </div>
  );
}
