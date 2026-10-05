interface PriorityOrder {
  id: string;
  team: string;
  confirmedShipDate: string;
  salesOrder: string;
}

/**
 * Rank the current System queue, never a filtered subset or a saved manual order.
 * Recomputing each snapshot fills gaps immediately when an order leaves the queue.
 */
export function getAutomaticSystemOrderPriorities(
  orders: readonly PriorityOrder[],
): Map<string, number> {
  const sortedOrders = orders
    .filter((order) => order.team === "SYSTEM")
    .sort((a, b) => {
      const dateComparison = (a.confirmedShipDate || "9999-12-31")
        .localeCompare(b.confirmedShipDate || "9999-12-31");
      if (dateComparison !== 0) return dateComparison;
      return a.salesOrder.localeCompare(b.salesOrder, "en", {
        numeric: true,
        sensitivity: "base",
      });
    });

  return new Map(
    sortedOrders.slice(0, 5).map((order, index) => [order.id, index + 1]),
  );
}