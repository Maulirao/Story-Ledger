import test from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/host/core.js";
import { emptyState } from "../src/model/state.js";
import { renderBlock, parseBlock } from "../src/model/block.js";

const clone = x => JSON.parse(JSON.stringify(x));
function fixture() {
    const settings = core.normalizeSettings({ sections: {} });
    const config = core.engineConfig(settings, "Jan");
    const state = emptyState();
    state.ct = 7;
    state.scene.present = ["Mara"];
    const pair = (from, to) => ({ from, to, axes: Object.fromEntries(config.axes.map(a => [a.key, 5])), acc: Object.fromEntries(config.axes.map(a => [a.key, 1])), note: "a saved description" });
    state.rel.pairs["Boatman→Jan"] = pair("Boatman", "Jan");
    state.rel.pairs["Mara→Jan"] = pair("Mara", "Jan");
    state.rel.selves = { Boatman: { phi: 4, acc: 2 }, Mara: { phi: 8, acc: 1 } };
    const chat = [{ is_user: false, mes: `Story prose\n${renderBlock(state, { config })}` }];
    return { settings, config, state, chat, chatData: core.normalizeChatData({}), userName: "Jan" };
}
function choose(view, key, pruned) {
    assert.equal(typeof core.setRelationshipPruned, "function", "the Relationships tab needs a saved prune/restore action");
    const out = core.setRelationshipPruned(view, key, pruned);
    assert.equal(out.ok, true);
    Object.assign(view.chatData, out.chatDataPatch);
}
function reply(view, text) {
    const index = view.chat.length;
    view.chat.push({ is_user: false, mes: `Story prose\n<!-- Story_Ledger\nRelationships:\n${text}\n-->` });
    const out = core.rebuildMessage({ ...view, index });
    view.chat[index].mes = out.mes;
    if (out.chatDataPatch) Object.assign(view.chatData, out.chatDataPatch);
    return parseBlock(out.mes, { config: view.config }).state;
}
test("pruning immediately removes a tracker from the prompt and survives a metadata reload", () => {
    const v = fixture();
    assert.match(core.buildInjection(v).text, /Boatman/);
    const original = clone(v.chat);
    choose(v, "Boatman→Jan", true);
    v.chatData = core.normalizeChatData({ storyLedger: clone(v.chatData) });
    const prompt = core.buildInjection(v).text;
    assert.doesNotMatch(prompt, /Boatman/);
    assert.match(prompt, /Mara → Jan/);
    assert.deepEqual(v.chat, original, "pruning keeps the old reply intact");
    const html = core.popupHtml("rel", v);
    assert.match(html, /Pruned relationships/);
    assert.match(html, /data-rel-restore="Boatman→Jan"/);
    assert.doesNotMatch(html, /data-rel-prune="Boatman→Jan"/);
});
test("pruned trackers cannot be recreated by NEW, ticks, notes, DIRECT or self-regard events", () => {
    const v = fixture();
    choose(v, "Boatman→Jan", true);
    const axes = v.config.axes.map(a => `${a.key} 19`).join(", ");
    const s = reply(v, `- NEW Boatman → Jan: ${axes} | Φ 19 (returned)\n- Boatman → Jan: E_acc +2 (gift)\n- DIRECT Boatman → Jan: Ph +2 (rescue)\n- NOTE Boatman → Jan: changed\n- Boatman: Φ_acc +2 (proud)\n- Mara → Jan: Ph_acc +1 (chat)`);
    assert.equal(s.rel.pairs["Boatman→Jan"], undefined);
    assert.equal(s.rel.selves.Boatman, undefined);
    assert.equal(s.rel.awaiting["Boatman→Jan"], undefined);
    assert.ok(!s.rel.pending?.some(p => p.from === "Boatman"));
    assert.ok(s.rel.pairs["Mara→Jan"], "other relationships keep updating");
    assert.doesNotMatch(core.buildInjection(v).text, /Boatman/);
});
test("restore recovers the saved values after intervening turns and later edits remain authoritative", () => {
    const v = fixture();
    const original = clone(v.state.rel.pairs["Boatman→Jan"]);
    choose(v, "Boatman→Jan", true);
    reply(v, "");
    reply(v, "");
    choose(v, "Boatman→Jan", false);
    const restored = core.stateBefore(v.chat, v.chat.length, v.config, v.chatData);
    assert.deepEqual(restored.rel.pairs["Boatman→Jan"], original);
    assert.deepEqual(restored.rel.selves.Boatman, { phi: 4, acc: 2 });
    assert.match(core.buildInjection(v).text, /Boatman → Jan/);
    const next = reply(v, "- NOTE Boatman → Jan: back in the story");
    assert.equal(next.rel.pairs["Boatman→Jan"].note, "back in the story");
    const newest = core.stateBefore(v.chat, v.chat.length, v.config, v.chatData);
    assert.equal(newest.rel.pairs["Boatman→Jan"].note, "back in the story");
    choose(v, "Boatman→Jan", true);
    choose(v, "Boatman→Jan", false);
    assert.equal(core.stateBefore(v.chat, v.chat.length, v.config, v.chatData).rel.pairs["Boatman→Jan"].note, "back in the story");
});
test("pruning an awaiting tracker suppresses baseline reminders and preserves its queued events for restore", () => {
    const v = fixture();
    v.state.rel.awaiting["Vendor→Jan"] = "first meeting";
    v.state.rel.pending = [{ from: "Vendor", to: "Jan", kind: "tick", acc: "Ph", amount: 1, reason: "helpful", ct: 7 }];
    v.chat[0].mes = renderBlock(v.state, { config: v.config });
    choose(v, "Vendor→Jan", true);
    assert.doesNotMatch(core.buildInjection(v).text + core.buildInjection(v).reminder, /Vendor/);
    reply(v, "- Vendor → Jan: Ph_acc +2 (more)");
    choose(v, "Vendor→Jan", false);
    const s = core.stateBefore(v.chat, v.chat.length, v.config, v.chatData);
    assert.equal(s.rel.awaiting["Vendor→Jan"], "first meeting");
    assert.equal(s.rel.pending.length, 1);
    assert.equal(s.rel.pending[0].amount, 1);
});
test("pruning is directional and keeps self-regard when the sender still has another active tracker", () => {
    const v = fixture();
    const p = clone(v.state.rel.pairs["Boatman→Jan"]);
    v.state.rel.pairs["Boatman→Mara"] = { ...p, to: "Mara" };
    v.state.rel.pairs["Mara→Boatman"] = { ...p, from: "Mara", to: "Boatman" };
    v.chat[0].mes = renderBlock(v.state, { config: v.config });
    choose(v, "Boatman→Jan", true);
    const s = core.stateBefore(v.chat, v.chat.length, v.config, v.chatData);
    assert.ok(s.rel.pairs["Boatman→Mara"]);
    assert.ok(s.rel.pairs["Mara→Boatman"]);
    assert.deepEqual(s.rel.selves.Boatman, { phi: 4, acc: 2 });
});

