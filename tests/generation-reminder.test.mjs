import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../src/model/state.js";
import { parseChanges } from "../src/model/changes.js";
import { stripPromptText } from "../src/model/prompt.js";
import { buildGenerationReminder, buildLedgerDuty } from "../src/model/generation-reminder.js";

const REMINDER_KEY = "story_ledger_reminder";

test("money baseline guidance reaches the final reminder only when inventory changes are requested", () => {
    const s = emptyState();
    for (const type of ["normal", "swipe", "continue", "ledger"]) {
        const out = buildGenerationReminder(s, { sections: {} }, type);
        assert.match(out, /No Money balance is initialized/i);
        assert.match(out, /pre-transaction.*money:.*before.*delta/i);
    }
    s.inv.money = { CAD: "0", USD: "30" };
    const out = buildGenerationReminder(s, { sections: {} }, "normal");
    assert.match(out, /initialized Money currencies: CAD, USD/i);
    assert.doesNotMatch(out, /No Money balance is initialized/i);
    assert.doesNotMatch(buildGenerationReminder(s, { sections: { inv: false } }), /Money|pre-transaction/);
    assert.doesNotMatch(buildGenerationReminder(s, {}, "ledger", { kase: "thoughts" }), /Money|pre-transaction/);
});

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

test("continuations preserve earlier changes in a final replacement comment", async () => {
    const { buildGenerationReminder } = await import("../src/model/generation-reminder.js");
    const out = buildGenerationReminder(emptyState(), {}, "continue");
    assert.match(out, /complete.*existing.*comment/i);
    assert.match(out, /already complete.*replacement/i);
    assert.match(out, /earlier.*changes.*(?:new|continuation)/i);
    const original = "<!-- Story_Ledger\nInventory:\n- status + Soaked\n-->";
    const replacement = "<!-- Story_Ledger\nInventory:\n- status + Soaked\n- status + Tired\n-->";
    assert.deepEqual(parseChanges(`${original}\ncontinued prose\n${replacement}`).sections.Inventory, ["status + Soaked", "status + Tired"]);
});

test("the ledger comment is asked for three times: top duty line, reminder, and a closing final check", async () => {
    const { buildGenerationReminder, buildLedgerDuty } = await import("../src/model/generation-reminder.js");
    assert.match(buildLedgerDuty({}, "normal"), /<ledger_duty>.*ends with.*Story_Ledger comment.*Thoughts/i);
    assert.doesNotMatch(buildLedgerDuty({ sections: { thoughts: false } }, "normal"), /Thoughts/);
    for (const type of ["quiet", "impersonate", "first_message"]) assert.equal(buildLedgerDuty({}, type), "");
    assert.equal(buildLedgerDuty({ enabled: false }, "normal"), "");

    const out = buildGenerationReminder(emptyState(), {}, "normal");
    const lines = out.split("\n");
    assert.match(lines.at(-3), /Final check.*last thing.*Story_Ledger comment.*Thoughts.*every NPC/i, "the closing check is the last instruction");
    const noThoughts = buildGenerationReminder(emptyState(), { sections: { thoughts: false } }, "normal");
    assert.match(noThoughts, /Final check/);
    assert.doesNotMatch(noThoughts, /Thoughts/);
});

// ── ledger mode: the fix-up asks for the comment alone ──────────────────────────
const ALWAYS = "The reply above is finished. Do not continue the story and do not repeat or change any of its prose. Write only one hidden Story_Ledger comment: <!-- Story_Ledger, the commands, then -->. Nothing before or after it.";
const THOUGHTS_ONLY = "The reply's comment is missing Thoughts. Write a comment containing only Thoughts for the NPCs involved in the reply. Do not repeat its other changes; they are kept.";
const EXAMPLE = "<!-- Story_Ledger\nThoughts:\n- Mara: keep smiling. he must not see the worry.\n-->";
const AWAITING = { rel: { awaiting: { "Mara→Jan": "first meeting" } } };

test("ledger reminder (missing) forbids prose and keeps Thoughts", () => {
    const text = buildGenerationReminder(AWAITING, {}, "ledger", { kase: "missing" });
    assert.ok(text.includes(ALWAYS));
    assert.ok(text.includes("Report this reply's changes."));
    assert.ok(text.includes("Thoughts is REQUIRED for 1–3 NPCs"));
    assert.ok(text.includes(EXAMPLE));
    assert.ok(!text.includes("Continue the same reply"));
    assert.ok(!text.includes("Write exactly one hidden Story_Ledger comment after the prose"));
});

