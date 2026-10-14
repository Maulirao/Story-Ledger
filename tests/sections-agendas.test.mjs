// 👤 NPC AGENDAS — off-screen lives. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, preTurnFacts } from "../src/model/turn.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const agenda = (task, step, max, more = {}) => ({ task, step, max, aware: "", fibs: "", circle: "", body: "", ...more });

test("agendas round-trip, empty fields included", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("close the café | early", 1, 2, { aware: "Mara took the key" }) };
    const back = parseBlock(renderBlock(s, { rules: [], config: C, sections: {} }), { config: C }).state;
    assert.deepEqual(back.agendas, s.agendas);
});

test("new / knows / body / @ lines apply", () => {
    const { state } = postTurn(emptyState(), ch('Present: Mara\nAgendas:\n- Ana: new "restock the pantry" 0/2 @ café\n- Mara knows: Ana took the key\n- Mara body: sprained wrist'), C);
    assert.deepEqual(state.agendas.Ana, agenda("restock the pantry", 0, 2));
    assert.equal(state.locations.Ana, "café");
    assert.equal(state.agendas.Mara.aware, "Ana took the key");
    assert.equal(state.agendas.Mara.body, "sprained wrist");
});

test("colon-prefixed NPC field updates change the existing person", () => {
    const s = emptyState();
    s.agendas.Sofia = agenda("prepare lunch", 0, 2, { body: "at the sink" });
    const r = postTurn(s, ch('Present: Sofia\nAgendas:\n- Sofia: body: dock end, towels delivered\n- Sofia: knows: the race ended\n- Sofia: circle: Hélène\n- Sofia: fib: nothing happened'), C);
    assert.deepEqual(Object.keys(r.state.agendas), ["Sofia"]);
    assert.deepEqual(r.state.agendas.Sofia, agenda("prepare lunch", 0, 2, {
        body: "dock end, towels delivered", aware: "the race ended", circle: "Hélène", fibs: "nothing happened",
    }));
    assert.deepEqual(r.unparsed, []);
});

test("inline body updates are not swallowed into NPC knowledge", () => {
    const s = emptyState();
    s.agendas.Emilia = agenda("deliver the part", 0, 3, { aware: "bet rigged", body: "old clothes" });
    const r = postTurn(s, ch('Present: Emilia\nAgendas:\n- Emilia knows: declaration archived · Emilia body: black one-piece, barefoot; Emilia: circle: Jan\n- Emilia knows: coffee tin held for them; bridge reopens at eleven'), C);
    assert.equal(r.state.agendas.Emilia.aware, "bet rigged; declaration archived; coffee tin held for them; bridge reopens at eleven");
    assert.equal(r.state.agendas.Emilia.body, "black one-piece, barefoot");
    assert.equal(r.state.agendas.Emilia.circle, "Jan");
    assert.deepEqual(Object.keys(r.state.agendas), ["Emilia"]);
    assert.deepEqual(r.unparsed, []);
    const next = postTurn(r.state, ch('Agendas:\n- Emilia body: barefoot in his shirt'), C).state;
    assert.equal(next.agendas.Emilia.body, "barefoot in his shirt");
    assert.deepEqual(parseBlock(renderBlock(next, { rules: [], config: C, sections: {} }), { config: C }).state.agendas, next.agendas);
});

test("off-screen agendas advance; on-screen ones do not", () => {
    const s = emptyState();
    s.scene.present = ["Mara"];
    s.agendas = { Ana: agenda("t", 0, 2), Mara: agenda("u", 0, 2) };
    const { state } = postTurn(s, ch("Now: x"), C);
    assert.equal(state.agendas.Ana.step, 1);
    assert.equal(state.agendas.Mara.step, 0);
});

test("a new off-screen agenda does not advance the turn it is created", () => {
    const { state } = postTurn(emptyState(), ch('Agendas:\n- Ana: new "t" 0/2'), C);
    assert.equal(state.agendas.Ana.step, 0);
});

test("facts announce an off-screen agenda about to finish", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("close the café", 1, 2) };
    assert.match(preTurnFacts(s, C).join("\n"), /Ana finishes "close the café" off-screen this turn/);
});

test("facts ask to repair empty and untimed agendas while keeping NPC details", () => {
    const s = emptyState();
    s.scene.present = ["Sofia", "Jan"];
    s.agendas = {
        Sofia: agenda("", 0, 0, { aware: "the arrival time" }),
        Hélène: agenda("Porch coffee with Gilles", 0, 0),
        Jan: agenda("", 0, 0),
        Emilia: agenda("deliver the part", 0, 3),
    };
    const facts = preTurnFacts(s, C).join("\n");
    assert.match(facts, /Sofia.*no agenda.*new/i);
    assert.match(facts, /Hélène.*Porch coffee with Gilles.*new/i);
    assert.doesNotMatch(facts, /Jan|Emilia/);
    const repaired = postTurn(s, ch('Agendas:\n- Sofia: new "prepare the buns" 0/2\n- Hélène: new "Porch coffee with Gilles" 0/1'), C).state;
    assert.doesNotMatch(preTurnFacts(repaired, C).join("\n"), /Sofia.*no agenda|Hélène.*cannot advance/);
    assert.equal(repaired.agendas.Sofia.aware, "the arrival time");
    assert.equal(s.agendas.Sofia.task, "");
});

