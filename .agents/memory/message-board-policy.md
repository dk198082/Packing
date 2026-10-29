---
name: Shared packing message board
description: User-confirmed audience, permissions, and acknowledgment semantics for shift messages.
---

Use one shared message board across Parts and System, replacing the summary tiles. Label it “Messages” without a “Parts + System” subtitle. Only Read/Write users may post. Other signed-in users, including viewers, may OK a message. Read/Write users may also OK their own messages. Show the author and post timestamp, plus each acknowledging user's name and timestamp.

Do not add “Needs my OK” tracking, counts, or personal pending-acknowledgment filters. The user wants posting and visible OK acknowledgments only, not per-operator acknowledgment obligations.

The editor's message textarea has no placeholder. The empty active board displays exactly “No Messages”; do not add a follow-up prompt.

Do not provide Archive/History functionality. A message with no acknowledgments shows a red “New!” badge. The first OK, including an author's own OK when they have Read/Write access, clears the badge and starts a seven-day visibility period; later OKs must not restart that period. Unacknowledged messages remain visible. Remove expired messages from the board without permanently deleting stored records.

The board can be collapsed; its compact view shows only unacknowledged messages, with a new-message count, and provides an expand control.

When expanded, keep the entry box on the left and the messages on the right, never stacked underneath the entry box.

Message content is limited to 200 characters in the UI, API, and database.

New message content must use red text in both expanded and compact views. Completed acknowledgment buttons say “DONE”; keep the message body larger than its metadata and use the card's full width.

**Why:** The user requested red new-message text, “DONE” instead of “OK’d,” and larger text using the space in the message box.

**Why:** The user explicitly requested restoration of the side-by-side layout after the collapse feature accidentally stacked the messages.

**Why:** The user explicitly reduced the maximum message length to 200 characters.

**Why:** The user explicitly chose a single shared board and Read/Write-only posting, then requested the short “Messages” label without a scope subtitle, no composer placeholder, and the concise “No Messages” empty state. They repeatedly rejected the “Needs my OK” feature after an older branch merge restored it. Messages must remain shared and persistent, not browser-local.

**Why:** The user subsequently replaced manual Archive/History with automatic removal seven days after a message is first OK'd. “Remove from the board” does not authorize permanent database deletion.

**Why:** The user requested a compact/collapsible board that surfaces New messages when collapsed; acknowledged messages and the composer stay in the expanded view.

**Why:** The user explicitly approved allowing Read/Write users to OK their own messages, including clearing New! and starting the seven-day timer.

**How to apply:** Treat posting as an editor-only shared write; freshly reauthorize OK writes for either allowed role. Keep timestamps and authors server-owned. Allow author self-OK only with current Read/Write access, and count it like any other OK. After message-board branch merges, remove any reintroduced Archive/History or personal acknowledgment filters and run the frontend policy regression test. Apply expiry server-side using the earliest acknowledgment and seven elapsed 24-hour days.
