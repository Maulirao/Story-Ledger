// Framing normalisation of ledger comment lines. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLine, ledgerLines, stripTags, foldQuotes } from "../src/model/normalize.js";

const check = (input, text, bulleted) => {
    const n = normalizeLine(input);
    assert.equal(n.text, text);
    assert.equal(n.bulleted, bulleted);
};

test("tags stripped, bullet taken, straight quotes kept", () => check("- <b>Dean</b>: new \"x\" 0/2", "Dean: new \"x\" 0/2", true));
test("arrow is not a tag (bulleted)", () => check("- Mara <-> Jan: E_acc +1 (x)", "Mara <-> Jan: E_acc +1 (x)", true));
test("arrow is not a tag (bare)", () => check("<b>Mara</b> <-> Jan: E_acc +1", "Mara <-> Jan: E_acc +1", false));
test("only one marker is stripped", () => check("- - towel", "- towel", true));
test("plus after the marker stays", () => check("- + [T] x", "+ [T] x", true));
test("numbered marker", () => check("1. done Q1", "done Q1", true));
test("numbered paren marker", () => check("1) done Q1", "done Q1", true));
test("lettered marker", () => check("a) done Q1", "done Q1", true));
test("dot bullet, tabs and spaces collapse", () => check("• Dean:\tnew  \"x\"   0/2  ", "Dean: new \"x\" 0/2", true));
test("whole-line code span", () => check("`done Q1`", "done Q1", false));
test("emphasised label with colon inside", () => check("- **Dean:** knows: the code", "Dean: knows: the code", true));
test("emphasised label with colon after", () => check("**Factions**:", "Factions:", false));
test("inner emphasis stays", () => check("- Mara: holding: a **sharp** knife", "Mara: holding: a **sharp** knife", true));
test("curly quotes folded", () => check("- Bryce: new “judge the race” 0/1", "Bryce: new \"judge the race\" 0/1", true));
test("trailing period kept", () => check("- folder.", "folder.", true));
test("value punctuation untouched", () => {
    check("- residue: wait... then 3.5 km to https://x.y/z.", "residue: wait... then 3.5 km to https://x.y/z.", true);
});
test("marker needs whitespace", () => check("-towel", "-towel", false));
test("blank line", () => {
    check("   ", "", false);
    assert.deepEqual(ledgerLines("   "), []);
});

test("ledgerLines splits on newlines and br", () => {
    const l = ledgerLines("a\r\nb<br/>c");
    assert.deepEqual(l.map(x => x.raw), ["a", "b", "c"]);
});

test("raw loses only its trailing CR", () => {
    assert.equal(normalizeLine("- x \r").raw, "- x ");
});

test("unfolded shares the framing of text but keeps quote style", () => {
    const n = normalizeLine("- **`x`**: gone “the key”");
    const m = normalizeLine("`- **Dean:** removed “the key”`");
    assert.equal(n.text, "`x`: gone \"the key\"");
    assert.equal(n.unfolded, "`x`: gone “the key”");
    assert.equal(m.text, "Dean: removed \"the key\"");
    assert.equal(m.unfolded, "Dean: removed “the key”");
    assert.equal(foldQuotes(m.unfolded), m.text);
    assert.equal(m.bulleted, true);
});

test("stripTags and foldQuotes", () => {
    assert.equal(stripTags("a <i>b</i> <-> c < d > e"), "a b <-> c < d > e");
    assert.equal(foldQuotes("“a” ‘b’ «c» ′"), "\"a\" 'b' \"c\" '");
});

test("a code span wrapped inside a list marker is unwrapped once", () => {
    check("- `done Q1`", "done Q1", true);
    check("`done Q1`", "done Q1", false);
    check("`- done Q1`", "done Q1", true);
    check("- ``x``", "``x``", true);   // nested backticks are not unwrapped twice
});

test("odd spaces become spaces; a zero-width space is left in the word", () => {
    check("Mara\u00A0\u00A0says", "Mara says", false);
    check("Mara\u3000says", "Mara says", false);
    check("Ma\u200Bra", "Ma\u200Bra", false);   // framing only: a word's internals are not rewritten
});