test("a completed on-screen agenda still asks for its replacement", () => {
    const s = emptyState();
    s.scene.present = ["Emilia"];
    s.agendas.Emilia = agenda("deliver the part", 3, 3);
    assert.match(preTurnFacts(s, C).join("\n"), /Emilia's agenda "deliver the part" is finished.*new one/);
    s.agendas.Emilia.step = 2;
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Emilia.*finish/);
});

test("agenda repair reminders respect the section switch", () => {
    const s = emptyState();
    s.agendas.Sofia = agenda("", 0, 0);
    assert.doesNotMatch(preTurnFacts(s, { ...C, sections: { agendas: false } }).join("\n"), /Sofia/);
});

test("agenda reminders work without a configured user name", () => {
    const s = emptyState();
    s.agendas.Sofia = agenda("", 0, 0);
    assert.match(preTurnFacts(s, resolveConfig()).join("\n"), /Sofia.*no agenda/);
});

test("done ends the task but keeps what the person knows; knows appends", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("t", 2, 2, { aware: "a" }) };
    let r = postTurn(s, ch("Agendas:\n- ana knows: b"), C);
    assert.equal(r.state.agendas.Ana.aware, "a; b");
    r = postTurn(r.state, ch('Agendas:\n- Ana: done "t" → left the key with Mara'), C);
    assert.deepEqual(r.state.agendas.Ana, agenda("", 0, 0, { aware: "a; b" }));
});

test("a junk agenda line is unparsed", () => {
    const { unparsed } = postTurn(emptyState(), ch("Agendas:\n- Ana does stuff"), C);
    assert.deepEqual(unparsed, [{ section: "Agendas", line: "Ana does stuff" }]);
});

test("a named completion without a saved agenda is a harmless comment no-op", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("restock", 0, 2) };
    const line = 'Rodrigue: done "hold the impeller for Vermont" → impeller traded into Jan\'s hands, fifty plus cash into the till';
    const r = postTurn(s, ch(`Agendas:\n- ${line}`), C);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.agendas, { Ana: agenda("restock", 1, 2) });
    assert.deepEqual(r.state.inv.items, []);
    const tagged = postTurn(s, parseChanges(`<Story_Ledger>\nAgendas:\n- ${line}\n</Story_Ledger>`), C);
    assert.deepEqual(tagged.unparsed, [{ section: "Agendas", line }]);
});

test("an unknown agenda completion still refuses malformed commands", () => {
    const lines = ['Rodrigue: done gibberish', 'Rodrigue: done "" → paid', 'Rodrigue: done "trade" →'];
    const r = postTurn(emptyState(), ch(`Agendas:\n${lines.map(line => `- ${line}`).join("\n")}`), C);
    assert.deepEqual(r.unparsed, lines.map(line => ({ section: "Agendas", line })));
    assert.deepEqual(r.state.agendas, {});
});

test("impossible agenda progress is unread and changes nothing", () => {
    const { state, unparsed } = postTurn(emptyState(), ch('Agendas:\n- Nora: new "repair" 3/2 @ shed\n- Nora: new "repair" 0/0'), C);
    assert.deepEqual(state.agendas, {});
    assert.deepEqual(state.locations, {});
    assert.deepEqual(unparsed, [
        { section: "Agendas", line: 'Nora: new "repair" 3/2 @ shed' },
        { section: "Agendas", line: 'Nora: new "repair" 0/0' },
    ]);
});

test("an agenda whose stated deadline has passed asks to be closed or replaced", () => {
    const s = emptyState();
    s.scene.present = ["Emilia", "Jan"];
    s.scene.now = "Day 3 — Monday, June 30, 2025, 12:41 PM | Good Gas Station awning";
    s.agendas.Emilia = agenda("Home before noon: deliver part, bread, ice", 0, 3);
    s.agendas.Sofia = agenda("Prep cabins by 8 PM", 0, 3);
    s.agendas.Gilles = agenda("Watch the lake until midnight", 0, 3);
    const facts = preTurnFacts(s, C).join("\n");
    assert.match(facts, /Emilia's agenda "Home before noon[^"]*" was due by noon.*story time is past it.*done.*new/i);
    assert.doesNotMatch(facts, /Sofia|Gilles/);
    s.scene.now = "Day 3 — Monday, 11:15 AM | the truck";
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Emilia/);
});

test("an overdue agenda is not flagged when the story time has no clock", () => {
    const s = emptyState();
    s.scene.present = ["Emilia"];
    s.scene.now = "Day 3 — afternoon | the truck";
    s.agendas.Emilia = agenda("Home before noon", 0, 3);
    assert.doesNotMatch(preTurnFacts(s, C).join("\n"), /Emilia/);
});
