// The LocalChar browser entry, driven through a fake host (no DOM): what it registers, what its
// buttons start, and the pure logic its panel reads controls with.
import test from "node:test";
import assert from "node:assert/strict";
import register, { startFixupFlow, rebuildFlow, handleBlockClick, hideStreamingComment } from "../localchar/browser.mjs";
import { fudgeFromControls, configFormFromControls, configFromForm } from "../localchar/panel-logic.mjs";
import { actions as serverActions } from "../localchar/server.mjs";
import { BLOCK_MARK } from "../src/model/block.js";

function fakeHost({ settings = {}, jobs = [] } = {}) {
    const log = { actions: [], jobs: [], notices: [], panels: [], reloads: 0, menu: [], filters: [], hooks: [], pages: [], offs: [] };
    const off = name => () => log.offs.push(name);
    const queue = [...jobs];
    const host = {
        version: "0.6.0",
        onMessageRendered(fn) { log.hooks.push(fn); return off("hook"); },
        streamingFilter(fn) { log.filters.push(fn); return off("filter"); },
        addChatMenuItem(label, fn) { log.menu.push({ label, fn }); return off("menu"); },
        settingsPanel(render) { log.pages.push(render); return off("settings-page"); },
        openPanel(panel) { log.panels.push(panel); },
        notify(kind, text, title, options) { log.notices.push({ kind, text, title, options }); },
        async callAction(name, args) { log.actions.push([name, args]); return name === "popup_view" ? { history: [], chat_data: {}, chat_data_revision: 0, settings: {}, user_name: "Jan" } : { ok: true }; },
        async startJob(kind, args) { log.jobs.push([kind, args]); return "job_1"; },
        async getJob() { return queue.shift() ?? { status: "done", result: { outcome: "applied" }, notices: [] }; },
        chat: {
            branchId: () => "br_1",
            messages: () => [],
            chatData: () => null,
            async refreshChatData() { return { data: {}, revision: 0 }; },
            async reload() { log.reloads += 1; },
        },
        settings: { async get() { return settings; }, async set(values) { log.settingsSaved = values; return values; } },
    };
    return { host, log };
}

const message = { id: "msg_9", revision: "r", content: `Prose.\n\n${BLOCK_MARK}`, isUser: false, isSystem: false, depth: 0 };

test("register wires all hooks and dispose removes them", async () => {
    const { host, log } = fakeHost();
    const dispose = register(host);
    assert.equal(typeof dispose, "function");
    assert.equal(log.hooks.length, 1);
    assert.equal(log.filters.length, 1);
    assert.deepEqual(log.menu.map(m => m.label), ["Story Ledger"]);
    assert.equal(log.pages.length, 1);
    dispose();
    assert.deepEqual([...new Set(log.offs)].sort(), ["filter", "hook", "menu", "settings-page"]);
});

test("the menu item opens the panel", async () => {
    const { host, log } = fakeHost();
    register(host);
    log.menu[0].fn();
    assert.equal(log.panels.length, 1);
    assert.equal(log.panels[0].title, "📒 Story Ledger");
    assert.equal(typeof log.panels[0].render, "function");
});

test("hideStreamingComment cuts from the ledger comment, and from a half-written opener", () => {
    assert.equal(hideStreamingComment("The door opened."), "The door opened.");
    assert.equal(hideStreamingComment("The door opened.\n<!-- Story_Ledger\nNow: Day 1"), "The door opened.");
    assert.equal(hideStreamingComment("The door opened.\n<!-- Story_Led"), "The door opened.");
    assert.equal(hideStreamingComment("The door opened.\n<!-"), "The door opened.");
    assert.equal(hideStreamingComment("She said <b>hello</b> and a <"), "She said <b>hello</b> and a <".replace(/ <$/, ""));
    assert.equal(hideStreamingComment("2 < 3 is true."), "2 < 3 is true.");
});

test("hideStreamingComment keeps a continuation after a finished ledger comment and hides only the comment", () => {
    // A continue streams the old reply (its comment already closed) plus the new text.
    const old = "The door opened.\n<!-- Story_Ledger\nNow: Day 1\n-->";
    assert.equal(hideStreamingComment(`${old}\nShe stepped in.`), "The door opened.\nShe stepped in.");
    assert.equal(hideStreamingComment(`${old}\nShe stepped in.\n<!-- Story_Ledger\nNow: Day`), "The door opened.\nShe stepped in.");
});

const flowArgs = (host, settings, extra = {}) => ({
    host, settings, message, kase: "missing", confirm: async () => true, pollMs: 0, refresh() {}, ...extra,
});

