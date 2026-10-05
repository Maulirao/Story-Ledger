// The state block written into replies: render ↔ parse. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { renderBlock, parseBlock, findBlock } from "../src/model/block.js";

const C = resolveConfig();
const ALL = { scene: true, relationships: true, notebook: true };
const s = () => {
    const x = emptyState();
    x.ct = 312;
    x.scene = { now: "Day 3 — Tue, 22:05 | the lawn", present: ["Mara", "Jan"], public: false };
    x.threads = ["Ask about the letter."];
    x.rel.pairs["Mara→Jan"] = {
        from: "Mara", to: "Jan",
        axes: { E: 8, M: 2, L: 6, Er: 3, Ph: 9, Ec: 3, Pr: 5, St: 3, Sg: 4, Ad: 3, Ag: 6, Pt: 3 },
        acc: { E: 0, M: 0, L: 1, Er: 0, Ph: 3, Ec: 0, Pr: 0, St: 0, Sg: 0, Ad: 0, Ag: 0, Pt: 0 },
    };
    x.rel.selves.Mara = { phi: 4, acc: -1 };
    return x;
};

test("round-trips", () => {
    const out = parseBlock(renderBlock(s(), { rules: ["Ana has the key."], config: C, sections: ALL }), { config: C });
    assert.deepEqual(out.state, { ...s(), perTurn: {} });
    assert.deepEqual(out.errors, []);
});

test("round-trips awkward values", () => {
    const x = s();
    x.scene.now = "a | b <c> & d\ne";
    x.threads = ["x | y", "A → B owes <3"];
    const out = parseBlock(renderBlock(x, { rules: [], config: C, sections: ALL }), { config: C });
    assert.equal(out.state.scene.now, "a | b <c> & d e");
    assert.deepEqual(out.state.threads, ["x | y", "A → B owes <3"]);
});

test("rules are shown but not read back", () => {
    const txt = renderBlock(s(), { rules: ["R one"], config: C, sections: ALL });
    assert.match(txt, /- \[R\] R one/);
    assert.equal("rules" in parseBlock(txt, { config: C }).state, false);
});

test("a hand edit sticks", () => {
    const txt = renderBlock(s(), { rules: [], config: C, sections: ALL }).replace("E 8·0", "E 12·0");
    assert.equal(parseBlock(txt, { config: C }).state.rel.pairs["Mara→Jan"].axes.E, 12);
});

test("a broken row keeps the previous value and reports it", () => {
    const txt = renderBlock(s(), { rules: [], config: C, sections: ALL }).replace("E 8·0", "E lots");
    const out = parseBlock(txt, { prev: s(), config: C });
    assert.equal(out.state.rel.pairs["Mara→Jan"].axes.E, 8);
    assert.equal(out.errors[0].section, "RELATIONSHIPS");
});

test("an FF block is found but is not ours", () => {
    const ff = "p\n<!-- GFX_START -->\n<internal_states>x</internal_states>\n<!-- GFX_END -->";
    assert.ok(findBlock(ff));
    assert.equal(parseBlock(ff, { config: C }), null);
});

test("disabled sections are not written", () => {
    assert.doesNotMatch(renderBlock(s(), { rules: [], config: C, sections: { ...ALL, relationships: false } }), /RELATIONSHIPS/);
});
