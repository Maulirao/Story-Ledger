import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn } from "../src/model/turn.js";
import { renderBlock, parseBlock } from "../src/model/block.js";

const config = { ...resolveConfig(), userName: "Jan", dice: { fate: { a: 10, b: 1, c: 12 }, world: 13 } };
const aftermath = "the buoy anchor chafed through mid-race, buoy now adrift; race lengthened, Emilia still won";
const run = (s, body, cfg = config) => postTurn(s, parseChanges(`<!-- Story_Ledger\n${body}\n-->`), cfg);

test("the screenshot's generic consequence and W2 annotation are both recorded", () => {
    for (const source of ["TRUE", "WEIGHTED"]) {
        const s = emptyState();
        s.fate.world = [{ id: "W2", desc: "outboard pump failure; canoe only", prox: "LOCAL", reach: 3, age: 1 }];
        s.fate.owed = ["W1 landed: unrelated aftermath owed"];
        const cfg = { ...config, fudges: { source } };
        const baseline = postTurn(s, null, cfg);
        const r = run(s, `Fate:\n- World CONSEQUENCE landed as ${aftermath}\n- escalate W2: part sourced from Gatineau dealer; Thursday earliest, possibly weekend; canoe remains sole watercraft`, cfg);
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state.fate.residue, [`CONSEQUENCE — ${aftermath}`]);
        assert.deepEqual(r.state.fate.owed, s.fate.owed);
        assert.deepEqual(r.state.perTurn.worldsim, baseline.state.perTurn.worldsim);
        assert.deepEqual(r.state.fate.lastTurn, baseline.state.fate.lastTurn);
        assert.deepEqual(r.state.fate.world, [{ ...s.fate.world[0], age: 2, updates: ["part sourced from Gatineau dealer; Thursday earliest, possibly weekend; canoe remains sole watercraft"] }]);
        const back = parseBlock(renderBlock(r.state, { config: cfg, rules: [], sections: {} }), { config: cfg });
        assert.deepEqual(back.errors, []);
        assert.deepEqual(back.state.fate.residue, r.state.fate.residue);
    }
});

test("a generic consequence does not require a rolled World Sim event or change Fate's tier", () => {
    for (const tier of ["AMBIENT", "MINOR", "MAJOR"]) {
        for (const extra of [{ dice: { fate: config.dice.fate } }, { sections: { worldsim: false } }]) {
            const cfg = { ...config, ...extra, fudges: { tier, source: "WEIGHTED" } };
            const s = emptyState();
            const r = run(s, "Fate:\n- World CONSEQUENCE landed as the buoy broke", cfg);
            assert.deepEqual(r.unparsed, []);
            assert.deepEqual(r.state.fate.residue, ["CONSEQUENCE — the buoy broke"]);
            assert.deepEqual(r.state.fate.world, []);
            assert.deepEqual(r.state.fate.lastTurn, postTurn(s, null, cfg).state.fate.lastTurn);
        }
    }
});

test("the consequence label works under Fate and World with normalized and tagged input", () => {
    for (const heading of ["Fate", "World"]) {
        const body = `${heading}:\n- world consequence LANDED AS the buoy broke`;
        for (const text of [`<!-- Story_Ledger\n${body}\n-->`, `<Story_Ledger>\n${body}\n</Story_Ledger>`]) {
            const r = postTurn(emptyState(), parseChanges(text), config);
            assert.deepEqual(r.unparsed, []);
            assert.deepEqual(r.state.fate.residue, ["CONSEQUENCE — the buoy broke"]);
            assert.equal(r.state.perTurn.worldsim.name, "COMPLICATION");
        }
    }
});

test("empty consequence reports and unrelated invented event labels remain unread", () => {
    const lines = ["World CONSEQUENCE landed as", "World CONSEQUENCE landed as ", "World CONSEQUENCE landed:", "World UNKNOWN landed as a broken buoy"];
    const r = run(emptyState(), `Fate:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line: line.trim() })));
    assert.deepEqual(r.state, postTurn(emptyState(), null, config).state);
});
