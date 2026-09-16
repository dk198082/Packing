---
name: Entra and Admin Console access
description: Durable authentication and authorization rules for the Packing Control Board.
---

Identify signed-in users by the stable Microsoft Entra `oid` claim, not by email. Authorize that identity server-to-server through the Admin Console and fail closed if the authorization response is denied, unavailable, or invalid.

Recheck central authorization periodically for reads and immediately before every shared Pack Started write so revocations and role downgrades do not persist in rolling sessions. The Admin Console currently displays the app-scoped role as `Read / Write`; exact normalized legacy or app-prefixed forms are also accepted. Other allowed roles are viewers.

Keep sessions in the managed application PostgreSQL database. Never use or modify the Azure ERP database for authentication, sessions, or authorization state.

**Why:** Admin Console is the source of truth for access and roles, while Azure ERP must remain read-only. Rolling sessions must not allow revoked access or an old editor role to continue indefinitely. Match only confirmed exact role forms; substring matching can grant write access to misleading names.

**How to apply:** Any new server route exposing packing data must require a centrally authorized session. Any new shared mutation must force a fresh authorization check and enforce the required role on the server.