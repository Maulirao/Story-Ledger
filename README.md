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

The model writes its block at the end of each reply inside an HTML comment
(`<!-- Story_Ledger … -->`), so it never shows in the chat. Everything is recomputed from
the chat, so swipes, edits and deletions just work. Older blocks are stripped from the
prompt; the current state is injected instead.

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
turn number carries over automatically so decay schedules continue.

## Tests

```
node --test tests/*.test.mjs
```
