// The preset converter. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { applyRecipe } from "../tools/presets/convert.mjs";

const mini = () => JSON.parse(fs.readFileSync(new URL("./fixtures/preset-mini.json", import.meta.url), "utf8"));
const enabled = (p, id) => p.prompt_order.flatMap(o => o.order).filter(e => e.identifier === id).map(e => e.enabled);

test("toggles are switched off in every prompt order, by name or identifier", () => {
    const { preset, report } = applyRecipe(mini(), { off: ["👾Internal States 💾🎮", "p-bonds"], edits: [] });
    assert.deepEqual(enabled(preset, "p-states"), [false, false]);
    assert.deepEqual(enabled(preset, "p-bonds"), [false]);
    assert.deepEqual(enabled(preset, "p-style"), [true]);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(report.off.map(o => o.name), ["👾Internal States 💾🎮", " 🥰 Relationships RPG ❤️ 😡"]);
});

test("edits replace exact text once and are reported", () => {
    const { preset, report } = applyRecipe(mini(), { off: [], edits: [{ prompt: "Main Prompt", find: "Step 2. Update the internal states block.", replace: "Step 2. Read <story_ledger_turn>." }] });
    assert.equal(preset.prompts[0].content, "Be good.\nStep 2. Read <story_ledger_turn>.");
    assert.equal(report.edits.length, 1);
});

test("a recipe edit that does not match aborts the preset", () => {
    const input = mini();
    const { preset, report } = applyRecipe(input, { off: ["p-bonds"], edits: [{ prompt: "Main Prompt", find: "not there", replace: "x" }] });
    assert.deepEqual(report.missing, ['Main Prompt: "not there"']);
    assert.deepEqual(preset, mini(), "nothing is changed when anything is missing");
});

test("an unknown prompt name aborts the preset", () => {
    const { report } = applyRecipe(mini(), { off: ["No Such Prompt"], edits: [] });
    assert.deepEqual(report.missing, ["prompt: No Such Prompt"]);
});

test("added prompts go in after their anchor, in every prompt order that has it", () => {
    const recipe = { add: [{ after: "👾Internal States 💾🎮", enabled: true, prompt: { identifier: "p-new", name: "New Rule", content: "Hold the line." } }] };
    const { preset, report } = applyRecipe(mini(), recipe);
    assert.deepEqual(report.missing, []);
    assert.deepEqual(preset.prompts.map(p => p.identifier), ["main", "p-states", "p-new", "p-bonds", "p-style"]);
    assert.deepEqual(preset.prompt_order.map(o => o.order.map(e => e.identifier)), [["main", "p-states", "p-new"], ["main", "p-states", "p-new", "p-bonds", "p-style"]]);
    assert.deepEqual(enabled(preset, "p-new"), [true, true]);
    assert.deepEqual(report.added, [{ name: "New Rule", after: "👾Internal States 💾🎮", enabled: true }]);
    preset.prompts[2].content = "changed";
    assert.equal(recipe.add[0].prompt.content, "Hold the line.", "the recipe's prompt is copied, not shared");
});

test("adding a prompt the preset already has aborts the preset", () => {
    const byId = applyRecipe(mini(), { add: [{ after: "main", enabled: true, prompt: { identifier: "p-style", name: "Other", content: "" } }] });
    assert.deepEqual(byId.report.missing, ["prompt exists: Other"]);
    assert.deepEqual(byId.preset, mini());
    const byName = applyRecipe(mini(), { add: [{ after: "main", enabled: true, prompt: { identifier: "p-x", name: "Style", content: "" } }] });
    assert.deepEqual(byName.report.missing, ["prompt exists: Style"]);
});

test("an added prompt whose anchor is missing aborts the preset", () => {
    const { preset, report } = applyRecipe(mini(), { add: [{ after: "No Such Prompt", enabled: true, prompt: { identifier: "p-new", name: "New Rule", content: "" } }] });
    assert.deepEqual(report.missing, ["prompt: No Such Prompt"]);
    assert.deepEqual(preset, mini());
});

test("prompts left on that still order the old block are reported as warnings", () => {
    const p = mini();
    p.prompts.push({ identifier: "p-post", name: "Post-History Instructions", content: "Ensure the <internal_states> block closes every reply." });
    p.prompts.push({ identifier: "p-off", name: "Old Ledger", content: "Close with the <ledger>." });
    p.prompt_order[1].order.push({ identifier: "p-post", enabled: true }, { identifier: "p-off", enabled: false });
    const { report } = applyRecipe(p, { off: ["p-states"], edits: [] });
    assert.deepEqual(report.warnings, ["Post-History Instructions"]);
    assert.deepEqual(report.missing, []);
});

test("regexOff disables exactly the named scripts and reports them", () => {
    const { preset, report } = applyRecipe(mini(), { off: [], edits: [], regexOff: ["Shout Dialogue Regex"] });
    assert.deepEqual(preset.extensions.regex_scripts.map(s => s.disabled), [true, false]);
    assert.deepEqual(report.regexOff, [{ name: "Shout Dialogue Regex", was: false }]);
});

test("a regexOff name that is missing aborts the preset", () => {
    const { preset, report } = applyRecipe(mini(), { off: [], edits: [], regexOff: ["nope"] });
    assert.deepEqual(report.missing, ["regex: nope"]);
    assert.deepEqual(preset, mini());
});
