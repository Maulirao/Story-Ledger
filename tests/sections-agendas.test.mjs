// 👤 NPC AGENDAS — off-screen lives. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig, sanitizeAgendaStep } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock, parseBlock } from "../src/model/block.js";
import { postTurn, preTurnFacts, sectionContext } from "../src/model/turn.js";
import { sectionByKey } from "../src/model/sections/registry.js";
import { renderRules, buildTemplate } from "../src/model/prompt.js";

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

test("a new task explicitly marked done is a completion in comments", () => {
    const line = 'Clerk: new "Close the dollar store at one, catch the afternoon bus" → done; store locked at one, bus caught; agenda closed';
    const s = emptyState();
    s.agendas.Clerk = agenda("close the store", 1, 2, { aware: "bus leaves at two", body: "coat" });
    const r = postTurn(s, ch(`Agendas:\n- ${line}`), C);
    assert.deepEqual(r.unparsed, []);
    assert.deepEqual(r.state.agendas.Clerk, agenda("", 0, 0, { aware: "bus leaves at two", body: "coat" }));
    const unknown = postTurn(emptyState(), ch(`Agendas:\n- ${line}`), C);
    assert.deepEqual(unknown.unparsed, []);
    assert.deepEqual(unknown.state.agendas, {});
    const replacement = postTurn(s, ch(`Agendas:\n- Clerk: new "go home" 0/2\n- ${line}`), C);
    assert.equal(replacement.state.agendas.Clerk.task, "go home");
    assert.equal(replacement.state.agendas.Clerk.step, 0);
    const tagged = postTurn(s, parseChanges(`<Story_Ledger>\nAgendas:\n- ${line}\n</Story_Ledger>`), C);
    assert.deepEqual(tagged.unparsed, [{ section: "Agendas", line }]);
});

test("a new task followed by done is a completion in comments", () => {
    const line = 'Emilia: new "wake up wearing the ring and make Jan say lumière de ma vie as his first word" done → he said it; new agenda below';
    for (const completion of [line, 'Emilia: new "wake up" done']) {
        const s = emptyState();
        s.agendas.Emilia = agenda("wake up", 0, 2, { body: "ring", aware: "the promise" });
        const r = postTurn(s, ch(`Agendas:\n- ${completion}`), C);
        assert.deepEqual(r.unparsed, []);
        assert.deepEqual(r.state.agendas.Emilia, agenda("", 0, 0, { body: "ring", aware: "the promise" }));
        assert.deepEqual(postTurn(emptyState(), ch(`Agendas:\n- ${completion}`), C).unparsed, []);
        const replacement = postTurn(s, ch(`Agendas:\n- Emilia: new "make breakfast" 0/2\n- ${completion}`), C);
        assert.equal(replacement.state.agendas.Emilia.task, "make breakfast");
        assert.equal(replacement.state.agendas.Emilia.step, 0);
        assert.deepEqual(postTurn(s, parseChanges(`<Story_Ledger>\nAgendas:\n- ${completion}\n</Story_Ledger>`), C).unparsed, [{ section: "Agendas", line: completion }]);
    }
});

