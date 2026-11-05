// Finding a preset's own dialogue-colour prompts and regexes that are still on, so
// SillyTavern can offer to turn them off. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { colourPieces, isColourScript } from "../src/model/preset-colours.js";

test("colourPieces lists only the colour pieces that are on", () => {
    const got = colourPieces({
        prompts: [{ identifier: "a", name: "🌈 Colored Dialogue 2.0 VN🖍️" }, { identifier: "b", name: "🌈 Colored Dialogue VN🖍️" }, { identifier: "c", name: "Main Prompt" }],
        order: [{ order: [{ identifier: "a", enabled: true }, { identifier: "b", enabled: false }, { identifier: "c", enabled: true }] }],
        presetRegex: [{ scriptName: "Sola Voice: Amber ", disabled: false }, { scriptName: "Tremble Dialogue Regex", disabled: true }, { scriptName: "FF5 UI - Menu Teal" }],
        globalRegex: [{ scriptName: "FF5 - Universal Dialogue Colorizer" }],
    });
    assert.deepEqual(got, { prompts: [{ identifier: "a", name: "🌈 Colored Dialogue 2.0 VN🖍️" }], presetRegex: ["Sola Voice: Amber "], globalRegex: ["FF5 - Universal Dialogue Colorizer"] });
});

test("isColourScript knows every family's colour regexes and nothing else", () => {
    for (const n of ["Shout Dialogue Regex", "SillyTavern Universal Dialogue Colorizer", "AA Dialogue – Color", "[FF history] Whisper Dialogue Regex", " Sola Voice: Kinetic Tilt "]) assert.ok(isColourScript(n), n);
    for (const n of ["FF5 UI - Menu Teal", "Hapuppy Hide Thoughts", ""]) assert.ok(!isColourScript(n), n);
});
