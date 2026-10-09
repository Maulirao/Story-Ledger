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
- **✎** appears on the last reply's block when the reply has no ledger comment, or has one
  without any Thoughts (while Thoughts are on). It asks the model for just that part and keeps
  nothing else: the prose is never changed, an existing comment's lines are never rewritten
  (only Thoughts are added to it), and the reply's dice and any armed fudges are left alone.
  If the answer is not usable, or you stop it or edit the reply meanwhile, the reply stays
  exactly as it was. Choose the context under **Settings → Ledger fix-up context**: *Full*
  sends the normal prompt (a provider that caches prompts may reuse most of it), *Lean* sends
  a short one — the main prompt, character cards, the Summarize memory, the ledger state and
  the last N messages (**Recent messages**, 0–20, default 4) — which costs far fewer input
  tokens on long chats but does not reuse the chat's cached prefix.
- Harmless formatting in the comment (bullets, bold labels, curly quotes, heading case) is
  accepted; lines under unknown headings are reported. ↻ rebuilding an old reply may now
  apply a formerly unread line, and may refuse a formerly accepted incomplete `NEW` or
  impossible agenda progress.
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

## World event updates

For an existing World entry, report only new facts. Both commands work under `Fate:`
or `World:` and append to its history without replacing the original description:

```text
Fate:
- update W2: Part sourced from Gatineau dealer; Thursday now earliest, possibly weekend.
- escalate W3: The shortage now affects the neighbouring town.
```

`update` leaves proximity and Reach unchanged. `escalate` advances proximity one band
toward LOCAL and raises Reach by 1, capped at 3; an annotation is still saved at the
caps. Neither command resets age. Updates follow their order in the comment, even
when headings alternate. An annotation may continue on more deeply indented text
lines; a new command or heading ends it. Older entries need no migration.

`World CONSEQUENCE landed as aftermath` is also accepted under `Fate:` or `World:`
for a consequence that actually occurred in the story, such as the race buoy breaking.
It saves the aftermath as residue on TRUE or WEIGHTED turns, without changing the
rolled World Sim event or clearing unrelated owed aftermath.

Other `World EVENT landed as aftermath` reports name the rolled World Sim event: use the exact
announced event name, and only when Fate's source is TRUE and that event was realized.
For a separate consequence of story actions, use `MINOR consequence landed: aftermath`
or `MAJOR consequence landed: aftermath`, matching this turn's tier.

After installing an update, reload SillyTavern. To apply newly supported commands in
an existing reply, edit its hidden comment if needed and click **↻** on that reply's
block. A rebuild starts from the previous block and reuses the reply's saved dice.

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

In ledger comments, `status - condition` safely clears a condition even if it is
already absent. Ambiguous names and malformed commands still produce notices.
Item and title removals still require a matching entry. Install updates and use ↻
to rebuild an existing reply with the current parser.

Inventory entries have persistent IDs (`I1`, `I2`, …), assigned by the extension
and shown in the model's inventory prompt and saved state. Existing inventories
gain IDs automatically without changing their descriptions. Use `- I7 (left behind)`
to remove a specific entry, or `I7 update: towel (on Jan)` to change its description
without changing its ID. Additions stay `+ item`; the model must not invent IDs.
ID removals also accept multiple parenthetical notes, such as
`- I7 ($50) (paid for supplies)`; the ID determines which entry is removed.
One ID identifies one listed entry, including any quantity in its description.
Removed IDs are not reused along the retained sequence of snapshots.

Name removals prefer the full stored name. Otherwise, they compare base names
while ignoring trailing parenthetical notes on both sides, regardless of their
wording. `1 towel` also matches `towel`; other leading quantities stay significant.
This deliberately permits removing a unique `towel (blue)` as `towel`. Multiple
matching entries require a full name or ID. Parentheses inside a name remain
literal. An unknown or malformed ID command never falls back to a name match.
These expanded command readings apply to ledger comments; tagged replies retain
their old name-matching behavior.

IDs survive save/read cycles. Swipes and ↻ rebuilds use their preceding snapshot,
so a discarded alternative cannot remove an item or consume an ID in another.

Money and Supplies are tracked within Inventory. Money has numeric balances per
currency and no item IDs. For example, `money: 50 USD` establishes a balance,
`money - 18 USD (purchase)` leaves 32, and `money + 5 USD (refund)` adds five.
Currency symbols also work (`money: $50`). Currency may be omitted when there is
only one known balance; an initial amount without a currency remains unspecified.
Different currencies stay separate; there is no automatic currency conversion.
Only explicit initialization/correction sets a total. Income and expenses use deltas.

For ammo and other counted or measured supplies, `supply: 12 rounds | 9mm ammunition`
creates a stack with an item ID. `I7 adjust: -3 (fired)` consumes three from that
stack; `I7 adjust: +5 (restocked)` replenishes it. `I7 quantity: 12 rounds`
establishes or corrects the quantity of an existing item. Description updates retain
the quantity. A whole-entry removal deletes both the item and its quantity.

The extension calculates amounts with exact decimal arithmetic, keeps zero balances
and stacks for replenishment, and refuses an adjustment that exceeds a known amount.
Unknown targets and malformed amounts leave the target unchanged. Save/read cycles,
swipes and rebuilds preserve the same arithmetic from the preceding snapshot.
Existing items are not automatically interpreted as balances or stacks; noteworthy
bills can stay ordinary items or counted supplies without automatically changing Money.

Relationship ticks, DIRECT shifts and NOTE changes written before `NEW` are saved
in the reply's Relationships section. The next prompt requests the missing baseline
and shows the saved interactions. Once a complete baseline arrives, those changes
apply once; ticks retain the cap for each original turn. Conversion and decay run
at the turn of initialization, without rewriting earlier turns. Swipes and rebuilds
use their own preceding snapshot, so discarded alternatives do not add changes.

Recognized `World EVENT landed as aftermath` reports save what happened in the
story even when that label differs from the World Sim selection. They record residue
without changing the dice, tier, source, tracked World entries or unrelated residue debt.
Unknown labels and empty aftermath still produce notices.

Automatic placement adds a short system reminder at chat depth zero for the ledger
comment, enabled NPC Thoughts, and missing relationship baselines. Macro placement
includes that reminder in `{{story_ledger}}`. This improves prompt emphasis; it cannot
guarantee that every provider will include the requested content.

## Tests

```
node --test tests/*.test.mjs
```
