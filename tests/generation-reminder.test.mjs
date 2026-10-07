import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { stripPromptText } from "../src/model/prompt.js";

const REMINDER_KEY = "story_ledger_reminder";

// Only the public ST boundary is replaced: the interceptor builds the real prompt
// from real state, configuration, command templates and dice logic.
test("generation placement keeps one reminder and clears it for excluded generations", async t => {
    const saved = Object.fromEntries(["SillyTavern", "jQuery", "$", "document", "storyLedgerInterceptor"].map(k => [k, globalThis[k]]));
    const prompts = new Map(), macros = new Map();
    const context = {
        extensionSettings: { storyLedger: { sections: {} } }, chat: [], chatMetadata: {}, name1: "Jan",
        eventTypes: {}, eventSource: { on() {} },
        registerMacro(name, callback) { macros.set(name, callback); },
        substituteParams(text) { return text.replaceAll("{{user}}", "Jan"); },
        setExtensionPrompt(key, ...args) { prompts.set(key, args); },
        saveMetadata: async () => {}, saveSettingsDebounced() {}, getCurrentChatId: () => "test-chat",
    };
    globalThis.SillyTavern = { getContext: () => context };
    globalThis.document = { querySelectorAll: () => [] };
    globalThis.$ = () => ({ length: 1, on() {} });
    globalThis.jQuery = callback => callback();
    t.after(() => { for (const [key, value] of Object.entries(saved)) value === undefined ? delete globalThis[key] : globalThis[key] = value; });
    const extension = await import("../index.js");
    const generate = type => globalThis.storyLedgerInterceptor([], 1000, null, type);

    for (const type of ["normal", "swipe", "continue"]) {
        await generate(type);
        const args = prompts.get(REMINDER_KEY);
        assert.ok(args?.[0], `${type} gets a reminder`);
        assert.deepEqual(args.slice(1), [1, 0, false, 0], "reminder uses IN_CHAT, depth 0, system role");
        assert.doesNotMatch(prompts.get("story_ledger")[0], /<ledger_generation_reminder>/, "the full auto prompt does not duplicate it");
    }
    for (const type of ["quiet", "impersonate", "first_message"]) {
        await generate(type);
        assert.equal(prompts.get(REMINDER_KEY)[0], "");
        assert.equal(prompts.get("story_ledger")[0], "");
        assert.equal(macros.get("story_ledger")(), "", "macro fallback also respects excluded generation type");
    }

    context.extensionSettings.storyLedger.placement = "macro";
    await generate("normal");
    assert.equal(prompts.get(REMINDER_KEY)[0], "");
    assert.equal(prompts.get("story_ledger")[0], "");
    assert.match(macros.get("story_ledger")(), /<ledger_generation_reminder>/);

    // Exercise the settings callback through the real popup, without rendering DOM.
    let settingsChange;
    context.Popup = class { dlg = {}; async show() {} };
    context.POPUP_TYPE = { TEXT: 1 };
    globalThis.$ = () => ({
        length: 1, find: () => [],
        on(_event, selector, callback) { if (selector === "[data-set]") settingsChange = callback; },
    });
    await extension.openLedgerPopup("settings");
    settingsChange({ currentTarget: { dataset: { set: "placement" }, type: "select-one", value: "auto" } });
    await generate("normal");
    assert.ok(prompts.get(REMINDER_KEY)[0]);
    settingsChange({ currentTarget: { dataset: { set: "placement" }, type: "select-one", value: "macro" } });
    assert.equal(prompts.get(REMINDER_KEY)[0], "", "changing placement clears the previous automatic reminder immediately");
    assert.equal(prompts.get("story_ledger")[0], "");
    assert.match(macros.get("story_ledger")(), /<ledger_generation_reminder>/, "placement change rebuilds macro output");
    settingsChange({ currentTarget: { dataset: { set: "placement" }, type: "select-one", value: "auto" } });
    await generate("normal");
    settingsChange({ currentTarget: { dataset: { set: "enabled" }, type: "checkbox", checked: false } });
    assert.equal(prompts.get(REMINDER_KEY)[0], "", "disabling clears the previous reminder immediately");
    assert.equal(prompts.get("story_ledger")[0], "");
    await generate("normal");
    assert.equal(prompts.get(REMINDER_KEY)[0], "");
    assert.equal(macros.get("story_ledger")(), "");

    context.extensionSettings.storyLedger.enabled = true;
    context.extensionSettings.storyLedger.placement = "auto";
    await generate("normal");
    const substitute = context.substituteParams, logError = console.error;
    context.substituteParams = () => { throw new Error("template substitution failed"); };
    console.error = () => {};
    try { await generate("normal"); }
    finally { context.substituteParams = substitute; console.error = logError; }
    assert.equal(prompts.get(REMINDER_KEY)[0], "", "failed prompt builds clear the previous reminder");
    assert.equal(prompts.get("story_ledger")[0], "");
});

