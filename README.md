# Story Ledger

A SillyTavern extension that keeps three kinds of story state for any preset:

- **Rules notebook** — `[R]` rules only change with your approval (the model proposes,
  you approve or reject in the popup); `[T]` open threads update every reply.
- **Story clock** — the model writes `Now:` each reply; the ledger warns when the day goes
  backwards, and you can override the time from the popup.
- **Relationships** — the FrankenSIM 13-axis engine (12 opposed axes 1–20 plus Φ
  self-regard). The model only reports this reply's events (ticks, DIRECT moments, NEW
  pairs); the extension does the arithmetic. Every engine number is editable under
  Settings, defaulting to FrankenSIM 3.0.

## How it works

The model ends each reply with a hidden comment (`<!-- Story_Ledger … -->`) holding only
what changed in that reply. Story Ledger reads the state from the previous reply's block,
applies the changes and the engine's own bookkeeping, and writes the full state block into
the reply — FF's `<internal_states>` layout, folded under **🎬 INTERNAL STATES (Turn N)**.

- **The newest block is the truth.** To correct anything, edit the numbers or lines in the
  newest reply's block; the next turn starts from your edit.
- **↻** in the block's header rebuilds that block from the one before it and the reply's
  comment (for when you edited the comment instead). Nothing rebuilds on its own.
- Swipes, deletes and branches work like FF's block: each reply carries its own state.
- Blocks and old comments are stripped from the prompt; the current state is injected once.
- The block's sections: 🕰️ Scene · 👥 Scene cast · 💞 Relationships · 📓 Notebook ·
  👤 NPC agendas (off-screen ones advance a step per turn on their own) · 👤 NPC locations ·
  🏳️ Factions · 📜 Quests (finished ones stay) · 🎒 Inventory ({{user}} only) · 🧾 Last beats ·
  and, for that reply only, 🧠 Thoughts · 🎲 Checks · 🌌 Physics. The model reports only
  changes; the extension rolls the check dice (three d20s per reply) and tells the model.
- **Settings → Check style**: DnD (locked DC, as in RF/FF) or Wind's Arrow (as in Sola).
- **Settings → Sections** turns parts off (not tracked, not shown); **Theme** sets the look
  of the block on screen without changing the message text.

## Install

Copy this folder to `data/<user>/extensions/st-story-ledger` (or install from the repo URL
through *Extensions → Install extension*) and reload. Open it from the wand menu
(📒 Story Ledger).

Turn off a preset's own trackers while this is on — FF's BONDS and GM'S NOTEBOOK,
Megumin's bond/state blocks, Sola's HUD notes — or the model will keep two sets of books.

## Switching from another preset

When the newest state in the chat came from Freaky/Realistic Frankenstein, Megumin, Sola or
Ancient Access, the next prompt carries a one-time handover: the model seeds the ledger
from that state (time, threads, a NEW line per relationship, rules as proposals). An FF
turn number carries over automatically so the schedules continue.

## Tests

```
node --test tests/*.test.mjs
```
