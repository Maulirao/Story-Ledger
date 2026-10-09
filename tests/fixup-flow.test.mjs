// The ledger fix-up run in index.js, with SillyTavern stubbed at its public boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { writeBlockInto, stripBlocks } from "../src/model/turn.js";
import { renderTurnFacts } from "../src/model/prompt.js";
import { resolveConfig } from "../src/model/config.js";
import { emptyState } from "../src/model/state.js";

const REMINDER_KEY = "story_ledger_reminder";
const ALWAYS = "The reply above is finished. Do not continue the story and do not repeat or change any of its prose.";
const COMMENT = "<!-- Story_Ledger\nThoughts:\n- Mara: hi\n-->";
const STATE_BLOCK = "<!-- GFX_START --><!-- story-ledger-state v1 --><internal_states><details><summary>🎲 WORLD SIM</summary>\n- <b>Roll:</b> 7\n</details></internal_states><!-- GFX_END -->";

const saved = Object.fromEntries(["SillyTavern", "jQuery", "$", "document", "toastr", "storyLedgerInterceptor"].map(k => [k, globalThis[k]]));
const prompts = new Map(), toasts = [], handlers = {}, commands = [];
let script = async () => {};
const chatMetadata = {};
const original = writeBlockInto("The first prose.", STATE_BLOCK);
const context = {
    extensionSettings: { storyLedger: { sections: {} } }, chat: [], chatMetadata, name1: "Jan",
    eventTypes: { MESSAGE_RECEIVED: "message_received", GENERATION_STOPPED: "generation_stopped", CHAT_CHANGED: "chat_changed" },
    eventSource: {
        on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
        async emit(ev, ...a) { for (const fn of handlers[ev] || []) await fn(...a); },
    },
    registerMacro() {},
    substituteParams: text => text.replaceAll("{{user}}", "Jan"),
    setExtensionPrompt(key, ...args) { prompts.set(key, args); },
    saveMetadata: async () => {}, saveSettingsDebounced() {}, saveChat: async () => {}, updateMessageBlock() {},
    getCurrentChatId: () => context.chatId, chatId: "chat-1",
    Popup: { show: { confirm: async () => true } },
    async executeSlashCommandsWithOptions(command) { commands.push(command); return script(command); },
};
globalThis.SillyTavern = { getContext: () => context };
globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
globalThis.$ = () => ({ length: 1, on() {}, append() {} });
globalThis.jQuery = callback => callback();
globalThis.toastr = new Proxy({}, { get: (_, kind) => (message, title) => { toasts.push({ kind, message, title }); } });
const extension = await import("../index.js?fixup-flow");
const interceptor = globalThis.storyLedgerInterceptor;
test.after(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));   // the extension redraws on a timer after some events
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete globalThis[key] : globalThis[key] = value;
});

function seed() {
    context.chatId = "chat-1";
    context.chat = [
        { is_user: true, name: "Jan", mes: "Hello." },
        { is_user: false, name: "Mara", mes: original, swipes: [original], swipe_id: 0 },
    ];
    toasts.length = 0; commands.length = 0; prompts.clear();
    for (const k of Object.keys(chatMetadata)) delete chatMetadata[k];
    return context.chat[1];
}
const append = (msg, text) => { msg.mes += text; };
const kept = text => toasts.filter(t => t.message.includes(text));

test("full: the run is live through generation and finalizes after the command resolves", async () => {
    const msg = seed();
    script = async command => {
        assert.equal(command, "/continue await=true");
        await interceptor([], 1000, null, "continue");
        assert.ok(prompts.get(REMINDER_KEY)[0].includes(ALWAYS), "the interceptor wrote the ledger-mode reminder");
        append(msg, "\nMore prose.\n" + COMMENT);
        await context.eventSource.emit("message_received", 1, "continue");
        assert.ok(msg.mes.includes("More prose."), "the late event did not rebuild the reply while the run was live");
    };
    await extension.startFixup(1);
    assert.equal(stripBlocks(msg.mes).trim(), "The first prose.\n\n" + COMMENT);
    assert.ok(!msg.mes.includes("More prose."));
    assert.match(msg.mes, /INTERNAL THOUGHTS[\s\S]*Mara<\/b> \| hi/);
});

test("stop: late MESSAGE_RECEIVED is ignored and the reply restored", async () => {
    const msg = seed();
    script = async () => {
        await interceptor([], 1000, null, "continue");
        append(msg, "\nMore prose.");
        await context.eventSource.emit("generation_stopped");
        await context.eventSource.emit("message_received", 1, "continue");
    };
    await extension.startFixup(1);
    assert.equal(msg.mes, original);
    assert.equal(msg.swipes[0], original);
    assert.equal(kept("Ledger fix-up kept nothing: stopped.").length, 1);
    assert.equal(toasts.length, 1);
});

