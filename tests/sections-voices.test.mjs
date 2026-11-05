// The 🎨 VOICES section: colours the model declares, the fill-in, and what the model is told.
// Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";
import { buildTemplate, renderRules } from "../src/model/prompt.js";
import { sectionByKey } from "../src/model/sections/registry.js";
import { pickColour, AUTO_POOL } from "../src/model/voices.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);

test("voices round-trip through the block", () => {
    const s = emptyState();
    s.voices = { Jim: { colour: "#3fa7a0", source: "model" }, Kael: { colour: "orchid", source: "auto" } };
    assert.deepEqual(parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state.voices, s.voices);
});

test("the model declares a colour once", () => {
    assert.deepEqual(postTurn(emptyState(), ch("Voices:\n- Jim: #3FA7A0"), C).state.voices, { Jim: { colour: "#3fa7a0", source: "model" } });
    assert.deepEqual(postTurn(emptyState(), ch("Voices:\n- Anna = orchid."), C).state.voices, { Anna: { colour: "orchid", source: "model" } });
});

test("a set colour is never changed by the model", () => {
    const s = emptyState(); s.voices = { Jim: { colour: "#3fa7a0", source: "model" } };
    const r = postTurn(s, ch("Voices:\n- jim: red"), C);
    assert.deepEqual(r.state.voices, s.voices);
    assert.match(r.warnings.find(w => w.section === "Voices").text, /only the reader changes a set colour/);
});

test("the model can replace an auto colour", () => {
    const s = emptyState(); s.voices = { Kael: { colour: "#00ffff", source: "auto" } };
    assert.deepEqual(postTurn(s, ch("Voices:\n- Kael: #112233"), C).state.voices.Kael, { colour: "#112233", source: "model" });
});

test("mind is reserved", () => {
    const r = postTurn(emptyState(), ch("Voices:\n- Mind: #ffffff"), C);
    assert.deepEqual(r.state.voices, {});
    assert.match(r.warnings[0].text, /reserved for telepathy/);
});

test("a value that is not a colour is unparsed", () => {
    assert.deepEqual(postTurn(emptyState(), ch("Voices:\n- Jim: notacolour"), C).unparsed, [{ section: "Voices", line: "Jim: notacolour" }]);
});

test("a look-alike colour is kept with a warning", () => {
    const s = emptyState(); s.voices = { Kael: { colour: "#c0392b", source: "model" } };
    const r = postTurn(s, ch("Voices:\n- Mara: #b03a2e"), C);
    assert.equal(r.state.voices.Mara.colour, "#b03a2e");
    assert.match(r.warnings[0].text, /looks like Kael's/);
});

test("new speakers in a reply get distinct auto colours", () => {
    const text = '<Jim>"Hi." <Anna+Jim>"Yo." <teal>"old" <mind>"…" <b>"x"</b>';
    const v = postTurn(emptyState(), ch("Now: x"), C, { text, voiceOverrides: {} }).state.voices;
    assert.deepEqual(Object.keys(v), ["Jim", "Anna"]);
    assert.deepEqual(v.Jim, { colour: pickColour([]), source: "auto" });
    assert.deepEqual(v.Anna, { colour: pickColour([pickColour([])]), source: "auto" });
});

test("the fill-in skips reader-set voices and avoids their colours", () => {
    assert.deepEqual(postTurn(emptyState(), ch("Now: x"), C, { text: '<kael>"x"', voiceOverrides: { Kael: "#c0392b" } }).state.voices, {});
    const v = postTurn(emptyState(), ch("Now: x"), C, { text: '<jim>"x"', voiceOverrides: { Kael: AUTO_POOL[0] } }).state.voices;
    assert.notEqual(v.jim.colour, AUTO_POOL[0]);
});

test("a character named after a colour is not filled in", () => {
    assert.deepEqual(postTurn(emptyState(), ch("Now: x"), C, { text: '<Amber>"Hi."', voiceOverrides: {} }).state.voices, {});
});

test("a switched-off Voices section neither applies nor fills in", () => {
    const off = { ...C, sections: { voices: false } };
    const r = postTurn(emptyState(), ch("Voices:\n- Jim: red"), off, { text: '<kael>"x"', voiceOverrides: {} });
    assert.deepEqual([r.state.voices, r.unparsed], [{}, []]);
});

test("the template, rules and prompt carry Voices", () => {
    assert.match(buildTemplate(C), /\nVoices:\n- Name: colour\n/);
    assert.match(renderRules(C), /<Speaker\+mind>"…"/);
    const sec = sectionByKey("voices");
    assert.equal(sec.prompt({}), "");
    assert.equal(sec.prompt({ Jim: { colour: "#3fa7a0", source: "model" }, Anna: { colour: "orchid", source: "you" } }),
        "Voices (each speaker keeps their colour; give a new speaker one far from these): Jim #3fa7a0 · Anna orchid");
});
