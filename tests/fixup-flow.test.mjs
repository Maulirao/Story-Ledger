// The ledger fix-up run in index.js, with SillyTavern stubbed at its public boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { writeBlockInto, stripBlocks } from "../src/model/turn.js";

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