test("restoring during a continue uses the updated block, and a swipe can rebuild from the restored baseline", () => {
    const v = fixture();
    choose(v, "Boatman→Jan", true);
    reply(v, "");
    choose(v, "Boatman→Jan", false);
    const index = v.chat.length - 1;
    v.chat[index].mes += "\n<!-- Story_Ledger\nRelationships:\n- NOTE Boatman → Jan: returned during continuation\n-->";
    const out = core.rebuildMessage({ ...v, index });
    v.chat[index].mes = out.mes;
    if (out.chatDataPatch) Object.assign(v.chatData, out.chatDataPatch);
    assert.equal(core.stateBefore(v.chat, v.chat.length, v.config, v.chatData).rel.pairs["Boatman→Jan"].note, "returned during continuation");
    v.chat[index].mes = "<!-- Story_Ledger\nRelationships:\n- NOTE Boatman → Jan: a different swipe\n-->";
    const swiped = core.rebuildMessage({ ...v, index });
    assert.equal(parseBlock(swiped.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"].note, "a different swipe");
});

test("invalid tracker actions leave chat data untouched", () => {
    const v = fixture();
    assert.equal(typeof core.setRelationshipPruned, "function");
    const original = clone(v.chatData);
    assert.equal(core.setRelationshipPruned(v, "Missing→Jan", true).ok, false);
    assert.equal(core.setRelationshipPruned(v, "Missing→Jan", false).ok, false);
    assert.deepEqual(v.chatData, original);
});

test("restoring and rebuilding the archived source reply does not apply its ticks twice", () => {
    const v = fixture();
    const before = reply(v, "- Boatman → Jan: E_acc +1 (one gift)");
    const expected = clone(before.rel.pairs["Boatman→Jan"]);
    choose(v, "Boatman→Jan", true);
    choose(v, "Boatman→Jan", false);
    const index = v.chat.length - 1;
    const rebuilt = core.rebuildMessage({ ...v, index });
    assert.deepEqual(parseBlock(rebuilt.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"], expected);
});

test("restoring during a continued reply keeps previously blocked events ignored but accepts new events", () => {
    const v = fixture();
    choose(v, "Boatman→Jan", true);
    reply(v, "- DIRECT Boatman → Jan: E +2 (ignored while pruned)");
    choose(v, "Boatman→Jan", false);
    const index = v.chat.length - 1;
    assert.match(core.buildInjection({ ...v, type: "continue" }).text, /Boatman → Jan/);
    const old = core.rebuildMessage({ ...v, index });
    assert.equal(parseBlock(old.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"].axes.E, 5);
    v.chat[index].mes += "\n<!-- Story_Ledger\nRelationships:\n- DIRECT Boatman → Jan: E +1 (new after restoring)\n-->";
    const out = core.rebuildMessage({ ...v, index });
    assert.equal(parseBlock(out.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"].axes.E, 6);
});

test("restoration does not repeat deterministic conversion or decay in the same reply", () => {
    const v = fixture();
    v.state.ct = 9;
    v.state.rel.pairs["Boatman→Jan"].axes = Object.fromEntries(v.config.axes.map(a => [a.key, 20]));
    v.state.rel.pairs["Boatman→Jan"].axes.M = 10;
    v.chat[0].mes = renderBlock(v.state, { config: v.config });
    const before = reply(v, "");
    choose(v, "Boatman→Jan", true);
    choose(v, "Boatman→Jan", false);
    const out = core.rebuildMessage({ ...v, index: v.chat.length - 1 });
    assert.deepEqual(parseBlock(out.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"], before.rel.pairs["Boatman→Jan"]);
});

test("a stale Restore click cannot reset a tracker that is already active", () => {
    const v = fixture();
    choose(v, "Boatman→Jan", true);
    choose(v, "Boatman→Jan", false);
    reply(v, "- NOTE Boatman → Jan: changed after restoring");
    choose(v, "Boatman→Jan", false);
    assert.equal(core.stateBefore(v.chat, v.chat.length, v.config, v.chatData).rel.pairs["Boatman→Jan"].note, "changed after restoring");
});

test("an identical command in a new swipe applies after restoring", () => {
    const v = fixture();
    choose(v, "Boatman→Jan", true);
    reply(v, "- DIRECT Boatman → Jan: E +2 (gift)");
    choose(v, "Boatman→Jan", false);
    const index = v.chat.length - 1;
    v.chat[index].swipe_id = 1;
    const out = core.rebuildMessage({ ...v, index });
    assert.equal(parseBlock(out.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"].axes.E, 7);
});

test("an identical command in a newly appended ledger comment is a new continuation event", () => {
    const v = fixture();
    choose(v, "Boatman→Jan", true);
    reply(v, "- DIRECT Boatman → Jan: E +2 (gift)");
    choose(v, "Boatman→Jan", false);
    const index = v.chat.length - 1;
    v.chat[index].mes += "\n<!-- Story_Ledger\nRelationships:\n- DIRECT Boatman → Jan: E +2 (gift)\n-->";
    const out = core.rebuildMessage({ ...v, index });
    assert.equal(parseBlock(out.mes, { config: v.config }).state.rel.pairs["Boatman→Jan"].axes.E, 7);
});