test("guards: an edit, a swipe or a chat change leaves the reply alone", async () => {
    for (const [name, change, toast] of [
        ["edit", msg => { msg.mes = "edited"; }, true],
        ["swipe", msg => { msg.swipe_id = 1; }, true],
        ["chat change", async () => { context.chatId = "chat-2"; await context.eventSource.emit("chat_changed"); }, false],
    ]) {
        const msg = seed();
        script = async () => {
            await interceptor([], 1000, null, "continue");
            append(msg, "\n" + COMMENT);
            await change(msg);
        };
        await extension.startFixup(1);
        const expected = name === "edit" ? "edited" : original + "\n" + COMMENT;
        assert.equal(msg.mes, expected, name);
        assert.equal(kept("The reply changed during the ledger fix-up; it was left as it is.").length, toast ? 1 : 0, name);
        assert.equal(toasts.length, toast ? 1 : 0, name);
    }
});

test("armed fudges are untouched", async () => {
    const msg = seed();
    const fudges = { dice: { world: 20 }, appliedTo: null };
    chatMetadata.storyLedger = { fudges: JSON.parse(JSON.stringify(fudges)) };
    let fixupPrompt = "";
    script = async () => {
        await interceptor([], 1000, null, "continue");
        fixupPrompt = prompts.get("story_ledger")[0];
        append(msg, "\n" + COMMENT);
        await context.eventSource.emit("message_received", 1, "continue");
    };
    await extension.startFixup(1);
    assert.ok(!fixupPrompt.includes("World Sim: CALM"), "the fix-up's prompt uses the reply's own roll, not the armed lock");
    assert.deepEqual(chatMetadata.storyLedger.fudges, fudges);
    assert.match(msg.mes, /<b>Roll:<\/b> 7(?!\d)/, "the reply keeps the roll its block showed");
    await interceptor([], 1000, null, "normal");
    assert.ok(prompts.get("story_ledger")[0].includes("World Sim: CALM"), "the armed world lock still applies to the next reply");
    assert.deepEqual(chatMetadata.storyLedger.fudges.dice, { world: 20 });
});

test("thoughts case keeps the comment's other changes", async () => {
    const withComment = writeBlockInto("The first prose.\n\n<!-- Story_Ledger\nInventory:\n- + rope\n-->", STATE_BLOCK);
    const msg = seed();
    msg.mes = withComment; msg.swipes = [withComment];
    script = async () => {
        await interceptor([], 1000, null, "continue");
        append(msg, "\n" + COMMENT);
        await context.eventSource.emit("message_received", 1, "continue");
    };
    await extension.startFixup(1);
    const comments = msg.mes.match(/<!--\s*Story_Ledger/g) || [];
    assert.equal(comments.length, 1);
    assert.match(msg.mes, /rope/);
    assert.match(msg.mes, /Mara<\/b> \| hi/);
    assert.ok(stripBlocks(msg.mes).includes("Inventory:\n- + rope\n\nThoughts:\n- Mara: hi\n-->"));
});

test("a rejected continue clears the run and leaves the reply", async () => {
    const msg = seed();
    script = async () => { throw new Error("busy"); };
    await extension.startFixup(1);
    assert.equal(msg.mes, original);
    assert.equal(kept("Ledger fix-up kept nothing: busy.").length, 1);
    commands.length = 0;
    await extension.startFixup(1);
    assert.deepEqual(commands, ["/continue await=true"], "the run was cleared, so a second start runs");
});

test("success and restore keep the current swipe in step", async () => {
    const msg = seed();
    script = async () => {
        await interceptor([], 1000, null, "continue");
        append(msg, "\n" + COMMENT);
        await context.eventSource.emit("message_received", 1, "continue");
    };
    await extension.startFixup(1);
    assert.equal(msg.swipes[msg.swipe_id], msg.mes);
    const again = seed();
    script = async () => { append(again, "\nprose only"); };
    await extension.startFixup(1);
    assert.equal(again.mes, original);
    assert.equal(again.swipes[again.swipe_id], again.mes);
});

test("a reply that needs nothing, an earlier reply or a running fix-up do not start", async () => {
    const msg = seed();
    const done = writeBlockInto("p\n" + COMMENT, STATE_BLOCK);
    msg.mes = done; msg.swipes = [done];
    await extension.startFixup(1);
    assert.deepEqual(commands, []);
    seed();
    await extension.startFixup(0);
    assert.deepEqual(commands, []);
});

// ── Lean mode ───────────────────────────────────────────────────────────────

