// Dialogue voices on screen: which quotes get which colours, and finding them in the
// rendered message. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { planPaint, matchQuotes, pickColour, MIND_FILL, quotesIn, readVoiceTags } from "../src/model/voices.js";
import { spanAttrs, paintVoices, ensureMindFilter, MIND_FILTER_ID } from "../src/ui/voices-paint.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };

const L = { Jim: { hex: "#3fa7a0" } };
test("planPaint resolves names, palette names, mind and unknowns", () => {
    assert.deepEqual(planPaint('<jim>"a" <jim+anna:shout>"b" <teal>"c" <jim+mind>"d" <mind>"e"', L), [
        { quote: '"a"', index: 0, top: "#3fa7a0", bottom: null, tone: null, mind: false },
        { quote: '"b"', index: 1, top: "#3fa7a0", bottom: pickColour(["#3fa7a0"]), tone: "shout", mind: false },
        { quote: '"c"', index: 2, top: "#008080", bottom: null, tone: null, mind: false },
        { quote: '"d"', index: 3, top: "#3fa7a0", bottom: MIND_FILL, tone: null, mind: true },
        { quote: '"e"', index: 4, top: MIND_FILL, bottom: null, tone: null, mind: true },
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

test("a tagged quote is placed among all the quotes, so an earlier twin stays plain", () => {
    const text = '"No," she said. <jim>"No."';
    assert.deepEqual(quotesIn(text), ['"No,"', '"No."']);
    const [span] = planPaint(text, L);
    assert.equal(span.index, 1);
    assert.equal(matchQuotes(quotesIn(text), ['"No,"', '"No."'])[span.index], 1);
});

test("quotes pair straight with straight and curly with curly, as SillyTavern pairs them", () => {
    assert.equal(readVoiceTags('<jim>"She said “no” to me."')[0].quote, '"She said “no” to me."');
    assert.deepEqual(quotesIn('<span class="x">"a"</span> “b” «c» <!-- Story_Ledger "hidden" -->'), ['"a"', "“b”", "«c»"]);
});


// a tiny stand-in for the page: elements keep their children and attributes
function fakeDoc() {
    const made = [], ids = new Set();
    const createElement = tag => {
        const e = { tag, children: [], attrs: {}, className: "", parentNode: null, firstChild: null,
            setAttribute(k, v) { this.attrs[k] = v; },
            appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
            set innerHTML(h) { this.html = h; this.firstChild = { svg: h }; } };
        made.push(e);
        return e;
    };
    return { made, createElement, createTreeWalker: () => ({ nextNode: () => false }),
        getElementById: id => (ids.has(id) ? {} : null),
        body: { appended: [], appendChild(n) { this.appended.push(n); ids.add(MIND_FILTER_ID); } } };
}
function rendered(doc, text) {
    const q = { textContent: text, firstChild: null, previousSibling: null, closest: () => null, children: [],
        appendChild(c) { q.children.push(c); c.parentNode = q; return c; } };
    return { q, el: { querySelectorAll: sel => (sel === "q" ? [q] : []), ownerDocument: doc } };
}

test("a mind quote is painted inside the starry band; a plain one is not", () => {
    const doc = fakeDoc();
    const a = rendered(doc, '"Listen."');
    paintVoices(a.el, '<jim+mind>"Listen."', L);
    const band = a.q.children[0];
    assert.equal(band.className, "sl-voice-band");
    assert.ok("data-sl-voice" in band.attrs, "the band is undone with the paint");
    assert.match(band.children[0].className, /sl-voice-mind/);
    const b = rendered(doc, '"Hi."');
    paintVoices(b.el, '<jim>"Hi."', L);
    assert.equal(b.q.children[0].className, "sl-voice");
});

test("ensureMindFilter adds the eclipse filter once, and does nothing without a real page", () => {
    const doc = fakeDoc();
    ensureMindFilter(doc);
    ensureMindFilter(doc);
    assert.equal(doc.body.appended.length, 1);
    assert.match(doc.made.find(e => e.html).html, new RegExp(`<filter id="${MIND_FILTER_ID}"`));
    assert.doesNotThrow(() => ensureMindFilter({ querySelectorAll: () => [] }));
    assert.doesNotThrow(() => ensureMindFilter(undefined));
});

test("painting a mind quote makes sure the filter is on the page", () => {
    const doc = fakeDoc();
    const a = rendered(doc, '"Listen."');
    paintVoices(a.el, '<mind>"Listen."', {});
    assert.equal(doc.body.appended.length, 1);
});
