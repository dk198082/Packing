---
name: Operator packing storage
description: Storage boundaries for operator-entered packaging fields and shared System pack-start status.
---

Weight (lbs), Box #, Pick IDs, and System pack-start status are operator-entered data, separate from
the read-only Azure ERP feed. Weight, Box #, and Pick IDs remain browser-local per order. System
pack-start timestamps are shared through the app API and an app-owned Azure `d365fo` table so all users see the
same status.

**Why:** the user originally chose local-only storage for simplicity on 2026-08-26, then explicitly
requested shared Pack Started visibility on 2026-09-02. Packaging details were not included in that
change and remain local.

**How to apply:** treat the shared API/database value as authoritative for Pack Started. Write only to
the app-owned `d365fo` packing table, never an ERP source table. Do not sync Weight, Box #, or Pick IDs unless the user explicitly
requests that separate storage-boundary change.

Box # dropdown list is a fixed set of ~17 known box IDs with inconsistent formatting (e.g.
"BOX-13-SHI80501" lacks a dash before the suffix). Sort/parse logic must extract just the numeric
value after "BOX-" via regex, not assume a fixed string pattern.
