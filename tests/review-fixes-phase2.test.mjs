// Final-review fixes for phase 2. Run: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "../src/model/config.js";
import { emptyState, nextId } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { renderBlock } from "../src/model/block.js";
import { postTurn, latestState } from "../src/model/turn.js";
import { buildTemplate } from "../src/model/prompt.js";
import { rollsForGeneration, rollsForReceive } from "../src/model/dice.js";

const C = { ...resolveConfig(), userName: "Jan", sections: {} };
const ch = body => parseChanges(`<!-- Story_Ledger\n${body}\n-->`);
const agenda = (task, step, max, more = {}) => ({ task, step, max, aware: "", fibs: "", circle: "", body: "", ...more });

test("done keeps what the person knows; done after new keeps the new agenda", () => {
    const s = emptyState();
    s.agendas = { Ana: agenda("old", 2, 2, { aware: "Mara took the key", fibs: "f" }) };
    let r = postTurn(s, ch('Agendas:\n- Ana: done "old" → x\n- Ana: new "next" 0/2'), C);
    assert.deepEqual(r.state.agendas.Ana, agenda("next", 0, 2, { aware: "Mara took the key", fibs: "f" }));
    r = postTurn(s, ch('Agendas:\n- Ana: new "next" 0/2\n- Ana: done "old"'), C);
    assert.equal(r.state.agendas.Ana.task, "next");
    r = postTurn(s, ch('Agendas:\n- Ana: done "old"'), C);
    assert.deepEqual(r.state.agendas.Ana, agenda("", 0, 0, { aware: "Mara took the key", fibs: "f" }));
});

test("echoed template placeholders are unparsed, never stored", () => {
    for (const checkStyle of ["dnd", "arrow"]) {
        const tpl = buildTemplate({ sections: {}, checkStyle });
        const body = tpl.slice(tpl.indexOf("<!-- Story_Ledger") + "<!-- Story_Ledger".length, tpl.lastIndexOf("-->"));
        const changes = parseChanges(`x\n<!-- Story_Ledger${body}-->`);
        const r = postTurn(emptyState(), changes, C);
        assert.deepEqual(r.state.locations, {});
        assert.deepEqual(r.state.agendas, {});
        assert.deepEqual(r.state.factions, {});
        assert.deepEqual(r.state.inv, { items: [], titles: [], status: [] });
        assert.deepEqual(r.state.rel, { pairs: {}, selves: {}, awaiting: {} });
        assert.deepEqual(r.state.threads, []);
        assert.deepEqual(r.state.last, []);
        assert.deepEqual(r.state.perTurn.thoughts, []);
        assert.deepEqual(r.state.perTurn.checks.lines, []);
        assert.deepEqual(changes.proposals, []);
        assert.ok(r.unparsed.length + changes.unparsed.length > 0);
    }
});

test("a hand-added quest id is never handed out again", () => {
    const s = emptyState();
    s.quests = [{ id: "Q1", kind: "Main", status: "active", objective: "a", progress: "", reward: "" }];
    const { state } = postTurn(s, ch("Quests:\n- + Side: b"), C);
    assert.deepEqual(state.quests.map(q => q.id), ["Q1", "Q2"]);
    assert.equal(nextId({ ids: { Q: 1 } }, "Q", ["Q7"]), "Q8");
});

test("spacing around a placeholder command's colon never creates a rule proposal", () => {
    const changes = ch("Proposed rules:\n- add : rule\n- add: Boats need lights at night");
    assert.deepEqual(changes.proposals, [{ op: "add", target: null, text: "Boats need lights at night" }]);
    assert.ok(changes.unparsed.some(x => x.line === "add : rule"));
});

test("placeholder relationships with alternate arrows or colon spacing never queue a pair", () => {
    for (const line of [
        "A → B : E_acc +1 (reason) | M_acc +2 (reason)",
        "A -> B: E_acc +1 (reason) | M_acc +2 (reason)",
        "A<->B: E_acc +1 (reason) | M_acc +2 (reason)",
    ]) {
        const changes = ch(`Relationships:\n- ${line}`);
        const r = postTurn(emptyState(), changes, C);
        assert.deepEqual(r.state.rel, { pairs: {}, selves: {}, awaiting: {} }, line);
        assert.deepEqual(changes.relations.unparsed, [line]);
    }
});

test("with Scene off, Present is still asked for and kept while Agendas/Cast need it", () => {
    const cfg = { ...C, sections: { scene: false } };
    assert.match(buildTemplate(cfg), /\nPresent:/);
    assert.doesNotMatch(buildTemplate(cfg), /\nNow:/);
    const s = emptyState();
    s.agendas = { Mara: agenda("u", 0, 3) };
    const r1 = postTurn(s, ch("Present: Mara"), cfg);
    const txt = renderBlock(r1.state, { rules: [], config: cfg, sections: cfg.sections });
    const back = latestState([{ mes: txt }], 1, cfg).state;
    assert.deepEqual(back.scene.present, ["Mara"]);
    assert.equal(postTurn(back, ch("Cast:\n- Mara: holding: x"), cfg).state.agendas.Mara.step, 0);
});

test("dice: continue keeps the continued reply's own dice; receive uses pending only for its own chat and reply", () => {
    const roll = () => [1, 2, 3];
    const p = rollsForGeneration({ type: "normal", chatId: "A", index: 4, pending: null, shown: null, checksOn: true, roll });
    assert.deepEqual(p, { chatId: "A", index: 4, rolls: [1, 2, 3] });
    const cont = rollsForGeneration({ type: "continue", chatId: "A", index: 4, pending: { chatId: "A", index: 4, rolls: [9, 9, 9] }, shown: [5, 6, 7], checksOn: true, roll });
    assert.deepEqual(cont.rolls, [5, 6, 7]);
    const reload = rollsForGeneration({ type: "continue", chatId: "A", index: 4, pending: null, shown: null, checksOn: true, roll });
    assert.deepEqual(reload.rolls, [1, 2, 3]);
    assert.deepEqual(rollsForReceive({ chatId: "B", index: 4, pending: p, shown: [8] }), [8]);
    assert.deepEqual(rollsForReceive({ chatId: "A", index: 4, pending: p, shown: null }), [1, 2, 3]);
    assert.deepEqual(rollsForReceive({ chatId: "A", index: 3, pending: p, shown: null }), []);
    assert.deepEqual(rollsForGeneration({ type: "normal", chatId: "A", index: 4, pending: null, shown: null, checksOn: false, roll }).rolls, []);
});
