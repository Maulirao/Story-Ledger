import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn } from "../src/model/turn.js";
import { buildTemplate, renderRules, renderStatePrompt } from "../src/model/prompt.js";
import { emptyNotebook } from "../src/model/notebook.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const apply = (state, body, dice = { a: 1, b: 1, c: 12 }) =>
    postTurn(state, parseChanges("<!-- Story_Ledger\n" + body + "\n-->"), { ...C, dice: { fate: dice } });
const withWorld = (overrides = {}) => {
    const s = emptyState();
    s.fate.world = [{
        id: "W2",
        desc: "outboard pump failed; tubing plans cancelled; canoe only",
        prox: "LOCAL", reach: 3, age: 0,
        ...overrides,
    }];
    return s;
};

test("update W# under Fate appends without replacing the original or changing scope", () => {
    const s = withWorld();
    const r = apply(s, "Fate:\n- update W2: Gatineau dealer sourced a part; Thursday now earliest");
    assert.deepEqual(r.unparsed, []);
    const w = r.state.fate.world[0];
    assert.equal(w.desc, s.fate.world[0].desc);
    assert.deepEqual(w.updates, ["Gatineau dealer sourced a part; Thursday now earliest"]);
    assert.deepEqual([w.prox, w.reach, w.age], ["LOCAL", 3, 1]);
    assert.equal(s.fate.world[0].updates, undefined);
});

test("update W# under World appends only distinct notes", () => {
    const r = apply(withWorld(), "World:\n- update W2: Friday delivery possible\n- update w2: Friday delivery possible");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world[0].updates, ["Friday delivery possible"]);
});

test("annotated escalation under Fate increases scope and records a development", () => {
    const r = apply(withWorld({ prox: "REGIONAL", reach: 2 }),
        "Fate:\n- escalate W2: other camps now affected by the shortage");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual([r.state.fate.world[0].prox, r.state.fate.world[0].reach], ["LOCAL", 3]);
    assert.deepEqual(r.state.fate.world[0].updates, ["other camps now affected by the shortage"]);
});

test("escalation at maximum scope still records the annotation; bare commands still work", () => {
    let r = apply(withWorld(), "World:\n- escalate W2: weekend repair now possible");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual([r.state.fate.world[0].prox, r.state.fate.world[0].reach], ["LOCAL", 3]);
    assert.deepEqual(r.state.fate.world[0].updates, ["weekend repair now possible"]);
    r = apply(r.state, "Fate:\n- escalate W2");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world[0].updates, ["weekend repair now possible"]);
});

test("multiple updates persist in chronological order through block, prompt, and a later turn", () => {
    let r = apply(withWorld(), "Fate:\n- update W2: dealer sourced part & hose | brackets [missing]");
    r = apply(r.state, "World:\n- update W2: Thursday is earliest; might be weekend");
    const original = r.state.fate.world[0].desc;
    assert.deepEqual(r.state.fate.world[0].updates, [
        "dealer sourced part & hose | brackets [missing]",
        "Thursday is earliest; might be weekend",
    ]);
    const block = renderBlock(r.state, { rules: [], config: C, sections: {} });
    assert.match(block, /<b>W2 update:<\/b> dealer sourced part &amp; hose &#124; brackets \[missing\]/);
    const parsed = parseBlock(block, { config: C });
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.state.fate, r.state.fate);
    assert.equal(parsed.state.fate.world[0].desc, original);
    const injected = renderStatePrompt(parsed.state, { notebook: emptyNotebook(), config: C, sections: {} });
    assert.match(injected, /W2 update: Thursday is earliest; might be weekend/);
    r = apply(parsed.state, "Fate:\n- update W2: mechanic booked for Friday");
    assert.deepEqual(r.state.fate.world[0].updates, [
        "dealer sourced part & hose | brackets [missing]",
        "Thursday is earliest; might be weekend",
        "mechanic booked for Friday",
    ]);
});

test("new World entries may be updated in the same turn", () => {
    const r = apply(emptyState(), "World:\n- + ELSEWHERE: a new fuel tax announced\n- update W1: retailers asked for an exception");
    assert.deepEqual(r.unparsed, []);
    assert.equal(r.state.fate.world[0].desc, "a new fuel tax announced");
    assert.deepEqual(r.state.fate.world[0].updates, ["retailers asked for an exception"]);
});

test("malformed and missing-ID updates remain unread without modifying scope or history", () => {
    const lines = ["update W99: wrong event", "escalate W99: wrong event", "update W2:", "escalate W2:"];
    const baseline = apply(withWorld(), "");
    const r = apply(withWorld(), "Fate:\n" + lines.map(line => "- " + line).join("\n"));
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
    assert.deepEqual(r.state.fate.world, baseline.state.fate.world);
});

test("orphan update rows in a manually edited block are reported, not attached to another event", () => {
    const block = renderBlock(withWorld(), { rules: [], config: C, sections: {} });
    const edited = block.replace("- <b>W2</b>", "- <b>W99 update:</b> orphan fact\n- <b>W2</b>");
    const parsed = parseBlock(edited, { config: C });
    assert.ok(parsed.errors.some(error => /W99 update/.test(error.row)));
    assert.equal(parsed.state.fate.world[0].updates, undefined);
});

