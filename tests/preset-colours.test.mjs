// Finding a preset's own dialogue-colour prompts and regexes that are still on, so
// SillyTavern can offer to turn them off. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { colourPieces, isColourScript } from "../src/model/preset-colours.js";
import { harness } from "./support/st-scenarios.mjs";

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

test("turning a preset's colours off saves the preset, and a preset that has them on again is asked about again", async () => {
    const h = await harness("preset-colours");
    const tick = () => new Promise(r => setTimeout(r, 0));
    try {
        const offers = [];
        globalThis.toastr = new Proxy({}, { get: (_, kind) => (message, title, options) => { if (kind === "info") offers.push(options); } });
        const order = [{ order: [{ identifier: "c", enabled: true }] }];
        const scripts = [{ scriptName: "Shout Dialogue Regex", disabled: false }];
        const calls = [];
        Object.assign(h.context, {
            chatCompletionSettings: { prompts: [{ identifier: "c", name: "🌈 Colored Dialogue 2.0 VN🖍️" }], prompt_order: order },
            getPresetManager: () => ({
                getSelectedPresetName: () => "FF",
                readPresetExtensionField: () => scripts,
                writePresetExtensionField: async ({ value }) => { calls.push(["regex", value.map(sc => sc.disabled)]); },
                savePreset: async name => { calls.push(["save", name, order[0].order[0].enabled]); },
            }),
            reloadCurrentChat: async () => { calls.push(["reload"]); },
        });
        await h.context.eventSource.emit("chat_changed");
        await tick();
        assert.equal(offers.length, 1);
        offers[0].onclick();
        await tick();
        assert.deepEqual(calls, [["regex", [true]], ["save", "FF", false], ["reload"]]);
        order[0].order[0].enabled = true;   // the preset file still had it on
        await h.context.eventSource.emit("chat_changed");
        await tick();
        assert.equal(offers.length, 2, "asked again");
    } finally { h.restore(); }
});
