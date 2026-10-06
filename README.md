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
  changes; the extension rolls Fate's A/B/C dice, World Sim's d20 and three check dice,
  then tells the model what this reply already holds.
- 🎲 **Fate & Routine**: the extension determines the turn's tier and source, chooses or
  warms a hot Chekhov setup, tracks pursuits, deferred beats, world happenings, ambitions
  and residue. 🌎 **World Sim** chooses a Duo or Standard event for the reply; both results
  appear in the block and are not carried forward.
- 🔫 **Chekhov's Gun**: the model loads setups (`load: … (w2, hot, at 18:00)`) and fires them (`fire B#: …`); the
  ledger ages them, unlocks them at age 6, prunes them at 12, keeps 20 active and says before each
  reply which are due. **Settings → Who fires bullets** chooses Fate's pick by default or the
  model's timing. All engine numbers, including how many fired bullets the block keeps (0 = all),
  are in Settings.
- **🎲 Next turn** in the popup or the newest block's header: lock dice, force a tier/source,
  choose Calm or a bullet, and preview the next turn. Swipes and continues reuse the controls;
  they clear after a later reply. Slash commands: `/ledger-dice fate.a=20 world=7 checks=20,3,11`,
  `/ledger-dice reroll|clear`, `/ledger-force MAJOR WEIGHTED|calm`, and `/ledger-fire B2|none`.
- 🗺️ **Quests tab**: every quest stays in the block; a finished one reaches the model only when you
  tick **Send to the model** (or **Send all finished quests**). The tick is stored in the block
  (`done · sent`), so editing the row works too.
- **Settings → Check style**: DnD (locked DC, as in RF/FF) or Wind's Arrow (as in Sola).
- **Settings → Sections** turns parts off (not tracked, not shown); **Theme** sets the look
  of the block on screen without changing the message text: **Frankenstein** (FF5's folded
  menus), **Sola** (a Now · Present · Fate strip, bond card, thought cabinet, director's note)
  or **Megumin** (one card with Scene · People · Relationships · Story · Fate · Notes tabs).
  Switching restyles every message at once.

## Install

Copy this folder to `data/<user>/extensions/st-story-ledger` (or install from the repo URL
through *Extensions → Install extension*) and reload. Open it from the wand menu
(📒 Story Ledger).

Turn off a preset's own trackers while this is on — FF's BONDS and GM'S NOTEBOOK,
Megumin's bond/state blocks, Sola's HUD notes — or the model will keep two sets of books.

## Switching from another preset

Before a chat has its first Story Ledger block, the newest state block from the preset it ran
under is read **by the extension**, not the model:

- **Freaky / Realistic Frankenstein** `<internal_states>`: turn count, agendas, locations,
  factions, quests, inventory, Chekhov's Gun (ages, hot flags, time locks), the GM's notebook
  and Fate & Routine.
- **Ancient Access** `<ledger>`: turn, last beats, agendas, notebook, the gun and fired list,
  gear, quests, factions.
- **Sola**: story notes and seeds, the date, the scene cast, wardrobe and inventory.

The first reply then gets a short handover asking the model only for what could not be read —
always the relationships (one number such as FF's BOND cannot become twelve axes). FF and AA
bonds are kept as **Awaiting NEW** rows in the relationships card, each with what the old preset
recorded; every turn quotes them to the model until it writes their NEW lines, so the old levels
are never lost to a reply that skips them. Ticks on a relationship with no NEW line join that list
too. The handover also asks for the time
or the cast when the old block lacked them. Rules (`[R]`) from the old notebook wait in the
📜 Rules inbox for your approval.

## Preset copies

`tools/presets/convert.mjs` makes a "+ Story Ledger" copy of a preset from a recipe in
`tools/presets/recipes/`: it switches off the machinery Story Ledger now runs (internal states,
bonds, notebook, agendas, Chekhov, World Sim, Fate, Turn Dice, …) and rewrites the reasoning
step that maintained it. It prints what it would change and writes nothing without `--write`
(and never over an existing file without `--replace`); any prompt or text the recipe expects
but the preset lacks aborts that preset.

```
node tools/presets/convert.mjs tools/presets/recipes/rf-glm-bolt.json            # dry run
node tools/presets/convert.mjs tools/presets/recipes/rf-glm-bolt.json --write    # write the copy
```

## Tests

```
node --test tests/*.test.mjs
```
