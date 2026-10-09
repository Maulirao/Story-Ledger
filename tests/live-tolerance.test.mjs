// Change lines a model really wrote on its first Story Ledger turn. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { relationsNotice } from "../src/model/relations.js";
import factions from "../src/model/sections/factions.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const run = (s, body) => postTurn(s, ch(body), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });

test("a faction line with several fields, written the way the state shows them, applies", () => {
    const r = run(emptyState(), "Factions:\n- Harbour Guild: intel the tax is coming | state loud, mobilizing | relations the mayor resets the feud");
    assert.deepEqual(r.state.factions["Harbour Guild"], { goal: "", intel: "the tax is coming", fibs: "", state: "loud, mobilizing", conflict: "", relations: "the mayor resets the feud" });
    assert.ok(!r.unparsed.some(u => u.section === "Factions"));
});

test("dot-separated and colon forms of several faction fields apply too", () => {
    const r = run(emptyState(), "Factions:\n- Harbour Guild: goal: the docks · state: low morale");
    assert.equal(r.state.factions["Harbour Guild"].goal, "the docks");
    assert.equal(r.state.factions["Harbour Guild"].state, "low morale");
});

test("a faction field's text may itself contain a pipe-free word like 'state'", () => {
    const r = run(emptyState(), "Factions:\n- Harbour Guild: intel the state police are watching");
    assert.equal(r.state.factions["Harbour Guild"].intel, "the state police are watching");
    assert.equal(r.state.factions["Harbour Guild"].state, "");
});

test("the screenshot's grouped faction fields retain their shared description and trailing note", () => {
    const description = "race judged, winner recorded | now spreading the crayon-marriage version camp-wide";
    const s = emptyState();
    s.factions["Little Cousins Pack"] = { goal: "judge the race", intel: "secret", fibs: "a lie", state: "waiting", conflict: "rivals", relations: "friends" };
    const r = run(s, `Factions:\n- Little Cousins Pack: goal|state: ${description}`);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.factions["Little Cousins Pack"], { ...s.factions["Little Cousins Pack"], goal: description, state: description });
    assert.deepEqual(parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C }).state.factions, r.state.factions);
    assert.equal(s.factions["Little Cousins Pack"].goal, "judge the race");
});

test("grouped faction labels can mix with independent fields and literal pipe notes", () => {
    const r = run(emptyState(), "Factions:\n- Pack: GOAL | STATE: judged | now spreading news · fib|relations: friendly | intel: state police watching");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.factions.Pack, { goal: "judged | now spreading news", intel: "state police watching", fibs: "friendly", state: "judged | now spreading news", conflict: "", relations: "friendly" });
});

