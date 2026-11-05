// Dialogue voices: reading voice tags, the colour table, colour maths. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readVoiceTags, voiceKey, findVoice, colourHex, PALETTE, colourDistance, NEAR, AUTO_POOL, pickColour, nearDuplicates } from "../src/model/voices.js";

test("readVoiceTags reads every tag form", () => {
    const one = t => readVoiceTags(t).map(({ voices, tone, quote }) => ({ voices, tone, quote }));
    assert.deepEqual(one('<jim>"Hi."</jim>'), [{ voices: ["jim"], tone: null, quote: '"Hi."' }]);
    assert.deepEqual(one("<Jim+Anna:whisper>“Over here.”"), [{ voices: ["Jim", "Anna"], tone: "whisper", quote: "“Over here.”" }]);
    assert.deepEqual(one('<jim+mind>"Can you hear me?"')[0].voices, ["jim", "mind"]);
    assert.deepEqual(one('<gold:measured>"Wrong tree."</gold:measured>')[0], { voices: ["gold"], tone: "measured", quote: '"Wrong tree."' });
    assert.deepEqual(one('<color:teal>"x"')[0].voices, ["teal"]);
    assert.equal(one('<copper:whisper:tilt>"x"')[0].tone, "whisper");
    assert.equal(one('<amber:bite>"x"')[0].tone, "shout");
    assert.equal(one('<jim:sneer>"x"')[0].tone, null);
    assert.deepEqual(one('<Old Tom>"x"')[0].voices, ["Old Tom"]);
    assert.equal(readVoiceTags('ab <jim>"x"')[0].at, 3);
});

test("a tag not right before a quote is not a voice tag", () => {
    assert.deepEqual(readVoiceTags('<jim> waves. "Hi."'), []);
});

test("formatting HTML before a quote is never a voice", () => {
    assert.deepEqual(readVoiceTags('<b>"Hi"</b> <i>"Yo"</i> <span class="x">"z"</span> <em>"e"</em>'), []);
});

test("closing tags are optional and lenient", () => {
    assert.deepEqual(readVoiceTags('<jim>"A" <anna>"B"</anna:whisper> <kael>"C"</>').map(t => t.quote), ['"A"', '"B"', '"C"']);
});

test("voiceKey folds case, spaces, _ and -", () => {
    for (const n of ["Old_Tom", "old tom", " OLD-TOM ", "old  tom"]) assert.equal(voiceKey(n), "old tom");
});

test("findVoice matches exactly, then by a unique first word", () => {
    assert.equal(findVoice({ "Jim Hawkins": 1, Anna: 1 }, "jim"), "Jim Hawkins");
    assert.equal(findVoice({ "Jim Hawkins": 1, Anna: 1 }, "ANNA"), "Anna");
    assert.equal(findVoice({ "Jim Hawkins": 1, "Jim Beam": 1 }, "jim"), null);
    assert.equal(findVoice({ "Old Tom": 1 }, "old_tom"), "Old Tom");
    assert.equal(findVoice({}, "jim"), null);
});

test("colourHex reads hex, CSS names and Sola names", () => {
    assert.equal(colourHex("#3FA7A0"), "#3fa7a0");
    assert.equal(colourHex("#abc"), "#aabbcc");
    assert.equal(colourHex("Orchid"), "#da70d6");
    assert.equal(colourHex("teal"), "#008080");
    assert.equal(colourHex("coral"), "#ee6c4d", "Sola's coral wins over CSS's");
    assert.equal(colourHex("notacolour"), null);
    assert.equal(colourHex("mind"), null);
    assert.equal(Object.keys(PALETTE).length, 148 + 14, "CSS names plus the 14 Sola names CSS lacks");
});

test("colourDistance is zero for one colour and large for black and white", () => {
    assert.equal(colourDistance("#3fa7a0", "#3fa7a0"), 0);
    assert.ok(colourDistance("#000000", "#ffffff") > 99);
    assert.ok(colourDistance("#008080", "#008181") < NEAR);
});

test("pickColour starts at the pool and steers away from taken colours", () => {
    assert.equal(pickColour([]), AUTO_POOL[0]);
    const second = pickColour([AUTO_POOL[0]]);
    assert.ok(colourDistance(second, AUTO_POOL[0]) >= NEAR);
    assert.equal(pickColour(["#3fa7a0", "#ff0000"]), pickColour(["#3fa7a0", "#ff0000"]));
});

test("the first six picks are pairwise distinct", () => {
    const taken = [];
    for (let i = 0; i < 6; i++) taken.push(pickColour(taken));
    for (const a of taken) for (const b of taken) if (a !== b) assert.ok(colourDistance(a, b) >= NEAR, `${a} ~ ${b}`);
});

test("nearDuplicates names look-alike pairs", () => {
    assert.deepEqual(nearDuplicates([["Kael", "#c0392b"], ["Mara", "#b03a2e"], ["Jim", "#3fa7a0"]]), [["Kael", "Mara"]]);
});