test("incomplete new agenda commands are not inferred to be completions", () => {
    const lines = ['Clerk: new "done with shopping"', 'Clerk: new "close" → done soon', 'Clerk: new "close" → store locked', 'Clerk: new "" → done', 'Clerk: new "close" 3/2 → done'];
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

const at = (now, agendas, present = []) => { const s = emptyState(); s.scene.now = now; s.scene.present = present; s.agendas = agendas; return s; };

test("takes sets how long each step is; an unreadable length is warned about and the agenda still given", () => {
    const r = postTurn(emptyState(), ch('Agendas:\n- Ana: new "mend the nets" 0/2 @ the harbour, takes 2h\n- Tom: new "ride to the capital" 0/3, takes 3 days\n- Eva: new "wait" 0/1 @ the inn, takes a while\n- Kai: new "bake" 0/2 takes 1h @ the mill'), C);
    assert.deepEqual(r.state.agendas.Ana, agenda("mend the nets", 0, 2, { pace: 60 }));
    assert.deepEqual(r.state.agendas.Tom, agenda("ride to the capital", 0, 3, { pace: 1440 }));
    assert.deepEqual(r.state.agendas.Eva, agenda("wait", 0, 1));
    assert.deepEqual(r.state.agendas.Kai, agenda("bake", 0, 2, { pace: 30 }));
    assert.deepEqual(r.state.locations, { Ana: "the harbour", Eva: "the inn", Kai: "the mill" });
    assert.deepEqual(r.warnings.map(w => w.text), ['Eva "wait": could not read the length "a while" — each step takes 30m.']);
    assert.deepEqual(r.unparsed, []);
});

test("small amounts of story time add up, and a jump can pass several steps", () => {
    const s = at("Day 3 — 10:00", { Ana: agenda("mend the nets", 0, 3, { pace: 60 }), Tom: agenda("sweep", 0, 2) });
    const a = postTurn(s, ch("Now: Day 3 — 10:20"), C).state;
    assert.deepEqual(a.agendas.Ana, agenda("mend the nets", 0, 3, { pace: 60, spent: 20 }));
    assert.deepEqual(a.agendas.Tom, agenda("sweep", 0, 2, { pace: 30, spent: 20 }));
    const b = postTurn(a, ch("Now: Day 3 — 10:45"), C).state;
    assert.deepEqual(b.agendas.Ana, agenda("mend the nets", 0, 3, { pace: 60, spent: 45 }));
    assert.deepEqual(b.agendas.Tom, agenda("sweep", 1, 2, { pace: 30, spent: 15 }));
    const c = postTurn(b, ch("Now: Day 4 — 08:00"), C).state;
    assert.deepEqual(c.agendas.Ana, agenda("mend the nets", 3, 3, { pace: 60 }));
    assert.deepEqual(c.agendas.Tom, agenda("sweep", 2, 2, { pace: 30 }));
});

test("time on-screen does not count, and what was spent before is kept", () => {
    const s = at("Day 3 — 10:00", { Ana: agenda("mend the nets", 0, 2, { pace: 60, spent: 40 }) }, ["Ana"]);
    const here = postTurn(s, ch("Now: Day 3 — 12:00"), C).state;
    assert.deepEqual(here.agendas.Ana, agenda("mend the nets", 0, 2, { pace: 60, spent: 40 }));
    const gone = postTurn(here, ch("Now: Day 3 — 12:30\nPresent: Jan"), C).state;
    assert.deepEqual(gone.agendas.Ana, agenda("mend the nets", 1, 2, { pace: 60, spent: 10 }));
});

test("without a time of day an agenda gains one step per reply; a clock that went backwards adds nothing", () => {
    const vague = at("morning", { Ana: agenda("t", 0, 3, { pace: 60, spent: 20 }) });
    assert.deepEqual(postTurn(vague, ch("Now: later that morning"), C).state.agendas.Ana, agenda("t", 1, 3, { pace: 60, spent: 20 }));
    const back = at("Day 3 — 10:00", { Ana: agenda("t", 0, 3, { pace: 60, spent: 20 }) });
    assert.deepEqual(postTurn(back, ch("Now: Day 3 — 09:00"), C).state.agendas.Ana, agenda("t", 0, 3, { pace: 60, spent: 20 }));
});

test("done, a new agenda and a written progress line clear what was spent", () => {
    const row = () => agenda("a", 1, 3, { pace: 60, spent: 20 });
    const s = at("Day 3 — 10:00", { Ana: row(), Tom: row(), Eva: row() });
    const { state } = postTurn(s, ch('Agendas:\n- Ana: done "a"\n- Tom: new "d" 0/2\n- Eva: a (2/3)'), C);
    assert.deepEqual(state.agendas.Ana, agenda("", 0, 0));
    assert.deepEqual(state.agendas.Tom, agenda("d", 0, 2));
    assert.deepEqual(state.agendas.Eva, agenda("a", 2, 3, { pace: 60 }));
});

test("a plain row reads and writes as before, and a timed row round-trips", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("mend the nets", 1, 2, { pace: 60, spent: 20 }), Tom: agenda("sweep", 0, 2), Eva: agenda("ride", 0, 3, { pace: 1440 }) };
    const txt = renderBlock(s, { rules: [], config: C, sections: {} });
    assert.ok(txt.includes("| Agenda: mend the nets | (Step 1/2 · 20m of 1h) |"));
    assert.ok(txt.includes("| Agenda: sweep | (Step 0/2) |"));
    assert.ok(txt.includes("| Agenda: ride | (Step 0/3 · 0m of 1d) |"));
    assert.deepEqual(parseBlock(txt, { config: C }).state.agendas, s.agendas);
});