test("incomplete and unknown faction labels stay unread without partial updates", () => {
    const s = emptyState();
    s.factions.Pack = { goal: "old goal", intel: "", fibs: "", state: "old state", conflict: "", relations: "" };
    const lines = ["Pack: goal|state:", "Pack: goal|state :", "Pack: goal : | state: new", "Pack: goal|unknown: text", "Pack: state: judged | goal", "Pack: state: judged | unknown: text", "Pack: |state: judged"];
    const r = run(s, `Factions:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Factions", line })));
    assert.deepEqual(r.state.factions, s.factions);
});

test("the faction command examples demonstrate concrete field updates", () => {
    const examples = factions.commands.filter(c => c.id !== "factions.drop").map(c => c.example);
    const r = run(emptyState(), `Factions:\n${examples.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.unparsed, []);
    assert.equal(r.state.factions["Harbour Guild"].goal, "control the docks");
    assert.equal(r.state.factions["Harbour Guild"].state, "shaken after the fire");
    assert.equal(r.state.factions["Harbour Guild"].intel, "knows about the smuggling");
});

test("a World line written inside the Fate list is read as a World line", () => {
    const r = run(emptyState(), "Fate:\n- World: + LOCAL: the cousin arrives four hours early");
    assert.deepEqual(r.state.fate.world.map(w => [w.prox, w.desc]), [["LOCAL", "the cousin arrives four hours early"]]);
    assert.ok(!r.unparsed.some(u => /World/.test(u.line)));
});

test("words before the proximity are kept in the happening", () => {
    const r = run(emptyState(), "World:\n- + ARRIVAL landed LOCAL: the cousin four hours early");
    assert.deepEqual(r.state.fate.world.map(w => [w.prox, w.desc]), [["LOCAL", "ARRIVAL landed — the cousin four hours early"]]);
});

test("the relationship notice names each refused line and why", () => {
    const text = relationsNotice(
        [{ kind: "refused", text: "Mara → Jan E_acc refused: no such pair (it needs a NEW line first)." }, { kind: "tick", text: "ok" }],
        ["Mara likes Jan more"],
    );
    assert.match(text, /^2 relationship line/);
    assert.match(text, /needs a NEW line first/);
    assert.match(text, /could not read: "Mara likes Jan more"/);
    assert.equal(relationsNotice([{ kind: "tick", text: "ok" }], []), "");
});

// ── second live turn ──
import { renderTurnFacts } from "../src/model/prompt.js";
import { renderBlock, parseBlock } from "../src/model/block.js";

const NEW_LINE = "NEW Mara → Jan: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2 (old friends)";

test("ticks on a relationship that does not exist yet are remembered as awaiting a NEW line", () => {
    const r = run(emptyState(), "Relationships:\n- Mara → Jan: E_acc +1 (helped) | L_acc +1 (joked)\n- Tom → Jan: Ph_acc +1 (shared work)");
    assert.deepEqual(r.state.rel.awaiting, { "Mara→Jan": "", "Tom→Jan": "" });
});

test("the next turn asks for the awaited NEW lines, and the block keeps the list", () => {
    const r = run(emptyState(), "Relationships:\n- Mara → Jan: E_acc +1 (helped)");
    const facts = renderTurnFacts(r.state, { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } });
    assert.match(facts, /Mara → Jan/);
    assert.match(facts, /NEW/);
    const back = parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C });
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.state.rel.awaiting, { "Mara→Jan": "" });
});

test("a NEW line clears the pair from the awaiting list", () => {
    let r = run(emptyState(), "Relationships:\n- Mara → Jan: E_acc +1 (helped)");
    r = run(r.state, `Relationships:\n- ${NEW_LINE}`);
    assert.deepEqual(r.state.rel.awaiting, {});
    assert.ok(r.state.rel.pairs["Mara→Jan"]);
});

test("a quest progress line with the quest's kind in it applies", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "active", objective: "win the race", progress: "", reward: "", send: false }];
    let r = run(s, "Quests:\n- Q1 Main progress: the declaration is ratified");
    assert.equal(r.state.quests[0].progress, "the declaration is ratified");
    r = run(r.state, "Quests:\n- Q1: progress: race tomorrow");
    assert.equal(r.state.quests[0].progress, "race tomorrow");
    assert.ok(!r.unparsed.some(u => u.section === "Quests"));
});

test("a quest update written with its kind and title before the progress applies as progress", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "active", objective: "The Long Race", progress: "", reward: "", send: false }];
    const r = run(s, "Quests:\n- Q1 Main — The Long Race · Day 3 Morning: the entry is signed, the race is close");
    assert.equal(r.state.quests[0].progress, "Day 3 Morning: the entry is signed, the race is close");
    assert.equal(r.state.quests[0].objective, "The Long Race");
    assert.ok(!r.unparsed.some(u => u.section === "Quests"));
});

test("an update naming an unknown quest id stays unread", () => {
    const r = run(emptyState(), "Quests:\n- Q9 Main — nothing: text");
    assert.ok(r.unparsed.some(u => u.section === "Quests"));
});

test("the screenshot's status list is stored as separate conditions", () => {
    const r = run(emptyState(), "Inventory:\n- status: fed (crêpes); legs spent (-2 for Buoy Race); awaiting one warm-up lap");
    assert.deepEqual(r.state.inv.status, ["fed (crêpes)", "legs spent (-2 for Buoy Race)", "awaiting one warm-up lap"]);
    assert.equal(r.state.inv.mods, "");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C }).state.inv, r.state.inv);
});

test("status shorthand preserves existing conditions and avoids duplicates", () => {
    const s = emptyState();
    s.inv.status = ["Tired", "Injured"];
    const r = run(s, "Inventory:\n- STATUS: tired; fed; fed; rope&#59; burn\n- status - tired");
    assert.deepEqual(r.state.inv.status, ["Injured", "fed", "rope; burn"]);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(s.inv.status, ["Tired", "Injured"]);
});

