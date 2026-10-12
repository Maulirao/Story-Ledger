// Drives index.js through a synthetic 6-turn chat with SillyTavern stubbed at its public
// boundary, and returns what it produced. The recorder (record-host-goldens.mjs) saves that
// as tests/fixtures/host-core-goldens.json; host-core.test.mjs holds the extracted core to it.
// Everything here is invented text.
import { FF_FULL } from "../fixtures/foreign.mjs";

export const DICE_LOCKS = { "fate.a": 11, "fate.b": 4, "fate.c": 17, world: 9, checks: [14, 6, 19] };

const REL = "NEW Mara → Jan: E 8, M 3, L 6, Er 3, Ph 9, Ec 3, Pr 5, St 3, Sg 4, Ad 3, Ag 6, Pt 3 | Φ 4 (first meeting)";

export const COMMENTS = [
    `<!-- Story_Ledger\nNow: Day 1 — Monday, 09:00 | the kitchen\nPresent: Mara\nThreads:\n- + [T] Ask about the letter.\nRelationships:\n- ${REL}\nThoughts:\n- Mara: keep smiling.\n-->`,
    "<!-- Story_Ledger\nNow: Day 1 — Monday, 11:30 | the garden\nPresent: Mara\nThreads:\n- + [T] Fix the gate.\nThoughts:\n- Mara: he noticed.\n-->",
    "<!-- Story_Ledger\nNow: Day 2 — Tuesday, 08:10 | the road\nPresent: Mara\nProposed rules:\n- add: Keep chapters short.\nThoughts:\n- Mara: say nothing.\n-->",
];

export const PROSE = ["She poured the tea.", "They walked out to the garden.", "The road was empty at that hour."];

/** A harness: stubs, the loaded extension, and recorders. */
export async function harness(tag) {
    const saved = Object.fromEntries(["SillyTavern", "jQuery", "$", "document", "toastr", "storyLedgerInterceptor"].map(k => [k, globalThis[k]]));
    const prompts = new Map(), toasts = [], handlers = {}, macros = {};
    const chatMetadata = {};
    const context = {
        extensionSettings: { storyLedger: { sections: {} } }, chat: [], chatMetadata, name1: "Jan",
        eventTypes: { MESSAGE_RECEIVED: "message_received", GENERATION_STOPPED: "generation_stopped", CHAT_CHANGED: "chat_changed" },
        eventSource: {
            on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
            async emit(ev, ...a) { for (const fn of handlers[ev] || []) await fn(...a); },
        },
        registerMacro(name, fn) { macros[name] = fn; },
        substituteParams: text => text.replaceAll("{{user}}", "Jan"),
        setExtensionPrompt(key, ...args) { prompts.set(key, args); },
        saveMetadata: async () => {}, saveSettingsDebounced() {}, saveChat: async () => {}, updateMessageBlock() {},
        getCurrentChatId: () => "chat-1",
        Popup: { show: { confirm: async () => true } },
    };
    globalThis.SillyTavern = { getContext: () => context };
    globalThis.document = { querySelectorAll: () => [], querySelector: () => null };
    globalThis.$ = () => ({ length: 1, on() {}, append() {} });
    globalThis.jQuery = callback => callback();
    globalThis.toastr = new Proxy({}, { get: (_, kind) => (message, title) => { toasts.push({ kind, title, message }); } });
    const extension = await import(`../../index.js?${tag}`);
    const interceptor = globalThis.storyLedgerInterceptor;
    return {
        context, prompts, toasts, macros, chatMetadata, extension, interceptor,
        restore() { for (const [key, value] of Object.entries(saved)) value === undefined ? delete globalThis[key] : globalThis[key] = value; },
        reset() { toasts.length = 0; prompts.clear(); for (const k of Object.keys(chatMetadata)) delete chatMetadata[k]; },
        lock() { chatMetadata.storyLedger = { ...(chatMetadata.storyLedger || {}), fudges: { dice: JSON.parse(JSON.stringify(DICE_LOCKS)), appliedTo: null } }; },
    };
}

const user = text => ({ is_user: true, name: "Jan", mes: text });
const char = text => ({ is_user: false, name: "Mara", mes: text, swipes: [text], swipe_id: 0 });

/** Three user/reply pairs; every reply goes through the interceptor and MESSAGE_RECEIVED like a real turn. */
export async function playSixTurns(h, { withComments = true } = {}) {
    const { context, interceptor } = h;
    const record = { injections: [], blocks: [], toasts: [] };
    context.chat = [];
    for (let turn = 0; turn < 3; turn++) {
        context.chat.push(user(`Turn ${turn + 1}: what happens next?`));
        h.lock();
        await interceptor([], 1000, null, "normal");
        record.injections.push({ turn, prompt: h.prompts.get("story_ledger"), reminder: h.prompts.get("story_ledger_reminder") });
        const reply = char(`${PROSE[turn]}${withComments ? `\n${COMMENTS[turn]}` : ""}`);
        context.chat.push(reply);
        const before = h.toasts.length;
        await context.eventSource.emit("message_received", context.chat.length - 1, "normal");
        record.blocks.push(context.chat[context.chat.length - 1].mes);
        record.toasts.push(h.toasts.slice(before));
    }
    record.chatData = JSON.parse(JSON.stringify(h.chatMetadata.storyLedger ?? null));
    return record;
}

export { FF_FULL };

/** Make index.js's dice deterministic while recording: every unlocked roll is the rng's 0.5 (an 11). */
export function fixRandom() {
    Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: { getRandomValues: array => { array.fill(0x80000000); return array; } },
    });
}