test("the slice is a number from 1 to 1440 that a saved config can change", () => {
    assert.equal(resolveConfig().sectionConfig.agendaStepMinutes, 30);
    assert.equal(resolveConfig({ sectionConfig: { agendaStepMinutes: 45 } }).sectionConfig.agendaStepMinutes, 45);
    assert.deepEqual(["90", "", "abc", "0", "2000"].map(v => sanitizeAgendaStep(v, 30)), [90, 30, 30, 1, 1440]);
    const cfg = { ...C, sectionConfig: { ...C.sectionConfig, agendaStepMinutes: 10 } };
    const s = at("Day 3 — 10:00", { Tom: agenda("sweep", 0, 2) });
    assert.deepEqual(postTurn(s, ch("Now: Day 3 — 10:15"), cfg).state.agendas.Tom, agenda("sweep", 1, 2, { pace: 10, spent: 5 }));
});

test("with a clock the finish is announced after it happens, with its effect; without one it is announced ahead", () => {
    const s = at("Day 3 — 10:00", { Ana: agenda("close the café", 1, 2), Tom: agenda("sweep", 2, 2) }, ["Tom"]);
    const told = () => preTurnFacts(s, C).join("\n");
    assert.doesNotMatch(told(), /this turn/);
    assert.match(told(), /Tom's agenda "sweep" is finished — give Tom a new one\./);
    s.agendas.Ana.step = 2;
    assert.match(told(), /Ana finished "close the café" off-screen — apply its effect and give Ana a new agenda\./);
    s.agendas.Ana.step = 1;
    s.scene.now = "evening";
    assert.match(told(), /Ana finishes "close the café" off-screen this turn/);
});

test("the model is shown about how much story time an off-screen task has left", () => {
    const s = at("Day 3 — 10:00", { Ana: agenda("mend the nets", 1, 3, { pace: 60, spent: 20 }), Tom: agenda("sweep", 0, 2), Eva: agenda("rest", 0, 1) }, ["Eva"]);
    const shown = () => sectionByKey("agendas").prompt(s.agendas, s, sectionContext(s, s.scene.present, C));
    assert.match(shown(), /- Ana \(off-screen\) — mend the nets \(1\/3, about 1h40m left\)/);
    assert.match(shown(), /- Tom \(off-screen\) — sweep \(0\/2, about 1h left\)/);
    assert.match(shown(), /- Eva — rest \(0\/1\)/);
    s.scene.now = "evening";
    assert.match(shown(), /- Ana \(off-screen\) — mend the nets \(1\/3\)/);
});

test("the rules and the template teach takes, with the configured slice", () => {
    assert.match(renderRules(C), /advance with the story's clock, not with each reply/);
    assert.match(renderRules(C), /each step is about 30m of story time/);
    assert.match(renderRules({ ...C, sectionConfig: { ...C.sectionConfig, agendaStepMinutes: 45 } }), /each step is about 45m of story time/);
    assert.doesNotMatch(renderRules(C), /advance on their own/);
    assert.ok(buildTemplate(C).includes('- Name: new "task" 0/N @ place, takes 2h'));
});

test("without a clock a finished off-screen agenda, already announced ahead, is not asked for its effect again", () => {
    const told = preTurnFacts(at("evening", { Ana: agenda("close the café", 2, 2) }), C).join("\n");
    assert.match(told, /Ana's agenda "close the café" is finished — give Ana a new one\./);
    assert.doesNotMatch(told, /apply its effect/);
});
