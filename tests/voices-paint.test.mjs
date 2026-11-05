// Dialogue voices on screen: which quotes get which colours, and finding them in the
// rendered message. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { planPaint, matchQuotes, pickColour, MIND_FILL } from "../src/model/voices.js";
import { spanAttrs } from "../src/ui/voices-paint.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };

const L = { Jim: { hex: "#3fa7a0" } };
test("planPaint resolves names, palette names, mind and unknowns", () => {
    assert.deepEqual(planPaint('<jim>"a" <jim+anna:shout>"b" <teal>"c" <jim+mind>"d" <mind>"e"', L), [
        { quote: '"a"', top: "#3fa7a0", bottom: null, tone: null, mind: false },
        { quote: '"b"', top: "#3fa7a0", bottom: pickColour(["#3fa7a0"]), tone: "shout", mind: false },
        { quote: '"c"', top: "#008080", bottom: null, tone: null, mind: false },
        { quote: '"d"', top: "#3fa7a0", bottom: MIND_FILL, tone: null, mind: true },
        { quote: '"e"', top: MIND_FILL, bottom: null, tone: null, mind: true },
    ]);
});
test("an unknown voice is painted with the colour the fill-in will record", () => {
    const top = planPaint('<kael>"x"', {})[0].top;
    const recorded = postTurn(emptyState(), parseChanges("<!-- Story_Ledger\nNow: x\n-->"), C, { text: '<kael>"x"', voiceOverrides: {} }).state.voices.kael.colour;
    assert.equal(top, recorded);
});
test("a colour-named character uses their own colour once they have one", () => {
    assert.equal(planPaint('<amber>"x"', {})[0].top, "#f3b74b");
    assert.equal(planPaint('<amber>"x"', { Amber: { hex: "#123456" } })[0].top, "#123456");
});
test("three voices use the first two", () => {
    assert.equal(planPaint('<jim+mind+anna>"x"', L)[0].bottom, MIND_FILL);
});
test("matchQuotes skips untagged quotes and ignores markdown", () => {
    assert.deepEqual(matchQuotes(['"I *told* you."'], ['"Hello."', "“I told you.”"]), [1]);
});
test("matchQuotes never matches backwards", () => {
    assert.deepEqual(matchQuotes(['"A"', '"B"'], ['"B"', '"A"']), [1, -1]);
});

test("spanAttrs builds the classes and colour variables", () => {
    assert.deepEqual(spanAttrs({ top: "#3fa7a0", bottom: null, tone: null, mind: false }), { className: "sl-voice", style: "--sl-top:#3fa7a0;--sl-bottom:#3fa7a0" });
    assert.deepEqual(spanAttrs({ top: "#3fa7a0", bottom: "#111111", tone: "whisper", mind: true }), { className: "sl-voice sl-voice-two sl-voice-mind sl-tone-whisper", style: "--sl-top:#3fa7a0;--sl-bottom:#111111" });
});