const lean = (history = 4) => Object.assign(context.extensionSettings.storyLedger, { fixupMode: "lean", fixupHistory: history });
const full = () => Object.assign(context.extensionSettings.storyLedger, { fixupMode: "full", fixupHistory: 4 });

function seedLong() {
    const msg = seed();
    context.chat.unshift(
        { is_user: true, name: "Jan", mes: "Opening." },
        { is_user: false, name: "Mara", mes: "Earlier answer.\n\n<!-- Story_Ledger\nNow: Day 1\n-->\n\n" + STATE_BLOCK },
        { is_user: true, name: "Jan", mes: "Next." },
        { is_system: true, name: "System", mes: "hidden note" },
    );
    context.chat.splice(5, 0, { is_user: true, name: "Jan", mes: "   " });
    return msg;
}

test("lean: prompt holds turn facts from the state before the reply", async () => {
    const msg = seedLong();
    Object.assign(context, {
        extensionPrompts: { "1_memory": { value: "SUMMARY TEXT" } },
        chatCompletionSettings: { prompts: [{ identifier: "main", content: "MAIN for {{user}}" }] },
        characters: [{ name: "Mara", description: "A baker.", personality: "Warm." }], characterId: 0,
    });
    lean(3);
    let sent;
    context.generateRaw = async request => { sent = request; return "Sure!\n" + COMMENT; };
    await extension.startFixup(context.chat.length - 1);
    assert.deepEqual(commands, [], "lean never runs a continue");
    assert.ok(Array.isArray(sent.prompt));
    assert.deepEqual(sent.prompt.map(m => m.role), ["system", "system", "system", "system", "assistant", "user", "user", "assistant", "user"]);
    assert.equal(sent.prompt[0].content.startsWith("MAIN for Jan"), true);
    assert.ok(sent.prompt[1].content.includes("A baker.") && sent.prompt[1].content.includes("User persona: Jan"));
    assert.ok(sent.prompt[2].content.includes("SUMMARY TEXT"));
    const ledger = sent.prompt[3].content;
    assert.ok(ledger.startsWith("<story_ledger>"));
    const rolled = { ...resolveConfig(), userName: "Jan", sections: { scene: true }, dice: { world: 7 }, fudges: null, fudgedDice: [], rolls: [] };
    const facts = renderTurnFacts(emptyState(), rolled);
    assert.ok(facts && ledger.includes("World Sim"), "the reply's saved roll is in the turn facts");
    const history = sent.prompt.slice(4, -2);
    assert.equal(history.length, 3, "Recent messages = 3");
    assert.deepEqual(history.map(m => m.content), ["Mara: Earlier answer.", "Jan: Next.", "Jan: Hello."]);
    assert.equal(sent.prompt.at(-2).role, "assistant");
    assert.ok(sent.prompt.at(-2).content.startsWith("Mara: The first prose."));
    assert.equal(sent.prompt.at(-1).role, "user");
    assert.ok(sent.prompt.at(-1).content.includes(ALWAYS));
    assert.equal(stripBlocks(msg.mes).trim(), "The first prose.\n\n" + COMMENT, "the success path wrote the comment");
});

test("lean: success writes the comment; failure changes nothing", async () => {
    lean();
    const msg = seed();
    context.generateRaw = async () => "no comment here";
    await extension.startFixup(1);
    assert.equal(msg.mes, original);
    assert.equal(kept("Ledger fix-up kept nothing: no ledger comment.").length, 1);

    toasts.length = 0;
    context.generateRaw = async () => { throw new Error("API down"); };
    await extension.startFixup(1);
    assert.equal(msg.mes, original);
    assert.equal(kept("Ledger fix-up kept nothing: API down.").length, 1);

    toasts.length = 0;
    context.generateRaw = async () => "Here:\n```html\n" + COMMENT + "\n```";
    await extension.startFixup(1);
    assert.equal(stripBlocks(msg.mes).trim(), "The first prose.\n\n" + COMMENT);
    assert.equal(msg.swipes[msg.swipe_id], msg.mes);
    assert.equal(toasts.length, 0);
});

test("lean: the reply changing during generateRaw discards the output", async () => {
    lean();
    const msg = seed();
    context.generateRaw = async () => { msg.mes = "edited meanwhile"; return COMMENT; };
    await extension.startFixup(1);
    assert.equal(msg.mes, "edited meanwhile");
    assert.equal(kept("The reply changed during the ledger fix-up; it was left as it is.").length, 1);
});

