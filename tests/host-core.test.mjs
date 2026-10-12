// The host-free core (src/host/core.js) against what index.js produced BEFORE it was extracted
// (tests/fixtures/host-core-goldens.json, recorded by tests/support/record-host-goldens.mjs).
// Every host drives these same functions, so holding them to the recording is what keeps the
// ST extension and the LocalChar extension from disagreeing about a block.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as core from "../src/host/core.js";
import { DICE_LOCKS, COMMENTS, PROSE } from "./support/st-scenarios.mjs";
import { FF_FULL } from "./fixtures/foreign.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/host-core-goldens.json", import.meta.url), "utf8"));
const substitute = text => text.replaceAll("{{user}}", "Jan");
const clone = value => JSON.parse(JSON.stringify(value));
const rng = () => 0.5;
const noticeShape = n => ({ kind: n.kind, title: n.title, message: n.text });

/** A minimal host: what a real one does around the core, enough to replay a chat. */
function miniHost({ settings = {} } = {}) {
    const host = {
        settings: core.normalizeSettings({ sections: {}, ...settings }),
        meta: {},
        chat: [],
        pending: null,
        userName: "Jan",
        get chatData() { return core.normalizeChatData(this.meta); },
        lock() { this.chatData.fudges = { dice: clone(DICE_LOCKS), appliedTo: null }; },
        pendingFor(index) { return this.pending && this.pending.index === index ? this.pending : null; },
        turn(type) {
            const index = core.generationBase(this.chat.length, type);
            const prepared = core.prepareTurn({
                chat: this.chat, type, settings: this.settings, chatData: this.chatData,
                pendingSame: this.pendingFor(index), rng,
            });
            if (prepared.fudgesChanged) this.chatData.fudges = prepared.fudgesNext;
            this.pending = prepared.pending;
            return prepared;
        },
        inject(type, options = {}) {
            const index = core.generationBase(this.chat.length, type);
            const out = core.buildInjection({
                chat: this.chat, type, settings: this.settings, chatData: this.chatData, userName: this.userName,
                pending: this.pendingFor(index), ...options,
            });
            if (out.chatDataPatch) Object.assign(this.chatData, out.chatDataPatch);
            return out;
        },
        rebuild(index, options = {}) {
            const out = core.rebuildMessage({
                chat: this.chat, index, settings: this.settings, chatData: this.chatData, userName: this.userName,
                pending: this.pendingFor(index), collect: true, proposalSource: `m${index}s${this.chat[index]?.swipe_id ?? 0}`,
                ...options,
            });
            if (!out) return null;
            const msg = this.chat[index];
            msg.mes = out.mes;
            if (Array.isArray(msg.swipes) && msg.swipes[msg.swipe_id] !== undefined) msg.swipes[msg.swipe_id] = out.mes;
            if (out.chatDataPatch) Object.assign(this.chatData, out.chatDataPatch);
            return out;
        },
    };
    return host;
}

const user = text => ({ is_user: true, name: "Jan", mes: text });
const char = text => ({ is_user: false, name: "Mara", mes: text, swipes: [text], swipe_id: 0 });

function playSixTurns(host) {
    const record = { injections: [], blocks: [], toasts: [] };
    for (let turn = 0; turn < 3; turn++) {
        host.chat.push(user(`Turn ${turn + 1}: what happens next?`));
        host.lock();
        host.turn("normal");
        const out = host.inject("normal");
        record.injections.push({ turn, prompt: substitute(out.text), reminder: substitute(out.reminder) });
        host.chat.push(char(`${PROSE[turn]}\n${COMMENTS[turn]}`));
        const rebuilt = host.rebuild(host.chat.length - 1);
        record.blocks.push(host.chat[host.chat.length - 1].mes);
        record.toasts.push(rebuilt.notices.map(noticeShape));
    }
    return record;
}

test("normalizeSettings fills the defaults, migrates 0.1 switches and merges sections", () => {
    const s = core.normalizeSettings({});
    assert.deepEqual(
        { enabled: s.enabled, stickyNotices: s.stickyNotices, fixupMode: s.fixupMode, fixupHistory: s.fixupHistory, depth: s.depth, role: s.role, placement: s.placement, theme: s.theme, checkStyle: s.checkStyle, config: s.config },
        { enabled: true, stickyNotices: true, fixupMode: "full", fixupHistory: 4, depth: 1, role: 0, placement: "auto", theme: "frankenstein", checkStyle: "dnd", config: {} },
    );
    assert.equal(s.sections.scene, true);
    const migrated = core.normalizeSettings({ clock: false, relations: true, notebook: false });
    assert.deepEqual([migrated.sections.scene, migrated.sections.relationships, migrated.sections.notebook], [false, true, false]);
    assert.equal(migrated.clock, undefined);
    const kept = core.normalizeSettings({ sections: { quests: false } });
    assert.equal(kept.sections.quests, false);
    assert.equal(kept.sections.scene, true);
    const raw = { theme: "sola" };
    core.normalizeSettings(raw);
    assert.deepEqual(raw, { theme: "sola" }, "the input is not mutated");
});

