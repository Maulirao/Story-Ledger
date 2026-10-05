// Pure layout decisions behind the Sola and Megumin themes. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { hudChips, sectionGroups } from "../src/ui/themes/layout.js";

test("hudChips omits empty values and keeps order", () => {
    assert.deepEqual(hudChips({ now: "Day 3 — 22:05 | the lawn", present: "Mara, Jan", tier: "MINOR", source: "TRUE" }), [
        { label: "Now", value: "Day 3 — 22:05 | the lawn", kind: "now" },
        { label: "Present", value: "Mara, Jan", kind: "present" },
        { label: "Fate", value: "MINOR + TRUE", kind: "minor" },
    ]);
    assert.deepEqual(hudChips({ now: "", present: "Mara", tier: "", source: "" }), [{ label: "Present", value: "Mara", kind: "present" }]);
});

test("sectionGroups puts every FF title in exactly one tab, in tab order", () => {
    const titles = ["🕰️ SCENE", "👥 SCENE CAST", "💞 RELATIONSHIPS", "📓 NOTEBOOK", "👤 NPC AGENDAS", "👤 NPC LOCATIONS", "🏳️ FACTIONS",
        "📜 QUESTS", "🎒 INV & SKILLS", "🔫 CHEKHOV'S GUN", "🎲 FATE & ROUTINE", "🧾 LAST", "🧠 INTERNAL THOUGHTS", "🌎 WORLD SIM",
        "🎲 DND TASK SIM", "🌌 PHYSICS, ENGINE & WORLD", "🦄 SOMETHING NEW"];
    const groups = sectionGroups(titles);
    assert.deepEqual(groups.map(g => g.tab), ["Scene", "People", "Relationships", "Story", "Fate", "Notes"]);
    const by = Object.fromEntries(groups.map(g => [g.tab, g.titles]));
    assert.deepEqual(by.Scene, ["🕰️ SCENE", "👥 SCENE CAST"]);
    assert.deepEqual(by.People, ["👤 NPC AGENDAS", "👤 NPC LOCATIONS", "🏳️ FACTIONS"]);
    assert.deepEqual(by.Relationships, ["💞 RELATIONSHIPS"]);
    assert.deepEqual(by.Story, ["📜 QUESTS", "🔫 CHEKHOV'S GUN", "🧾 LAST", "🧠 INTERNAL THOUGHTS"]);
    assert.deepEqual(by.Fate, ["🎲 FATE & ROUTINE", "🌎 WORLD SIM", "🎲 DND TASK SIM", "🌌 PHYSICS, ENGINE & WORLD"]);
    assert.deepEqual(by.Notes, ["📓 NOTEBOOK", "🎒 INV & SKILLS", "🦄 SOMETHING NEW"]);
    assert.equal(groups.flatMap(g => g.titles).length, titles.length);
    assert.deepEqual(sectionGroups(["🕰️ SCENE"]).map(g => g.tab), ["Scene"], "empty tabs are left out");
});