test("✎ starts the job kind matching fixupMode", async () => {
    for (const [mode, kind] of [["full", "continue_then_action"], ["lean", "raw_then_action"]]) {
        const { host, log } = fakeHost();
        await startFixupFlow(flowArgs(host, { fixupMode: mode }));
        const [[started, args]] = log.jobs;
        assert.equal(started, kind, mode);
        assert.equal(args.message_id, "msg_9");
        assert.equal(args.accept_action, "accept_fixup");
        assert.deepEqual(args.fixup, { kase: "missing", mode });
        if (mode === "lean") assert.equal(args.prompt_action, "lean_prompt"); else assert.equal(args.prompt_action, undefined);
    }
});

test("✎ asks first, and declining starts nothing", async () => {
    const { host, log } = fakeHost();
    let asked = null;
    await startFixupFlow(flowArgs(host, { fixupMode: "full" }, { confirm: async (title, body) => { asked = [title, body]; return false; } }));
    assert.deepEqual(log.jobs, []);
    assert.equal(asked[0], "Write the missing ledger part?");
    assert.match(asked[1], /no ledger comment; one will be written/);
    assert.match(asked[1], /Full: normal prompt/);
});

test("✎ for missing Thoughts says so", async () => {
    const { host } = fakeHost();
    let body = "";
    await startFixupFlow(flowArgs(host, { fixupMode: "lean" }, { kase: "thoughts", confirm: async (_t, b) => { body = b; return false; } }));
    assert.match(body, /has no Thoughts; they will be added/);
    assert.match(body, /Lean: short prompt/);
});

test("a fix-up that was applied reloads the chat; one that kept nothing says the reply changed", async () => {
    let { host, log } = fakeHost({ jobs: [{ status: "running" }, { status: "done", result: { outcome: "applied", result: { accepted: true } }, notices: [{ kind: "success", title: "t", text: "fixed", sticky: false }] }] });
    await startFixupFlow(flowArgs(host, { fixupMode: "full" }));
    assert.equal(log.reloads, 1);
    assert.deepEqual(log.notices.map(n => n.text), ["fixed"]);

    ({ host, log } = fakeHost({ jobs: [{ status: "done", result: { outcome: "kept_nothing" }, notices: [] }] }));
    await startFixupFlow(flowArgs(host, { fixupMode: "full" }));
    assert.equal(log.reloads, 0);
    assert.deepEqual(log.notices.map(n => [n.kind, n.text]), [["warning", "The reply changed during the ledger fix-up; it was left as it is."]]);
});

test("a failed fix-up job is reported and leaves the chat alone", async () => {
    const { host, log } = fakeHost({ jobs: [{ status: "failed", result: { error: "provider exploded" }, notices: [] }] });
    await startFixupFlow(flowArgs(host, { fixupMode: "lean" }));
    assert.equal(log.reloads, 0);
    assert.match(log.notices[0].text, /provider exploded/);
    assert.equal(log.notices[0].kind, "error");
});

test("the fix-up marks itself busy for the redraw while it runs", async () => {
    const { host } = fakeHost({ jobs: [{ status: "running" }, { status: "done", result: { outcome: "unchanged" }, notices: [] }] });
    const states = [];
    await startFixupFlow(flowArgs(host, { fixupMode: "full" }, { refresh: busy => states.push(busy) }));
    assert.deepEqual(states, [true, false]);
});

test("↻ confirms, rebuilds through the action, and reloads the chat", async () => {
    const { host, log } = fakeHost();
    await rebuildFlow({ host, message, confirm: async () => true });
    assert.deepEqual(log.actions, [["rebuild", { message_id: "msg_9" }]]);
    assert.equal(log.reloads, 1);
    const none = fakeHost();
    await rebuildFlow({ host: none.host, message, confirm: async () => false });
    assert.deepEqual(none.log.actions, []);
});

const target = cls => ({ closest: selector => (selector.includes(cls) ? {} : null) });
const fakeEvent = cls => ({ target: target(cls), prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });

test("clicks on the block's buttons are routed and kept from toggling the fold", async () => {
    const calls = [];
    const handlers = { rebuild: () => calls.push("rebuild"), fixup: () => calls.push("fixup"), nextTurn: () => calls.push("next") };
    for (const [cls, name] of [["sl-rebuild", "rebuild"], ["sl-fixup", "fixup"], ["sl-next-turn", "next"]]) {
        const event = fakeEvent(cls);
        assert.equal(handleBlockClick(event, handlers), true);
        assert.equal(event.prevented && event.stopped, true);
        assert.equal(calls.at(-1), name);
    }
    assert.equal(handleBlockClick({ target: { closest: () => null } }, handlers), false);
});