test("an empty status shorthand cannot clear carried conditions", () => {
    const s = emptyState();
    s.inv.status = ["Tired"];
    const r = run(s, "Inventory:\n- status: —\n- status:");
    assert.deepEqual(r.state.inv.status, ["Tired"]);
    assert.equal(r.unparsed.length, 2);
});

test("a recap of the computed Fate tier is informational", () => {
    for (const tier of ["AMBIENT", "MINOR", "MAJOR"]) {
        const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 } }, fudges: { tier } };
        const r = postTurn(emptyState(), ch(`Fate:\n- ${tier.toLowerCase()}: quiet hold, bedroom scene, no world interruption this beat`), config);
        assert.deepEqual(r.unparsed, [], tier);
        assert.deepEqual(r.state, postTurn(emptyState(), null, config).state, tier);
    }
});

test("a Fate recap with the computed source is informational too", () => {
    const r = run(emptyState(), "Fate:\n- AMBIENT + TRUE: quiet hold");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state, run(emptyState(), "").state);
});

test("conflicting Fate recaps and unknown commands remain unread", () => {
    const lines = ["MAJOR: quiet hold", "AMBIENT + WEIGHTED: quiet hold", "AMBIENT:", "quiet hold"];
    const r = run(emptyState(), `Fate:\n${lines.map(l => `- ${l}`).join("\n")}`);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
    assert.deepEqual(r.state, run(emptyState(), "").state);
});

test("the screenshot's agenda progress lines keep their task, progress and notes", () => {
    const r = run(emptyState(), "Agendas:\n- Dean: officiate the buoy race (1/2) — count now live\n- Bryce: distance-judge from the woodpile grass (1/1) — verdict delivered; resuming stacking");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.agendas, {
        Dean: { task: "officiate the buoy race — count now live", step: 1, max: 2, aware: "", fibs: "", circle: "", body: "" },
        Bryce: { task: "distance-judge from the woodpile grass — verdict delivered; resuming stacking", step: 1, max: 1, aware: "", fibs: "", circle: "", body: "" },
    });
    assert.deepEqual(parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C }).state.agendas, r.state.agendas);
});

test("agenda progress shorthand preserves NPC fields and is not advanced twice", () => {
    const s = emptyState();
    s.agendas.Dean = { task: "officiate the buoy race", step: 0, max: 3, aware: "the race rules", fibs: "a white lie", circle: "friends", body: "holding a flag" };
    const r = run(s, "Agendas:\n- dean: officiate the buoy race (1/3)");
    assert.deepEqual(r.state.agendas, { Dean: { ...s.agendas.Dean, step: 1 } });
    assert.deepEqual(r.unparsed, []);
    assert.equal(run(r.state, "").state.agendas.Dean.step, 2);
});

test("invalid agenda progress is unread and cannot create an agenda", () => {
    const lines = ["Dean: officiate the race (3/2)", "Dean: officiate the race (0/0)", "Dean: officiate the race (-1/2)", "Dean: (1/2)"];
    const r = run(emptyState(), `Agendas:\n${lines.map(l => `- ${l}`).join("\n")}`);
    assert.deepEqual(r.state.agendas, {});
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Agendas", line })));
});

test("the screenshot's quoted agenda continuation preserves its progress and note", () => {
    const r = run(emptyState(), 'Agendas:\n- Bryce: distance-judge the race from the woodpile grass (1/1)" continues; appeal to archive filed');
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.agendas.Bryce, {
        task: "distance-judge the race from the woodpile grass — continues; appeal to archive filed",
        step: 1, max: 1, aware: "", fibs: "", circle: "", body: "",
    });
    assert.deepEqual(parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C }).state.agendas, r.state.agendas);
});

test("quoted and unquoted agenda continuations preserve NPC fields without another tick", () => {
    for (const recap of ['"judge the race (1/3)"', '"judge the race" (1/3)', 'judge the race (1/3)']) {
        const s = emptyState();
        s.agendas.Bryce = { task: "judge the race", step: 0, max: 3, aware: "rules", fibs: "a lie", circle: "judges", body: "a flag" };
        const r = run(s, `Agendas:\n- bryce: ${recap} continues; appeal filed`);
        assert.deepEqual(r.unparsed, [], recap);
        assert.deepEqual(r.state.agendas, { Bryce: { ...s.agendas.Bryce, task: "judge the race — continues; appeal filed", step: 1 } }, recap);
        assert.equal(run(r.state, "").state.agendas.Bryce.step, 2);
        assert.equal(s.agendas.Bryce.step, 0);
    }
});