test("normalizeChatData builds the document, carries a Megumin notebook over, and keeps the replay inputs", () => {
    const fresh = core.normalizeChatData({});
    assert.equal(fresh.fudges, null);
    assert.deepEqual(Object.keys(fresh.notebook).sort(), Object.keys(core.normalizeChatData({}).notebook).sort());
    const meta = { meguminNotebook: { rules: ["Keep it short."] } };
    assert.deepEqual(core.normalizeChatData(meta).notebook.rules, ["Keep it short."]);
    const own = { storyLedger: { notebook: { rules: ["A"] }, ctOffset: 3, corrections: [{ atLength: 2 }], fudges: { appliedTo: 1 } } };
    const data = core.normalizeChatData(own);
    assert.equal(data, own.storyLedger, "the stored object is the one returned (a host saves it in place)");
    assert.equal(data.ctOffset, 3);
    assert.deepEqual(data.fudges, { appliedTo: 1 });
});

test("six turns: injections, written blocks and notices equal the pre-extraction recording", () => {
    const host = miniHost();
    const got = playSixTurns(host);
    got.injections.forEach((injection, i) => {
        assert.equal(injection.prompt, golden.sixTurns.injections[i].prompt[0], `turn ${i} injection`);
        assert.equal(injection.reminder, golden.sixTurns.injections[i].reminder[0], `turn ${i} reminder`);
    });
    got.blocks.forEach((block, i) => assert.equal(block, golden.sixTurns.blocks[i], `turn ${i} block`));
    assert.deepEqual(got.toasts, golden.sixTurns.toasts);
    assert.deepEqual(clone(host.chatData), golden.sixTurns.chatData);
});

test("buildInjection text for normal/continue/swipe", () => {
    const host = miniHost();
    playSixTurns(host);
    for (const type of ["normal", "continue", "swipe"]) {
        host.lock();
        host.pending = null;
        host.turn(type);
        const out = host.inject(type);
        assert.equal(substitute(out.text), golden.byType[type].prompt[0], `${type} text`);
        assert.equal(substitute(out.reminder), golden.byType[type].reminder[0], `${type} reminder`);
        assert.deepEqual(clone(host.chatData.fudges), golden.byType[type].fudges, `${type} fudges`);
    }
});

test("macro placement appends the reminder to the text and leaves the in-chat reminder to the host", () => {
    const host = miniHost({ settings: { placement: "macro" } });
    playSixTurns(host);
    host.lock();
    host.pending = null;
    host.turn("normal");
    const out = host.inject("normal");
    assert.equal(substitute(out.text), golden.macro.macro);
    assert.ok(out.reminder.length > 0, "the reminder is still produced (the host decides where it goes)");
});

test("rebuildMessage block equals the block index.js produced before the move", () => {
    const host = miniHost();
    const got = playSixTurns(host);
    assert.equal(got.blocks.length, 3);
    for (const block of got.blocks) assert.match(block, /story-ledger-state v1/);
});

test("a disabled ledger or a skipped type injects nothing", () => {
    const host = miniHost({ settings: { enabled: false } });
    host.chat = [user("Hi.")];
    assert.equal(host.inject("normal").text, "");
    const on = miniHost();
    on.chat = [user("Hi.")];
    for (const type of ["quiet", "impersonate", "first_message"]) assert.equal(on.inject(type).text, "", type);
    assert.ok(core.SKIP_TYPES.has("quiet") && core.SKIP_TYPES.has("impersonate") && core.SKIP_TYPES.has("first_message"));
});

