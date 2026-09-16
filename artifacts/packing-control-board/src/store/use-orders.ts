import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  getPackingOrders,
  updatePackStatus,
  type PackingOrder,
} from '@workspace/api-client-react';
import type { Order, Team, ViewMode } from '@/lib/types';
import { getReadiness, getDateBucket } from '@/lib/order-logic';
import {
  clearLegacyLocalPackStartedAt,
  getOperatorFields,
} from '@/lib/operator-fields';

const LIVE_DATA_ACCESS_ENABLED = true;

const ORDER_REFRESH_INTERVAL_MS = 30_000;
function toOrder(order: PackingOrder): Order {
  return order;
}

export function useOrders(canEditPackStatus: boolean) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(LIVE_DATA_ACCESS_ENABLED);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accessRestricted, setAccessRestricted] = useState(!LIVE_DATA_ACCESS_ENABLED);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<Team>("PARTS");
  const [searchTerm, setSearchTerm] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("CARD");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const refreshInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!LIVE_DATA_ACCESS_ENABLED || refreshInFlight.current) return;

    refreshInFlight.current = true;
    setIsRefreshing(true);
    try {
      const result = await getPackingOrders();
      const mappedOrders = result.orders.map(toOrder);
      const ordersWithMigratedPackStatus = await Promise.all(
        mappedOrders.map(async (order) => {
          if (order.team !== 'SYSTEM') return order;

          const legacyPackStartedAt = canEditPackStatus
            ? getOperatorFields(order.id).packStartedAt
            : null;
          if (!legacyPackStartedAt) return order;

          if (order.packStartedAt) {
            clearLegacyLocalPackStartedAt(order.id);
            return order;
          }

          try {
            const status = await updatePackStatus(order.id, {
              packStartedAt: legacyPackStartedAt,
            });
            clearLegacyLocalPackStartedAt(order.id);
            return { ...order, packStartedAt: status.packStartedAt };
          } catch {
            return order;
          }
        }),
      );
      setOrders(ordersWithMigratedPackStatus);
      setLastUpdated(new Date(result.fetchedAt));
      setLoadError(null);
      setAccessRestricted(false);
      const notices = [
        result.skippedRows > 0
          ? `${result.skippedRows} source row${result.skippedRows === 1 ? '' : 's'} could not be assigned to Parts or System and is not shown.`
          : null,
      ].filter(Boolean);
      setDataNotice(notices.length ? notices.join(' ') : null);
    } catch (error) {
      setAccessRestricted(
        typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 403,
      );
      setLoadError(
        error instanceof Error
          ? error.message
          : 'The live packing source could not be reached.',
      );
    } finally {
      refreshInFlight.current = false;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canEditPackStatus]);

  useEffect(() => {
    if (!LIVE_DATA_ACCESS_ENABLED) return;

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, ORDER_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [refresh]);

  const updatePackStartedAt = useCallback(async (
    orderId: string,
    packStartedAt: string | null,
  ) => {
    if (!canEditPackStatus) {
      throw new Error('Editor access is required to change Pack Started status.');
    }
    const status = await updatePackStatus(orderId, { packStartedAt });
    setOrders((currentOrders) => currentOrders.map((order) => (
      order.id === status.orderId
        ? { ...order, packStartedAt: status.packStartedAt }
        : order
    )));
    return status.packStartedAt;
  }, [canEditPackStatus]);

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (o.team !== activeTeam) return false;
      const query = searchTerm.trim().toLowerCase();
      if (query) {
        const matchesSearch =
          o.salesOrder.toLowerCase().includes(query) ||
          o.customer.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      return true;
    }).sort((a, b) => {
      const dateA = a.confirmedShipDate || "9999-12-31";
      const dateB = b.confirmedShipDate || "9999-12-31";
      const shipDateComparison = dateA.localeCompare(dateB);
      if (shipDateComparison !== 0) return shipDateComparison;

      return a.salesOrder.localeCompare(b.salesOrder, undefined, {
        numeric: true,
        sensitivity: 'base',
      });
    });
  }, [orders, activeTeam, searchTerm]);

  const kpis = useMemo(() => {
    const teamOrders = orders.filter(o => o.team === activeTeam);
    let overdue = 0, dueToday = 0, next3Days = 0, onHold = 0;
    
    teamOrders.forEach(o => {
      const bucket = getDateBucket(o.confirmedShipDate);
      if (bucket === 'OVERDUE') overdue++;
      if (bucket === 'DUE_TODAY') dueToday++;
      if (bucket === 'NEXT_3_DAYS') next3Days++;
      if (getReadiness(o) === 'HOLD') onHold++;
    });

    return {
      total: teamOrders.length,
      overdue,
      dueToday,
      next3Days,
      onHold
    };
  }, [orders, activeTeam]);

  return {
    orders: filteredOrders,
    rawOrders: orders,
    isLoading,
    isRefreshing,
    lastUpdated,
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
  };
}