test("quoted agenda recaps preserve meaningful quotes inside the task", () => {
    for (const recap of ['"judge the \"Buoy Race\" (1/2)"', '"judge the \"Buoy Race\"" (1/2)']) {
        const r = run(emptyState(), `Agendas:\n- Bryce: ${recap} — verdict pending`);
        assert.deepEqual(r.unparsed, [], recap);
        assert.equal(r.state.agendas.Bryce.task, 'judge the "Buoy Race" — verdict pending');
    }
});

test("invalid agenda continuations cannot create an agenda", () => {
    const lines = ['Bryce: "" (1/2) continues', 'Bryce: " (1/2)" continues', 'Bryce: judge (3/2)" continues; appeal filed', 'Bryce: judge (0/0) continues', 'Bryce: judge (1/2) unexpected command'];
    const r = run(emptyState(), `Agendas:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.state.agendas, {});
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Agendas", line })));
});

test("the screenshot's towel removal matches a known item without its explanation", () => {
    for (const towel of ["towel", "1 towel"]) {
        const s = emptyState();
        s.inv.items = ["key", towel];
        const r = run(s, "Inventory:\n- - 1 towel (dropped in the kitchen when Jan scooped Emilia)");
        assert.deepEqual(r.state.inv.items, ["key"], towel);
        assert.deepEqual(r.unparsed, [], towel);
        assert.deepEqual(s.inv.items, ["key", towel]);
    }
});

test("an exact inventory removal takes precedence over stripping a parenthetical name", () => {
    const s = emptyState();
    s.inv.items = ["towel", "towel (blue)", "1 towel"];
    const r = run(s, "Inventory:\n- - towel (blue)\n- - 1 towel (dropped)");
    assert.deepEqual(r.state.inv.items, ["towel", "1 towel"]);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line: "- 1 towel (dropped)" }]);
});

test("the room-shuffle removal recognizes a towel's previous holder", () => {
    for (const towel of ["1 towel (on Emilia)", "towel (on Emilia)", "1 towel (carried by Emilia)", "towel (held by Emilia)"]) {
        const s = emptyState();
        s.inv.items = ["key", towel];
        const r = run(s, "Inventory:\n- - 1 towel (left behind in the room shuffle)");
        assert.deepEqual(r.state.inv.items, ["key"], towel);
        assert.deepEqual(r.unparsed, [], towel);
        assert.deepEqual(s.inv.items, ["key", towel]);
    }
});

test("base-name matching cannot guess among towels or ignore other quantities", () => {
    for (const items of [["towel (on Emilia)", "1 towel (on Jan)"], ["2 towel (on Emilia)"], ["2 towels (on Emilia)"]]) {
        const s = emptyState();
        s.inv.items = items;
        const line = "- 1 towel (left behind in the room shuffle)";
        const r = run(s, `Inventory:\n- ${line}`);
        assert.deepEqual(r.state.inv.items, items);
        assert.deepEqual(r.unparsed, [{ section: "Inventory", line }]);
    }
});

test("literal inventory names win before matching old holder annotations", () => {
    const s = emptyState();
    s.inv.items = ["1 towel (left behind in the room shuffle)", "towel (on Emilia)", "towel"];
    const r = run(s, "Inventory:\n- - 1 towel (left behind in the room shuffle)");
    assert.deepEqual(r.state.inv.items, ["towel (on Emilia)", "towel"]);
    assert.deepEqual(r.unparsed, []);
});

test("holder matching preserves distinct names and refuses quote-equivalent duplicates", () => {
    const s = emptyState();
    s.inv.items = ['Photograph “94” (on Emilia)', 'Photograph "94" (on Jan)', 'Photograph “95” (on Emilia)'];
    const line = '- Photograph «94» (left behind)';
    const r = run(s, `Inventory:\n- ${line}`);
    assert.deepEqual(r.state.inv.items, s.inv.items);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line: '- Photograph "94" (left behind)' }]);
    const unique = run(s, 'Inventory:\n- - Photograph “95” (left behind)');
    assert.deepEqual(unique.state.inv.items, s.inv.items.slice(0, 2));
    assert.deepEqual(unique.unparsed, []);
});

test("a failed ambiguous full-name match cannot fall back to a holder match", () => {
    const s = emptyState();
    s.inv.items = ['Photograph “94” (left behind)', 'Photograph «94» (left behind)', 'Photograph "94" (on Emilia)'];
    const line = '- Photograph «94» (left behind)';
    const r = run(s, `Inventory:\n- ${line}`);
    assert.deepEqual(r.state.inv.items, [s.inv.items[0], s.inv.items[2]]);
    assert.deepEqual(r.unparsed, []);
    const ambiguous = run(s, 'Inventory:\n- - Photograph „94“ (left behind)');
    assert.deepEqual(ambiguous.state.inv.items, s.inv.items);
    assert.equal(ambiguous.unparsed.length, 1);
});

test("holder matching is confined to ledger comments", () => {
    const s = emptyState();
    s.inv.items = ["1 towel (on Emilia)"];
    const line = "- 1 towel (left behind in the room shuffle)";
    const tagged = postTurn(s, parseChanges(`<Story_Ledger>\nInventory:\n- ${line}\n</Story_Ledger>`), C);
    assert.deepEqual(tagged.state.inv.items, s.inv.items);
    assert.deepEqual(tagged.unparsed, [{ section: "Inventory", line }]);
});

test("a unique annotated item can be removed without affecting an unknown name or counted group", () => {
    const s = emptyState();
    s.inv.items = ["towel (blue)", "2 towels", "key"];
    const lines = ["- 1 towel (dropped)", "- lantern (left behind)"];
    const r = run(s, `Inventory:\n${lines.map(l => `- ${l}`).join("\n")}`);
    assert.deepEqual(r.state.inv.items, ["2 towels", "key"]);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line: lines[1] }]);
});

test("an unknown item qualifier is not mistaken for a removal explanation", () => {
    const s = emptyState();
    s.inv.items = ["towel", "1 towel"];
    const lines = ["- towel (blue)", "- 1 towel (blue)"];
    const r = run(s, `Inventory:\n${lines.map(l => `- ${l}`).join("\n")}`);
    assert.deepEqual(r.state.inv.items, s.inv.items);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Inventory", line })));
});

test("the screenshot's status removal clears each named condition", () => {
    const s = emptyState();
    s.inv.status = ["fed", "warm-up lap complete", "legs spent (-2 stands, race penalty live)"];
    const r = run(s, "Inventory:\n- status - warm-up lap complete; legs spent (-2 stands, race penalty live)");
    assert.deepEqual(r.state.inv.status, ["fed"]);
    assert.deepEqual(r.unparsed, []);
});

test("status plus lists store conditions separately, including an escaped semicolon", () => {
    const r = run(emptyState(), "Inventory:\n- status + Tired; Inspired; rope&#59; burn\n- status - tired; rope&#59; burn");
    assert.deepEqual(r.state.inv.status, ["Inspired"]);
    assert.deepEqual(r.unparsed, []);
});

test("status list removals clear known conditions and ignore absent conditions", () => {
    const s = emptyState();
    s.inv.status = ["Tired", "Injured"];
    const r = run(s, "Inventory:\n- status - tired; Unknown");
    assert.deepEqual(r.state.inv.status, ["Injured"]);
    assert.deepEqual(r.unparsed, []);
});

test("a literal carried status containing a semicolon is removed exactly first", () => {
    const s = emptyState();
    s.inv.status = ["Tired; Inspired", "Tired", "Inspired"];
    const r = run(s, "Inventory:\n- status - Tired; Inspired");
    assert.deepEqual(r.state.inv.status, ["Tired", "Inspired"]);
    assert.deepEqual(r.unparsed, []);
});

test("a matching landed Fate consequence records its aftermath without clearing unrelated owed residue", () => {
    for (const tier of ["MINOR", "MAJOR"]) {
        const s = emptyState();
        s.fate.owed = ["W1 landed: write its residue"];
        const r = postTurn(s, ch(`Fate:\n- ${tier} consequence landed: rules paper soaked, seal bled, re-draft forced`), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } }, fudges: { tier } });
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state.fate.residue, ["rules paper soaked, seal bled, re-draft forced"]);
        assert.deepEqual(r.state.fate.owed, ["W1 landed: write its residue"]);
        assert.equal(r.state.fate.lastTurn.tier, tier);
    }
});

test("a landed consequence cannot override the engine's tier or accept an empty aftermath", () => {
    const lines = ["MINOR consequence landed: a spill", "MAJOR consequence landed: a spill", "AMBIENT consequence landed: a spill", "AMBIENT consequence landed:"];
    const r = run(emptyState(), `Fate:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.state.fate.residue, []);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
    assert.equal(r.state.fate.lastTurn.tier, "AMBIENT");
});

