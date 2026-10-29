---
name: System priority policy
description: Owner-confirmed automatic ranking policy for the System packing queue.
---

System priorities are automatic and apply only to the Top 5 of the full current System queue, ordered by earliest Ship Date, then numeric Sales Order number. Renumber contiguously from 1 whenever an order leaves or the schedule changes. Search must not recalculate ranks from a filtered subset.

**Why:** The user replaced manual priority editing and preserved priority gaps with date-driven ranking, explicitly requiring the Top 5 to reset when an order falls off the board.

**How to apply:** Calculate from the authoritative current queue for all users and both views. Do not restore drag-and-drop, Commit/Discard, or saved manual ranking behavior.