test("notices match the texts index.js showed", () => {
    for (const [name, expected] of Object.entries(golden.notices)) {
        const host = miniHost();
        if (name === "dayBackwards") {
            host.chat = [user("a")];
            host.lock(); host.turn("normal");
            host.chat.push(char(`P.\n${COMMENTS[2]}`));
            host.rebuild(1);
            host.chat.push(user("b"));
            host.turn("normal");
            host.chat.push(char("P.\n<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPresent: Mara\n-->"));
            const out = host.rebuild(3);
            assert.deepEqual(out.notices.map(noticeShape), expected.toasts, name);
            assert.equal(host.chat[3].mes, expected.mes, name);
            continue;
        }
        const prose = {
            noComment: "Only prose here.",
            unreadableLine: "Prose.\n<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPresent: Mara\nWorld:\n- gibberish that no section reads\nNonsense Heading:\n- x\n-->",
            proposal: `Prose.\n${COMMENTS[2]}`,
        }[name];
        host.chat = [user("Go on.")];
        host.lock(); host.turn("normal");
        host.chat.push(char(prose));
        const out = host.rebuild(1);
        assert.deepEqual(out.notices.map(noticeShape), expected.toasts, name);
        assert.equal(host.chat[1].mes, expected.mes, name);
    }
});

test("every notice names its kind and a title", () => {
    const host = miniHost();
    host.chat = [user("Go on.")];
    host.lock(); host.turn("normal");
    host.chat.push(char("Only prose here."));
    const [first] = host.rebuild(1).notices;
    assert.deepEqual(Object.keys(first).sort(), ["kind", "text", "title"]);
    assert.equal(first.kind, "warning");
});

test("fudge lifecycle across two turns", () => {
    const host = miniHost();
    playSixTurns(host);
    const sixth = host.chat.slice();
    host.meta = {};
    host.chat = clone(sixth).slice(0, 5);
    host.pending = null;
    host.lock();
    const first = host.turn("normal");
    assert.equal(first.fudgesChanged, true);
    assert.deepEqual(clone(host.chatData.fudges), golden.fudgeLifecycle.first);
    const firstPrompt = substitute(host.inject("normal").text);
    assert.equal(firstPrompt, golden.fudgeLifecycle.firstPrompt);

    host.chat = clone(sixth);
    host.pending = null;
    host.turn("normal");
    assert.equal(host.chatData.fudges, golden.fudgeLifecycle.second);
    assert.equal(substitute(host.inject("normal").text), golden.fudgeLifecycle.secondPrompt);
});

test("a continue keeps the dice its block already shows", () => {
    const host = miniHost();
    playSixTurns(host);
    host.meta = {};
    host.pending = null;
    host.turn("continue");
    assert.equal(substitute(host.inject("continue").text), golden.continueDice.prompt);
    assert.equal(host.chatData.fudges, golden.continueDice.fudges);
});

test("prepareTurn reuses a pending turn's dice for a continue of the same reply", () => {
    const chat = [user("Hi."), char("Prose.")];
    const first = core.prepareTurn({ chat, type: "swipe", settings: core.normalizeSettings({}), chatData: core.normalizeChatData({}), pendingSame: null, rng: () => 0.0 });
    const again = core.prepareTurn({ chat, type: "continue", settings: core.normalizeSettings({}), chatData: core.normalizeChatData({}), pendingSame: first.pending, rng: () => 0.99 });
    assert.deepEqual(again.pending.dice, first.pending.dice);
    assert.equal(again.pending.index, 1);
});

test("a handover from another preset: the injection, the proposed rules and the notice", () => {
    const host = miniHost();
    host.chat = [user("Hello."), char(FF_FULL), user("And then?")];
    host.lock();
    host.turn("normal");
    const out = host.inject("normal");
    assert.equal(substitute(out.text), golden.handover.prompt[0]);
    assert.deepEqual(out.notices.map(noticeShape), golden.handover.toasts);
    assert.ok(out.chatDataPatch && out.chatDataPatch.imported && out.chatDataPatch.notebook);
    assert.deepEqual(clone(host.chatData), golden.handover.saved);
});

test("a handover is proposed once: the second injection has no patch and no notice", () => {
    const host = miniHost();
    host.chat = [user("Hello."), char(FF_FULL), user("And then?")];
    host.lock(); host.turn("normal");
    host.inject("normal");
    host.pending = null;
    const again = host.inject("normal");
    assert.equal(again.chatDataPatch, null);
    assert.deepEqual(again.notices, []);
});

test("fixupCaseFor: only the last reply, only while idle", () => {
    const settings = core.normalizeSettings({});
    const chat = [user("Hi."), char("Prose, no comment.")];
    assert.equal(core.fixupCaseFor({ chat, index: 1, settings, busy: false }), "missing");
    assert.equal(core.fixupCaseFor({ chat, index: 1, settings, busy: true }), null);
    assert.equal(core.fixupCaseFor({ chat, index: 0, settings, busy: false }), null);
    assert.equal(core.fixupCaseFor({ chat: [...chat, user("Next")], index: 1, settings, busy: false }), null);
    assert.equal(core.fixupCaseFor({ chat, index: 1, settings: core.normalizeSettings({ enabled: false }), busy: false }), null);
});