test("the screenshot's MAJOR landed shorthand records its aftermath", () => {
    const aftermath = "Nora and Felix arrived half a day early, mid-race — the board changes: two more pairs of unknowing eyes at camp, sleeping reshuffle live";
    const s = emptyState();
    s.fate.owed = ["W1 landed: write its residue"];
    const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 } }, fudges: { tier: "MAJOR" } };
    const r = postTurn(s, ch(`Fate:\n- MAJOR landed: ${aftermath}`), config);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.residue, [aftermath]);
    assert.deepEqual(r.state.fate.owed, s.fate.owed);
    assert.equal(r.state.fate.lastTurn.tier, "MAJOR");
    assert.deepEqual(r.state.fate.world, []);
    const back = parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C });
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.state.fate, r.state.fate);
});

test("MINOR landed shorthand accepts the computed tier case-insensitively", () => {
    const r = postTurn(emptyState(), ch("Fate:\n- minor LANDED: a small spill"), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } }, fudges: { tier: "MINOR" } });
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.residue, ["a small spill"]);
    assert.equal(r.state.fate.lastTurn.tier, "MINOR");
});

test("landed shorthand cannot override Fate or accept an empty aftermath", () => {
    const lines = ["MINOR landed: a spill", "MAJOR landed: an arrival", "AMBIENT landed: a spill", "MAJOR landed:"];
    const r = run(emptyState(), `Fate:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
    assert.deepEqual(r.state.fate.residue, []);
    assert.equal(r.state.fate.lastTurn.tier, "AMBIENT");
    const major = postTurn(emptyState(), ch("Fate:\n- MAJOR landed:"), { ...C, dice: { fate: { a: 10, b: 1, c: 5 } }, fudges: { tier: "MAJOR" } });
    assert.deepEqual(major.unparsed, [{ section: "Fate", line: "MAJOR landed:" }]);
    assert.deepEqual(major.state.fate.residue, []);
});

test("the screenshot's unchanged world recap is informational and does not duplicate W2", () => {
    const s = emptyState();
    s.fate.world = [{ id: "W2", desc: "outboard failed; boathouse repairs", prox: "LOCAL", reach: 3, age: 2 }];
    const r = run(s, "Fate:\n- LOCAL: outboard still dead, boathouse work ongoing (W2 unchanged)");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state, run(s, "").state);
    assert.deepEqual(r.state.fate.world, [{ ...s.fate.world[0], age: 3 }]);
    assert.equal(s.fate.world[0].age, 2);
});

test("matching unchanged world recaps accept each proximity under Fate or World", () => {
    for (const prox of ["ELSEWHERE", "REGIONAL", "LOCAL"]) {
        for (const section of ["Fate", "World"]) {
            const s = emptyState();
            s.fate.world = [{ id: "W2", desc: "ongoing work", prox, reach: 2, age: 1 }];
            const r = run(s, `${section}:\n- ${prox.toLowerCase()}: ongoing work (w2 UNCHANGED)`);
            assert.deepEqual(r.unparsed, [], `${section} ${prox}`);
            assert.deepEqual(r.state, run(s, "").state, `${section} ${prox}`);
        }
    }
});

test("unknown, conflicting and malformed world recaps stay unread", () => {
    const s = emptyState();
    s.fate.world = [{ id: "W2", desc: "ongoing work", prox: "LOCAL", reach: 3, age: 2 }];
    const lines = ["LOCAL: work (W9 unchanged)", "REGIONAL: work (W2 unchanged)", "LOCAL: work (W2)", "LOCAL: work", "LOCAL: (W2 unchanged)", "LOCAL: work (W2 changed)"];
    for (const section of ["Fate", "World"]) {
        const r = run(s, `${section}:\n${lines.map(line => `- ${line}`).join("\n")}`);
        assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
        assert.deepEqual(r.state, run(s, "").state);
    }
});

test("an unchanged recap cannot suppress a world effect scheduled by the dice", () => {
    for (const tier of ["MINOR", "MAJOR"]) {
        const s = emptyState();
        s.fate.world = [{ id: "W2", desc: "ongoing work", prox: "LOCAL", reach: 2, age: 8 }];
        const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 } }, fudges: { tier }, sectionConfig: { ...C.sectionConfig, fate: { ...C.sectionConfig.fate, majorWorld: { reach: 2, age: 8 } } } };
        const line = "LOCAL: ongoing work (W2 unchanged)";
        const r = postTurn(s, ch(`Fate:\n- ${line}`), config);
        assert.deepEqual(r.unparsed, [{ section: "Fate", line }]);
        assert.deepEqual(r.state, postTurn(s, null, config).state);
        if (tier === "MINOR") assert.equal(r.state.fate.world[0].reach, 3);
        else {
            assert.deepEqual(r.state.fate.world, []);
            assert.match(r.state.fate.owed[0], /W2.*landed/);
        }
    }
});

test("the screenshot's landed World Sim event records aftermath without another world entry", () => {
    const s = emptyState();
    s.fate.world = [{ id: "W2", desc: "outboard repairs", prox: "LOCAL", reach: 3, age: 2 }];
    s.fate.owed = ["W1 landed: write its residue"];
    const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 } };
    const line = "World GOOD NEWS landed as Bryce's woodpile completion (LOCAL, small relief)";
    const r = postTurn(s, ch(`Fate:\n- ${line}`), config);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.residue, ["GOOD NEWS — Bryce's woodpile completion (LOCAL, small relief)"]);
    assert.deepEqual(r.state.fate.world, [{ ...s.fate.world[0], age: 3 }]);
    assert.deepEqual(r.state.fate.owed, s.fate.owed);
    assert.equal(r.state.perTurn.worldsim.name, "GOOD NEWS");
    assert.equal(r.state.fate.lastTurn.source, "TRUE");
    const back = parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C });
    assert.deepEqual(back.errors, []);
    assert.deepEqual(back.state.fate.residue, r.state.fate.residue);
});

test("landed World Sim reports match configured event names case-insensitively", () => {
    const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 }, sectionConfig: { ...C.sectionConfig, worldsim: { ...C.sectionConfig.worldsim, duo: [{ from: 1, to: 20, name: "LUCKY BREAK", text: "a small kindness" }] } } };
    const r = postTurn(emptyState(), ch("Fate:\n- world lucky break LANDED AS a repaired gate"), config);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.residue, ["LUCKY BREAK — a repaired gate"]);
});

test("a recognized landed report records aftermath without replacing the roll; empty and unknown reports fail", () => {
    const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 } };
    const lines = ["World BAD NEWS landed as a broken gate", "World GOOD NEWS landed as", "World GOOD NEWS landed as ", "World UNKNOWN landed as a gate"];
    const r = postTurn(emptyState(), ch(`Fate:\n${lines.map(line => `- ${line}`).join("\n")}`), config);
    assert.deepEqual(r.unparsed, lines.slice(1).map(line => ({ section: "Fate", line: line.trim() })));
    assert.deepEqual(r.state.fate.residue, ["BAD NEWS — a broken gate"]);
    assert.equal(r.state.perTurn.worldsim.name, "GOOD NEWS");
});

test("recognized landed reports save narrative aftermath independently of World Sim and Fate source", () => {
    const line = "World GOOD NEWS landed as a repaired gate";
    const configs = [
        { ...C, dice: { fate: { a: 10, b: 1, c: 5 } } },
        { ...C, sections: { worldsim: false }, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 } },
        { ...C, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 }, fudges: { source: "WEIGHTED" } },
    ];
    for (const config of configs) {
        const r = postTurn(emptyState(), ch(`Fate:\n- ${line}`), config);
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state.fate.residue, ["GOOD NEWS — a repaired gate"]);
        assert.deepEqual(r.state.fate.lastTurn, postTurn(emptyState(), null, config).state.fate.lastTurn);
    }
});

test("a status conversion explanation removes only the named old condition", () => {
    const s = emptyState();
    s.inv.status = ["warm-up fatigue", "Inspired"];
    const r = run(s, "Inventory:\n- status - warm-up fatigue converted to full arm/shoulder spend (race spent)");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.inv.status, ["Inspired"]);
    assert.deepEqual(s.inv.status, ["warm-up fatigue", "Inspired"]);
    const legacy = parseChanges('<Story_Ledger>\nInventory:\n- status - warm-up fatigue converted to full arm/shoulder spend (race spent)\n</Story_Ledger>');
    const tagged = postTurn(s, legacy, C);
    assert.deepEqual(tagged.state.inv.status, s.inv.status);
    assert.equal(tagged.unparsed.length, 1);
});

test("status conversion removals prefer exact names, ignore absent names and refuse ambiguous names", () => {
    const s = emptyState();
    s.inv.status = ["Tired", "Tired converted to rested", '“race fatigue”', '„race fatigue‟'];
    const r = run(s, 'Inventory:\n- status - Tired converted to rested\n- status - Unknown converted to rested\n- status - "race fatigue" converted to rested');
    assert.deepEqual(r.state.inv.status, ["Tired", '“race fatigue”', '„race fatigue‟']);
    assert.deepEqual(r.unparsed.map(x => x.line), ['status - "race fatigue" converted to rested']);
});

test("status conversion explanations cannot swallow another list member", () => {
    const s = emptyState();
    s.inv.status = ["Tired", "Inspired"];
    const r = run(s, "Inventory:\n- status - Tired converted to rested; Inspired; Unknown");
    assert.deepEqual(r.state.inv.status, []);
    assert.deepEqual(r.unparsed, []);
});

test("ambiguous full status names never fall back to a shorter conversion prefix", () => {
    const s = emptyState();
    s.inv.status = ["Tired converted to “rested”", "Tired converted to „rested‟", "Tired"];
    const line = 'status - Tired converted to "rested"';
    const r = run(s, `Inventory:\n- ${line}`);
    assert.deepEqual(r.state.inv.status, s.inv.status);
    assert.deepEqual(r.unparsed, [{ section: "Inventory", line }]);
});

test("the labelled World EVENT aftermath form accepts only recognized names and nonempty text", () => {
    const config = { ...C, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 }, sectionConfig: { ...C.sectionConfig, worldsim: { ...C.sectionConfig.worldsim, duo: [{ from: 1, to: 20, name: "CONFLICT", text: "a dispute" }] } } };
    const s = emptyState();
    s.fate.owed = ["unrelated debt"];
    const text = "Bryce's judging-authority appeal vs the pack tribunal went public on the main dock mid-race, ended by Gilles's three-word verdict";
    const line = `World EVENT landed as aftermath: CONFLICT — ${text}`;
    const r = postTurn(s, ch(`Fate:\n- ${line}`), config);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.residue, [`CONFLICT — ${text}`]);
    assert.deepEqual(r.state.fate.world, []);
    assert.deepEqual(r.state.fate.owed, s.fate.owed);
    const legacy = parseChanges(`<Story_Ledger>\nFate:\n- ${line}\n</Story_Ledger>`);
    const tagged = postTurn(s, legacy, config);
    assert.deepEqual(tagged.state.fate.residue, []);
    assert.deepEqual(tagged.unparsed, [{ section: "Fate", line }]);
    for (const bad of ["World EVENT landed as aftermath: UNKNOWN — a cousin", "World EVENT landed as aftermath: CONFLICT —", "World EVENT landed as aftermath: CONFLICT", "World EVENT landed as aftermath: CONFLICTING — a dispute"]) {
        const refused = postTurn(s, ch(`Fate:\n- ${bad}`), config);
        assert.deepEqual(refused.unparsed, [{ section: "Fate", line: bad }]);
        assert.deepEqual(refused.state.fate.residue, []);
    }
    for (const guarded of [{ ...config, sections: { worldsim: false } }, { ...config, fudges: { source: "WEIGHTED" } }]) {
        const refused = postTurn(s, ch(`Fate:\n- ${line}`), guarded);
        assert.deepEqual(refused.unparsed, []);
        assert.deepEqual(refused.state.fate.residue, [`CONFLICT — ${text}`]);
        assert.deepEqual(refused.state.fate.lastTurn, postTurn(s, null, guarded).state.fate.lastTurn);
    }
});