test("landing carries all updates into the owed aftermath", () => {
    const s = withWorld({ age: 8, updates: ["Gatineau dealer found a part", "Thursday earliest, maybe weekend"] });
    s.fate.q = 7;
    const r = apply(s, "", { a: 17, b: 1, c: 12 });
    assert.deepEqual(r.unparsed, []);
    assert.equal(r.state.fate.world.length, 0);
    assert.match(r.state.fate.owed.join(" "), /Gatineau dealer found a part; Thursday earliest, maybe weekend/);
});

test("generated Fate instructions and both command templates teach append-only updates", () => {
    const template = buildTemplate({ sections: {} });
    const fateTemplate = template.split("Fate:\n")[1].split("\nWorld:")[0];
    assert.doesNotMatch(fateTemplate, /update W#|escalate W#/);
    assert.match(template, /World:[\s\S]*update W#: new development[\s\S]*escalate W#: new development/);
    assert.equal(template.match(/- update W#: new development/g)?.length, 1);
    assert.equal(template.match(/- escalate W#: new development/g)?.length, 1);
    const rules = renderRules({ ...C, sections: {} });
    assert.match(rules, /APPEND a chronological update/);
    assert.match(rules, /never replace the original description/);
    assert.match(rules, /repair status alone is not a reason to escalate/);
});

test("World updates keep source order across repeated Fate and World headings", () => {
    for (const first of ["Fate", "World"]) {
        const second = first === "Fate" ? "World" : "Fate";
        const r = apply(withWorld({ prox: "ELSEWHERE", reach: 1 }),
            `${first}:\n- update W2: first development\n${second}:\n- escalate W2: second development\n${first}:\n- update W2: third development`);
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state.fate.world[0].updates, ["first development", "second development", "third development"]);
        assert.deepEqual([r.state.fate.world[0].prox, r.state.fate.world[0].reach, r.state.fate.world[0].age], ["REGIONAL", 2, 1]);
    }
});

test("an update before World landing is included in the owed history", () => {
    const r = apply(withWorld(), "Fate:\n- update W2: dealer found a part\nWorld:\n- land W2: motor repaired");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world, []);
    assert.deepEqual(r.state.fate.owed, ['W2 “outboard pump failed; tubing plans cancelled; canoe only; dealer found a part” landed: motor repaired']);
});

test("an update cannot target an event created later in the comment", () => {
    const r = apply(emptyState(), "Fate:\n- update W1: later development\nWorld:\n- + LOCAL: new happening");
    assert.deepEqual(r.unparsed, [{ section: "Fate", line: "update W1: later development" }]);
    assert.equal(r.state.fate.world[0].desc, "new happening");
    assert.equal(r.state.fate.world[0].updates, undefined);
});

test("a new World event can be updated after switching to Fate", () => {
    const r = apply(emptyState(), "World:\n- + LOCAL: new happening\nFate:\n- update W1: first development\nWorld:\n- update W1: second development");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world[0].updates, ["first development", "second development"]);
});

test("indented World annotation continuations preserve the complete new development", () => {
    for (const heading of ["Fate", "World", "Fate & Routine"]) {
        for (const command of ["update", "escalate"]) {
            const r = apply(withWorld(), `${heading}:\n- ${command} W2: Replacement part sourced from\n  Gatineau dealer; Thursday now earliest,\n  possibly weekend.`);
            assert.deepEqual(r.unparsed, []);
            assert.deepEqual(r.state.fate.world[0].updates, ["Replacement part sourced from Gatineau dealer; Thursday now earliest, possibly weekend."]);
            const parsed = parseBlock(renderBlock(r.state, { rules: [], config: C, sections: {} }), { config: C });
            assert.deepEqual(parsed.errors, []);
            assert.deepEqual(parsed.state.fate.world, r.state.fate.world);
        }
    }
});

test("wrapped annotations keep following commands, headings and core fields separate", () => {
    const r = apply(withWorld(), "Fate:\n- update W2: first development\n  with extra detail\n  escalate W2: second development\n  residue: unrelated aftermath\n  World:\n  update W2: third development\n  Now: Day 4\nThoughts:\n- Mara: wait for the part.");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world[0].updates, ["first development with extra detail", "second development", "third development"]);
    assert.deepEqual(r.state.fate.residue, ["unrelated aftermath"]);
    assert.equal(r.state.scene.now, "Day 4");
});

test("unknown labels and malformed annotations are not swallowed as continuation text", () => {
    const r = apply(withWorld(), "Fate:\n- update W2: first development\n  typo: unknown command\n- update W2:\n  orphan continuation\n- update W2: next development");
    assert.deepEqual(r.unparsed.map(item => item.line).sort(), ["orphan continuation", "typo: unknown command", "update W2:"]);
    assert.deepEqual(r.state.fate.world[0].updates, ["first development", "next development"]);
});

test("a wrapped World-prefixed update under Fate keeps its annotation", () => {
    const r = apply(withWorld(), "Fate:\n- World: update W2: part sourced\n  from Gatineau dealer");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world[0].updates, ["part sourced from Gatineau dealer"]);
});

test("a bare deferred command cannot become part of a wrapped World update", () => {
    const s = withWorld();
    s.fate.deferred = [{ id: "D1", desc: "dock audit", times: 1, age: 0 }];
    const r = apply(s, "Fate:\n- update W2: dealer found the part\n  defer D1");
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.fate.world[0].updates, ["dealer found the part"]);
    assert.equal(r.state.fate.deferred[0].times, 2);
});
