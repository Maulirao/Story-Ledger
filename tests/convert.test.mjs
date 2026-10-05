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

test("prompts left on that still order the old block are reported as warnings", () => {
    const p = mini();
    p.prompts.push({ identifier: "p-post", name: "Post-History Instructions", content: "Ensure the <internal_states> block closes every reply." });
    p.prompts.push({ identifier: "p-off", name: "Old Ledger", content: "Close with the <ledger>." });
    p.prompt_order[1].order.push({ identifier: "p-post", enabled: true }, { identifier: "p-off", enabled: false });
    const { report } = applyRecipe(p, { off: ["p-states"], edits: [] });
    assert.deepEqual(report.warnings, ["Post-History Instructions"]);
    assert.deepEqual(report.missing, []);
});
