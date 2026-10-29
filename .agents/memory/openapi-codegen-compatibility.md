---
name: OpenAPI generator compatibility
description: UUID schema constraint compatibility with the current Orval and Zod versions.
---

Use a UUID string pattern in the OpenAPI schema rather than format: uuid while the generated Zod package uses Zod 3.

**Why:** The current Orval generator emits the Zod 4-only top-level zod.uuid() helper for format: uuid, which fails the shared-library type check against the installed Zod 3 runtime. String patterns generate compatible string().regex() validation.

**How to apply:** Define UUID fields and path parameters as string plus a UUID-shaped regex, regenerate rather than hand-editing generated output, and revisit this constraint if the generator/runtime versions are upgraded together.