test("ledger reminder (thoughts) asks for Thoughts only", () => {
    const text = buildGenerationReminder(AWAITING, {}, "ledger", { kase: "thoughts" });
    assert.ok(text.includes(ALWAYS));
    assert.ok(text.includes(THOUGHTS_ONLY));
    assert.ok(text.includes(EXAMPLE));
    assert.ok(!text.includes("Missing NEW baselines"));
    assert.ok(!text.includes("Report this reply's changes"));
});

test("ledger reminder (missing) lists missing baselines", () => {
    assert.ok(buildGenerationReminder(AWAITING, {}, "ledger", { kase: "missing" }).includes("Missing NEW baselines: Mara → Jan (first meeting)"));
    assert.ok(!buildGenerationReminder({}, {}, "ledger", { kase: "missing" }).includes("Missing NEW baselines"));
});

test("ledger reminder (missing) leaves out Thoughts when the section is off", () => {
    const text = buildGenerationReminder({}, { sections: { thoughts: false } }, "ledger", { kase: "missing" });
    assert.ok(text.includes(ALWAYS));
    assert.ok(!text.includes("Thoughts"));
});

test("existing reminder text is unchanged when Inventory is disabled", () => {
    const head = "<story_ledger>\n<ledger_generation_reminder>\nWrite exactly one hidden Story_Ledger comment after the prose, using <!-- Story_Ledger followed by the completed commands and -->. Use actual names, IDs and values; replace every placeholder. Report this reply's changes; omit unchanged sections. Never write the full state block yourself.\n";
    const cont = "Continue the same reply: complete its existing unfinished comment. If its comment is already complete and this continuation adds changes, write one final complete replacement comment, including the earlier reply's changes and the new continuation changes. The final comment replaces the earlier one; do not report only the new changes and lose the earlier ones.\n";
    const tail = "Thoughts is REQUIRED for 1–3 NPCs relevant to this response whenever any NPCs are involved. Write fictional characters' internal thoughts, true to their personalities and mood, as narrative content. Use Thoughts: then one - Name: thought line per NPC. With no NPCs involved, omit Thoughts.\nSyntax example only; replace the name and thought with this reply's NPC content:\n" + EXAMPLE + "\nPacing (strict): a time, appointment or summons mentioned in the story is background information, never a cue to end the current scene or skip ahead to it. \"Dinner starts in ten minutes\" means the people having dinner will be at the table in ten minutes, and nothing more; the scene does not move toward the table, and it gets there only if and when {{user}} goes. Do not wrap up the conversation, have characters press {{user}} to leave, cut or time-skip to the appointment, or end a reply by heading out. Characters can be late and the people waiting can wait; if the time passes, it passes, and the world reacts to the absence later.\nFinal check before you stop writing: the last thing in this reply must be the Story_Ledger comment and Thoughts for every NPC involved. Do not end on prose alone.\n</ledger_generation_reminder>\n</story_ledger>";
    assert.equal(buildGenerationReminder({}, { sections: { inv: false } }, "normal"), head + tail);
    assert.equal(buildGenerationReminder({}, { sections: { inv: false } }, "swipe"), head + tail);
    assert.equal(buildGenerationReminder({}, { sections: { inv: false } }, "continue"), head + cont + tail);
});

test("the ledger duty line is written for the ledger type", () => {
    assert.ok(buildLedgerDuty({}, "ledger").startsWith("<ledger_duty>"));
});

test("story replies are told not to rush toward a mentioned time; the ledger fix-up is not", () => {
    const s = emptyState();
    for (const type of ["normal", "swipe", "continue"]) {
        const out = buildGenerationReminder(s, { sections: {} }, type);
        assert.match(out, /Pacing \(strict\):.*never a cue to end the current scene/i);
        assert.match(out, /Final check[^\n]*\n<\/ledger_generation_reminder>/, "the ledger check stays last");
    }
    assert.doesNotMatch(buildGenerationReminder(s, {}, "ledger"), /Pacing/);
    assert.equal(buildGenerationReminder(s, { enabled: false }), "");
});