test("fudgeFromControls reads the Next-turn controls like ST's panel did", () => {
    const fudge = fudgeFromControls({
        dice: { "fate.a": { locked: true, value: "20" }, "fate.b": { locked: false, value: "4" }, world: { locked: true, value: "99" } },
        checks: { locked: true, values: ["20", "3", "11"] }, tier: "MAJOR", source: "", calm: false, fire: "B2",
    });
    assert.deepEqual(fudge, { appliedTo: null, dice: { "fate.a": 20, checks: [20, 3, 11] }, tier: "MAJOR", fire: "B2" });
    assert.deepEqual(fudgeFromControls({ dice: {}, checks: { locked: true, values: ["1", "2", "x"] }, calm: true }), { appliedTo: null, calm: true });
});

test("engine numbers are computed in the browser, so the Settings page saves them with no chat open", async () => {
    // Settings -> Extensions can be opened with no chat (no branch to run an action against); the
    // form is turned into settings.config by the same pure function the server action uses.
    const form = { cfg: { tickCap: "5" }, chekhov: { firing: "fate", cap: "3" }, fate: { worldKeep: "4" } };
    const local = configFromForm({}, form);
    assert.equal(local.tickCap, 5);
    assert.equal(local.sectionConfig.chekhov.firing, "fate");
    const viaAction = await serverActions.save_config({ args: { form }, snapshot: { history: [], chat_data: {}, chat_data_revision: 0, settings: {}, user_name: "", char_name: "" } });
    assert.deepEqual(local, viaAction.result.config);
});

test("configFormFromControls gathers the engine numbers form", () => {
    const form = configFormFromControls({
        cfg: [["tickCap", "5"]], gate: [["E", "9"]], phi: [["period", "3"]], axes: [["E", "period", "4"], ["E", "threshold", "7"]],
        decay: [["0", "12"]], skip: "1, 2", chekhov: [["cap", "3"]], firing: "fate", fate: [["worldKeep", "4"]],
    });
    assert.deepEqual(form.cfg, { tickCap: "5" });
    assert.deepEqual(form.gate, { E: "9" });
    assert.deepEqual(form.axes, { E: { period: "4", threshold: "7" } });
    assert.deepEqual(form.decay, { 0: "12" });
    assert.equal(form.skip, "1, 2");
    assert.deepEqual(form.chekhov, { cap: "3", firing: "fate" });
    assert.deepEqual(form.fate, { worldKeep: "4" });
});

test("configFromForm sanitises title caps", () => {
    const c = configFromForm(undefined, { titles: { softCap: "4", hardCap: "2" } });
    assert.deepEqual(c.sectionConfig.titles, { softCap: 2, hardCap: 2, situationalMax: 2, retrofitBatch: 10 });
});

test("configFormFromControls carries the title caps", () => {
    assert.deepEqual(configFormFromControls({ titles: [["softCap", "4"]] }).titles, { softCap: "4" });
});

// A body the ledger page can mount into without a DOM: it records what is drawn and lets a test fire
// the change events the page listens for.
function fakeBody() {
    const listeners = {};
    return {
        textContent: "", innerHTML: "",
        addEventListener(type, fn) { listeners[type] = fn; },
        removeEventListener(type) { delete listeners[type]; },
        querySelector: () => null,
        fire: (type, event) => listeners[type]?.(event),
    };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const setControl = (key, value) => ({ target: { type: "text", value, dataset: { set: key }, matches: sel => sel === "[data-set]" } });

test("the Settings page waits for the stored settings, so a change after an update keeps the rest", async () => {
    // An update reloads the extension: the page can be mounted before the stored settings arrive.
    let release;
    const stored = { theme: "parchment", checkStyle: "dnd", depth: 7 };
    const { host, log } = fakeHost();
    host.settings.get = () => new Promise(resolve => { release = () => resolve(stored); });
    register(host);
    const body = fakeBody();
    log.pages[0](body);
    await settle();
    assert.equal(body.innerHTML, "", "nothing is drawn from defaults");
    release();
    await settle();
    assert.notEqual(body.innerHTML, "", "the page is drawn once the stored settings are in");
    await body.fire("change", setControl("fixupMode", "lean"));
    assert.equal(log.settingsSaved.theme, "parchment");
    assert.equal(log.settingsSaved.checkStyle, "dnd");
    assert.equal(log.settingsSaved.depth, 7);
    assert.equal(log.settingsSaved.fixupMode, "lean");
});

test("settings that could not be read are never saved over", async () => {
    const { host, log } = fakeHost();
    host.settings.get = async () => { throw new Error("offline"); };
    register(host);
    const body = fakeBody();
    log.pages[0](body);
    await settle();
    assert.match(body.textContent, /could not be loaded/);
    await assert.rejects(body.fire("change", setControl("fixupMode", "lean")));
    assert.equal(log.settingsSaved, undefined);
});
