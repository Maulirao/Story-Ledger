import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { postTurn, unreadNotices } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {}, dice: { fate: { a: 10, b: 1, c: 5 }, world: 3 } };
const line = "World ARRIVAL landed as Max's hatchback up the camp road with an orange kayak on the roof, a day early for Canada Day week, contesting the morning's buoy title on arrival";
const run = (s, body, config = C) => {
    const changes = parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
    const r = postTurn(s, changes, config);
    return { ...r, unparsed: unreadNotices(changes, r.unparsed, config.sections) };
};

test("the reported arrival is saved as aftermath even if another World Sim event was selected", () => {
    const s = emptyState();
    s.fate.owed = ["unrelated debt"];
    const before = postTurn(s, null, C).state;
    for (const heading of ["Fate", "World"]) {
        const r = run(s, `${heading}:\n- ${line}`);
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state.fate.residue, [line.replace("World ARRIVAL landed as ", "ARRIVAL — ")]);
        assert.deepEqual(r.state.fate.world, before.fate.world);
        assert.deepEqual(r.state.fate.owed, before.fate.owed);
        assert.deepEqual(r.state.fate.lastTurn, before.fate.lastTurn);
        assert.deepEqual(r.state.perTurn.worldsim, before.perTurn.worldsim);
    }
});

test("recognized aftermath remains bookkeeping on WEIGHTED turns or without World Sim", () => {
    for (const config of [{ ...C, fudges: { source: "WEIGHTED" } }, { ...C, sections: { worldsim: false } }, { ...C, dice: { fate: C.dice.fate } }]) {
        const expected = postTurn(emptyState(), null, config).state;
        const r = run(emptyState(), `Fate:\n- ${line}`, config);
        assert.deepEqual(r.unparsed, []);
        assert.equal(r.state.fate.residue.length, 1);
        assert.deepEqual(r.state.fate.lastTurn, expected.fate.lastTurn);
        assert.deepEqual(r.state.perTurn.worldsim, expected.perTurn.worldsim);
    }
});

test("unknown event labels and missing aftermath still report instead of inventing commands", () => {
    for (const line of ["World UNKNOWN landed as a surprise", "World ARRIVAL landed as", "World EVENT landed as aftermath"] ) {
        const r = run(emptyState(), `Fate:\n- ${line}`);
        assert.deepEqual(r.unparsed, [{ section: "Fate", line }]);
        assert.deepEqual(r.state.fate.residue, []);
    }
});

test("BACKGROUND_INCIDENT saves reported aftermath independently of the rolled event", () => {
    const aftermath = "the town barricade truck rolling past the dealer lot, cones dropped on the shoulder, holiday prep visible and unremarked";
    for (const heading of ["Fate", "World"]) {
        for (const extra of [{}, { fudges: { source: "WEIGHTED" } }, { sections: { worldsim: false } }]) {
            const config = { ...C, ...extra };
            const s = emptyState();
            s.fate.owed = ["unrelated aftermath"];
            const baseline = postTurn(s, null, config).state;
            const r = run(s, `${heading}:\n- World BACKGROUND_INCIDENT landed as ${aftermath}`, config);
            assert.deepEqual(r.unparsed, []);
            assert.deepEqual(r.state.fate.residue, [`BACKGROUND_INCIDENT — ${aftermath}`]);
            assert.deepEqual({ ...r.state, fate: { ...r.state.fate, residue: [] } }, baseline);
        }
    }
});

test("background incident reports require nonempty aftermath and keep tagged semantics", () => {
    const lines = ["World BACKGROUND_INCIDENT landed as", "World BACKGROUND_INCIDENTAL landed as a truck", "World UNKNOWN landed as a truck"];
    const r = run(emptyState(), `Fate:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
    assert.deepEqual(r.state.fate.residue, []);
    const line = "World BACKGROUND_INCIDENT landed as a truck";
    const tagged = postTurn(emptyState(), parseChanges(`<Story_Ledger>\nFate:\n- ${line}\n</Story_Ledger>`), C);
    assert.deepEqual(tagged.unparsed, [{ section: "Fate", line }]);
});

test("GOSSIP_SURGE saves the screenshot aftermath without changing the rolled event or owed residue", () => {
    const aftermath = "Gervais bragged about the face-on-shorts transfer through the shared wall; the dollar store clerk connected it to the shorts purchase while bagging, and the strip mall now carries the story into Canada Day";
    for (const heading of ["Fate", "World"]) {
        for (const extra of [{}, { fudges: { source: "WEIGHTED" } }, { sections: { worldsim: false } }]) {
            const config = { ...C, ...extra };
            const s = emptyState();
            s.fate.owed = ["unrelated aftermath"];
            const baseline = postTurn(s, null, config).state;
            const r = run(s, `${heading}:\n- World GOSSIP_SURGE landed as ${aftermath}`, config);
            assert.deepEqual(r.unparsed, []);
            assert.deepEqual(r.state.fate.residue, [`GOSSIP_SURGE — ${aftermath}`]);
            assert.deepEqual({ ...r.state, fate: { ...r.state.fate, residue: [] } }, baseline);
        }
    }
});

test("gossip surge tolerance requires an exact label and aftermath, and keeps tagged semantics", () => {
    const lines = ["World GOSSIP_SURGE landed as", "World GOSSIP_SURGES landed as a rumour"];
    const r = run(emptyState(), `Fate:\n${lines.map(line => `- ${line}`).join("\n")}`);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Fate", line })));
    assert.deepEqual(r.state.fate.residue, []);
    const line = "World GOSSIP_SURGE landed as a rumour";
    const tagged = postTurn(emptyState(), parseChanges(`<Story_Ledger>\nFate:\n- ${line}\n</Story_Ledger>`), C);
    assert.deepEqual(tagged.unparsed, [{ section: "Fate", line }]);
});
