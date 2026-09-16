---
name: Azure packing data boundary
description: Security and correctness guardrails for the live Azure packing source.
---

The Packing Control Board must access Azure Postgres only from the API server, use verified TLS, and return only explicitly normalized order fields to the browser. D365 ERP source tables remain read-only.

**Why:** Raw ERP records can contain fields unrelated to the board and could expose internal data. Missing or unrecognized hold signals must not be presented as safe-to-process orders.

**How to apply:** When adding fields or changing source logic, extend the explicit normalized API contract deliberately, keep disabled/unverified TLS rejected, and show source degradation or unknown safety information clearly to operators.

## Access posture

The live packing endpoint is intentionally unauthenticated at the owner's request; the API must still query Azure server-side and return only the approved normalized fields.

**Why:** On 2026-08-25, the project owner explicitly requested removal of login authorization and restoration of the public live board.

**How to apply:** Do not add authentication or authorization gates unless requested. Preserve the server-side data boundary, verified TLS, explicit normalized response contract, and restrictive cross-origin policy if cross-origin access is introduced later.

## Packing-source scope

The board reads the D365 sales-order staging table directly with a server-side, read-only query. Eligible rows require company `TOUS`, exact Parts/System pools, `In Packing = 1`, sales type `3` (Sales Order), and open sales status `1`.

**Why:** The upstream packing view filters sales type `0`, which is Journal rather than Sales Order. Direct staging reads preserve the Azure read-only boundary while applying the owner-confirmed Sales Order criterion.

**How to apply:** When counts or orders are missing, compare the staging row and its sync timestamp against every eligibility field. Do not change the numeric D365 enum filters without confirming their labels and owner intent.

## In-packing entry time

Capture the first observed eligible `In Packing = 1` time in the app-managed database and keep it immutable for that sales order. Seed an existing order from the ERP source-modified time when available.

**Why:** The ERP staging source exposes the checkbox and a general record-modified timestamp, but no dedicated timestamp for when the checkbox was selected. Persisting first observation prevents unrelated later ERP edits from changing the displayed packing-entry time.

**How to apply:** Keep the ERP read-only. When eligible orders are refreshed, insert missing entry records without updating conflicts, and return the shared captured timestamp through the normalized API contract.

## App-owned tables in d365fo

Packing sessions, first-observed packing timestamps, and shared Pack Started status use the generic app-owned tables in Azure schema `d365fo`. ERP staging tables remain read-only.

**Why:** On 2026-09-10, the owner explicitly chose the existing generic `d365fo.sessions` table and requested the two packing business tables be moved from Replit PostgreSQL into the same schema.

**How to apply:** Route all runtime reads and writes for these three app-owned tables through the Azure server connection. Do not extend write access to ERP staging tables.

## Packing work schedule

Elapsed In Packing work time counts only Monday through Friday from 7:00 AM through 3:30 PM. One displayed workday represents one complete 8.5-hour shift; time outside the shift and weekends contributes nothing.

**Why:** The project owner confirmed that elapsed packing time must reflect the actual shop schedule rather than all weekday clock hours.

**How to apply:** Clip each weekday interval to the scheduled shift before totaling elapsed time. Preserve partial shifts, ignore nights and weekends, and convert each complete 510 working minutes into one displayed workday.

## Retail-order signal

Treat a nonzero Sales Order header retail-channel reference as a retail order; a blank or zero reference is non-retail.

**Why:** The source does not expose a literal Retail Order boolean. Owner-confirmed examples showed a nonzero retail-channel reference for a known retail order and zero for a known non-retail order.

**How to apply:** Normalize the header reference to a boolean at the API boundary. Use that normalized value for board and label indicators rather than inferring retail status from customer names or other descriptive fields.