test("settings: the fixup controls round-trip", async () => {
    const savedPopup = context.Popup, savedDollar = globalThis.$;
    const shown = [];
    let change;
    context.Popup = class { static show = { confirm: async () => true }; dlg = {}; async show() {} };
    context.POPUP_TYPE = { TEXT: 1 };
    globalThis.$ = () => ({
        length: 1, find: () => ({ toggle: visible => shown.push(visible) }),
        on(_event, selector, callback) { if (selector === "[data-set]") change = callback; },
    });
    try {
        await extension.openLedgerPopup("settings");
        change({ currentTarget: { dataset: { set: "fixupHistory" }, type: "number", value: "7" } });
        assert.strictEqual(context.extensionSettings.storyLedger.fixupHistory, 7);
        change({ currentTarget: { dataset: { set: "fixupMode" }, type: "select-one", value: "lean" } });
        assert.equal(context.extensionSettings.storyLedger.fixupMode, "lean");
        change({ currentTarget: { dataset: { set: "fixupMode" }, type: "select-one", value: "full" } });
        assert.deepEqual(shown, [true, false], "Recent messages is shown only for Lean");
    } finally { context.Popup = savedPopup; globalThis.$ = savedDollar; full(); }
});

// ── The ✎ button ────────────────────────────────────────────────────────────

test("decorate passes the fix-up case only for the last reply when idle", async () => {
    full();
    const msg = seed();
    assert.equal(extension.fixupCaseFor(1), "missing");
    assert.equal(extension.fixupCaseFor(0), null, "not an assistant reply");
    context.chat.push({ is_user: true, name: "Jan", mes: "Next." });
    assert.equal(extension.fixupCaseFor(1), null, "not the last message");
    context.chat.pop();
    const withComment = writeBlockInto("p\n<!-- Story_Ledger\nNow: Day 1\n-->", STATE_BLOCK);
    msg.mes = withComment;
    assert.equal(extension.fixupCaseFor(1), "thoughts");
    msg.mes = original;
    let during;
    script = async () => { during = extension.fixupCaseFor(1); };
    await extension.startFixup(1);
    assert.equal(during, null, "hidden while a fix-up is running");
    assert.equal(extension.fixupCaseFor(1), "missing", "back after it ends");
    context.extensionSettings.storyLedger.enabled = false;
    assert.equal(extension.fixupCaseFor(1), null, "off when the extension is off");
    context.extensionSettings.storyLedger.enabled = true;
});

test("the theme draws ✎ with the case's title and drops it when nothing is needed", async () => {
    const { syncFixupButton } = await import("../src/ui/themes/frankenstein.js");
    const head = {
        spans: [],
        querySelector(sel) { return sel === ".sl-fixup" ? this.spans.find(s => s.className.includes("sl-fixup")) || null : null; },
        insertAdjacentHTML(_where, html) {
            const span = { className: html.match(/class="([^"]+)"/)[1], title: html.match(/title="([^"]+)"/)[1], text: html.match(/>([^<]+)</)[1], remove: () => head.spans.splice(head.spans.indexOf(span), 1) };
            this.spans.push(span);
        },
    };
    const outer = { querySelector: () => head };
    syncFixupButton(outer, "missing");
    assert.deepEqual(head.spans.map(s => [s.text, s.title]), [["✎", "Write the missing ledger comment"]]);
    syncFixupButton(outer, "missing");
    assert.equal(head.spans.length, 1, "not drawn twice");
    syncFixupButton(outer, "thoughts");
    assert.equal(head.spans[0].title, "Add the missing Thoughts");
    syncFixupButton(outer, null);
    assert.equal(head.spans.length, 0);
});

// ── Found in the final review ───────────────────────────────────────────────

test("a rebuild that fails after the splice puts the reply back", async () => {
    full();
    const msg = seed();
    const update = context.updateMessageBlock;
    let calls = 0;
    context.updateMessageBlock = () => { if (++calls === 1) throw new Error("render failed"); };
    const logError = console.error;
    console.error = () => {};
    script = async () => {
        await interceptor([], 1000, null, "continue");
        append(msg, "\n" + COMMENT);
    };
    try { await extension.startFixup(1); }
    finally { context.updateMessageBlock = update; console.error = logError; }
    assert.equal(msg.mes, original);
    assert.equal(msg.swipes[0], original);
    assert.equal(kept("Ledger fix-up kept nothing: render failed.").length, 1);
});

test("a reply that gets its comment while the confirm popup is open is left alone", async () => {
    full();
    const msg = seed();
    const done = writeBlockInto("p\n" + COMMENT, STATE_BLOCK);
    const confirm = context.Popup.show.confirm;
    context.Popup.show.confirm = async () => { msg.mes = done; return true; };
    try { await extension.startFixup(1); }
    finally { context.Popup.show.confirm = confirm; }
    assert.deepEqual(commands, []);
    assert.equal(msg.mes, done);
});