test("the reminder requires fictional NPC thoughts and uses parseable ledger syntax", async () => {
    const { buildGenerationReminder } = await import("../src/model/generation-reminder.js");
    const out = buildGenerationReminder(emptyState(), { sections: {} }, "normal");
    assert.match(out, /exactly one hidden.*Story_Ledger.*after.*prose/i);
    assert.match(out, /Thoughts.*REQUIRED.*1–3 NPCs/i);
    assert.match(out, /relevant to (?:this|the current) response/i);
    assert.match(out, /fictional.*internal thoughts/i);
    assert.match(out, /actual names.*values/i);
    assert.match(out, /omit.*unchanged/i);
    const example = out.match(/<!-- Story_Ledger\n[\s\S]*?-->/)?.[0];
    assert.ok(example);
    assert.deepEqual(parseChanges(example).sections.Thoughts, ["Mara: keep smiling. he must not see the worry."]);
    assert.equal(stripPromptText(`${out}\nUser: continue\n<!-- Story_Ledger\nNow: Day 2\n-->`), `${out}\nUser: continue\n<!-- Story_Ledger\nNow: Day 2\n-->`, "text-completion stripping preserves the injected example");
});

test("disabled sections and excluded generation types do not ask for unwanted output", async () => {
    const { buildGenerationReminder } = await import("../src/model/generation-reminder.js");
    const state = emptyState();
    state.rel.awaiting["Mara→Jan"] = "longtime friends";
    const out = buildGenerationReminder(state, { sections: { thoughts: false, relationships: false } }, "normal");
    assert.doesNotMatch(out, /Thoughts|NEW|Mara|Jan/);
    for (const type of ["quiet", "impersonate", "first_message"]) assert.equal(buildGenerationReminder(state, {}, type), "");
    assert.equal(buildGenerationReminder(state, { enabled: false }, "normal"), "");
});

test("awaiting baselines are calibrated before this beat without repeating saved events", async () => {
    const { buildGenerationReminder } = await import("../src/model/generation-reminder.js");
    const state = emptyState();
    state.rel.awaiting = { "Mara→Jan": "BOND 50, close friends", "Sofia→Bryce": "" };
    const out = buildGenerationReminder(state, {}, "swipe");
    assert.match(out, /Mara → Jan.*BOND 50, close friends/);
    assert.match(out, /Sofia → Bryce/);
    assert.match(out, /NEW.*each.*before (?:the current|this) beat/i);
    assert.match(out, /before the queued interactions/i, "the NEW baseline must precede even the saved earlier beats");
    assert.match(out, /saved.*apply automatically/i);
    assert.match(out, /(?:do not|never) repeat.*(?:ticks|events)/i);
    assert.match(out, /twelve axes.*Φ/i);
});

test("continuations complete the original comment without duplicating ledger output", async () => {
    const { buildGenerationReminder } = await import("../src/model/generation-reminder.js");
    const out = buildGenerationReminder(emptyState(), {}, "continue");
    assert.match(out, /complete.*existing.*comment/i);
    assert.match(out, /(?:never|do not).*second.*comment/i);
    assert.match(out, /already complete.*do not.*another/i);
});