test("judgeFixup accepts a usable comment and splices it into the reply", () => {
    const host = miniHost();
    host.chat = [user("Hi."), char(`${PROSE[0]}`)];
    host.lock(); host.turn("normal");
    const run = { index: 1, mes: host.chat[1].mes, kase: "missing", mode: "lean", swipeId: 0, config: core.engineConfig(host.settings, "Jan", { dice: clone(host.pending.dice), fudges: null, fudgedDice: [], rolls: host.pending.dice.checks }) };
    const ok = core.judgeFixup({ run, chat: host.chat, settings: host.settings, chatData: host.chatData, userName: "Jan", output: COMMENTS[0] });
    assert.equal(ok.ok, true);
    assert.match(ok.mes, /Story_Ledger/);
    assert.ok(ok.mes.startsWith(PROSE[0]));
    const bad = core.judgeFixup({ run, chat: host.chat, settings: host.settings, chatData: host.chatData, userName: "Jan", output: "I cannot help with that." });
    assert.equal(bad.ok, false);
    assert.equal(typeof bad.reason, "string");
});

test("fixupReplyUnchanged compares the live reply with the snapshot", () => {
    const chat = [user("Hi."), char("Reply.")];
    const run = { index: 1, mes: "Reply.", swipeId: 0, mode: "lean" };
    assert.equal(core.fixupReplyUnchanged({ run, chat }), true);
    assert.equal(core.fixupReplyUnchanged({ run: { ...run, mode: "full" }, chat: [chat[0], { ...chat[1], mes: "Reply. More." }] }), true);
    assert.equal(core.fixupReplyUnchanged({ run, chat: [chat[0], { ...chat[1], mes: "Edited." }] }), false);
    assert.equal(core.fixupReplyUnchanged({ run, chat: [...chat, user("Next")] }), false);
    assert.equal(core.fixupReplyUnchanged({ run, chat: [chat[0], { ...chat[1], swipe_id: 1 }] }), false);
});

test("leanInputs gathers the lean prompt input and substitutes the host's macros", () => {
    const host = miniHost();
    host.chat = [user("Hi {{user}}."), char(`${PROSE[0]}\n${COMMENTS[0]}`), user("More."), char("A reply without a comment.")];
    host.lock(); host.turn("normal");
    const run = { index: 3, mes: host.chat[3].mes, kase: "missing", mode: "lean", config: core.engineConfig(host.settings, "Jan", {}) };
    const input = core.leanInputs({
        chat: host.chat, index: 3, run, settings: host.settings, chatData: host.chatData, userName: "Jan",
        mainPrompt: "MAIN", characters: [{ name: "Mara", description: "d", personality: "p" }], personaName: "Jan", summary: "SUMMARY",
        substitute,
    });
    assert.equal(input.mainPrompt, "MAIN");
    assert.equal(input.summary, "SUMMARY");
    assert.equal(input.historyCount, host.settings.fixupHistory);
    assert.deepEqual(input.history.map(m => m.role), ["user", "assistant", "user"]);
    assert.ok(!input.history[1].text.includes("Story_Ledger"), "history carries prose only");
    assert.equal(input.reply.text, "A reply without a comment.");
    assert.ok(!input.statePrompt.includes("{{user}}"));
});

test("popupHtml renders every tab from a plain view", () => {
    const host = miniHost();
    playSixTurns(host);
    const view = { chat: host.chat, settings: host.settings, chatData: host.chatData, userName: "Jan" };
    for (const tab of ["rules", "threads", "clock", "quests", "rel", "dice", "settings"]) {
        const html = core.popupHtml(tab, view, { fate: { a: 1, b: 2, c: 3 }, world: 4, checks: [5, 6, 7] });
        assert.match(html, /class="sl-popup"/, tab);
        assert.match(html, new RegExp(`data-sl-popup-tab="${tab}"`), tab);
    }
    assert.match(core.popupHtml("rules", view, null), /Keep chapters short\./, "the proposal waiting in the inbox is listed");
});

test("the core imports no host: no SillyTavern, no DOM, no jQuery, no toastr", () => {
    const text = readFileSync(new URL("../src/host/core.js", import.meta.url), "utf8");
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [/SillyTavern/, /\bdocument\b/, /\bwindow\b/, /\$\(/, /toastr/, /\bjQuery\b/, /getContext/]) {
        assert.doesNotMatch(code, forbidden, String(forbidden));
    }
});
