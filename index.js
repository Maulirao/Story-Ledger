// ──────────────────────────────────────────────────────────────────────────────
// Story Ledger — a SillyTavern extension. Rules notebook, story clock and a
// FrankenSIM-axis relationship engine that work with any preset.
//
// The model writes one hidden comment per reply, <!-- Story_Ledger … -->, holding
// only what changed. This extension keeps the books: it reads the state from the
// newest reply's block, applies the changes, and writes the full state block into
// the reply (FF's <internal_states> layout). The newest block is the truth, so a
// hand edit to it sticks. Pure logic lives in src/model/; display in src/ui/.
// Uses only SillyTavern's public getContext() API.
// ──────────────────────────────────────────────────────────────────────────────

import { setSend } from "./src/model/sections/quests.js";
import { applyDecision, importFromLegacyNotebook, storyTime } from "./src/model/notebook.js";
import { resolveConfig, sanitizeChekhov, sanitizeFate, sanitizeTitles, sanitizeThreadLimit } from "./src/model/config.js";
import { latestState, stripBlocks, rewriteNewestSection } from "./src/model/turn.js";
import { stripForPrompt, stripPromptText, renderTurnFacts } from "./src/model/prompt.js";
import { buildLeanPrompt } from "./src/model/lean-prompt.js";
import { SECTIONS } from "./src/model/sections/registry.js";
import { rollTurnDice, withFudges, parseDiceCommand, parseForceCommand } from "./src/model/dice.js";
import { BLOCK_MARK } from "./src/model/block.js";
import * as core from "./src/host/core.js";
import * as frankensteinTheme from "./src/ui/themes/frankenstein.js";
import * as solaTheme from "./src/ui/themes/sola.js";
import * as meguminTheme from "./src/ui/themes/megumin.js";
import { undecorate } from "./src/ui/themes/common.js";

const THEMES = { frankenstein: frankensteinTheme, sola: solaTheme, megumin: meguminTheme };

const NAME = "storyLedger";
const PROMPT_KEY = "story_ledger";
const REMINDER_KEY = "story_ledger_reminder";
const IN_CHAT = 1;
const ctx = () => SillyTavern.getContext();

// The logic between "SillyTavern gave me the chat" and "here is what to show, save or send"
// lives in src/host/core.js, shared with the LocalChar extension. This file is SillyTavern's
// wiring around it: events, the interceptor, toastr, the DOM and the popup's handlers.
const { SKIP_TYPES, generationBase, fudgeSummary, hasFudgeSettings, prepareTurn } = core;

// ── Settings (global) and chat data (per chat) ──────────────────────────────

function settings() {
    const all = ctx().extensionSettings;
    return all[NAME] = core.normalizeSettings(all[NAME]);
}
const saveSettings = () => ctx().saveSettingsDebounced();
// Warnings about a reply land when it finishes — often while the reader is in another
// tab — so by default they stay until closed (✕ or a click) instead of fading out.
const STICKY = { timeOut: 0, extendedTimeOut: 0, closeButton: true };
const notice = (kind, message, title) => toastr[kind](message, title, settings().stickyNotices === false ? {} : STICKY);
const engineConfig = (extra = {}) => core.engineConfig(settings(), ctx().name1, extra);

const chatData = () => core.normalizeChatData(ctx().chatMetadata || {});
async function saveChatData(mutator) {
    const d = chatData();
    mutator(d);
    await ctx().saveMetadata();
}

// ── The state before message `index` ────────────────────────────────────────

const stateBefore = (chat, index, config) => core.stateBefore(chat, index, config, chatData());
const blockFor = state => core.blockFor(state, { settings: settings(), chatData: chatData(), userName: ctx().name1 });

// ── What the model reads ────────────────────────────────────────────────────

// A fix-up passes the `config` its reply was built with and the `kase` it is asking for.
function buildInjection(type = "normal", { config: given = null, kase = null } = {}) {
    const raw = ctx().chat || [];
    const out = core.buildInjection({
        chat: raw, type, settings: settings(), chatData: chatData(), userName: ctx().name1,
        pending: given ? null : pendingFor(generationBase(raw.length, type)), kase, givenConfig: given,
    });
    if (!out.text) { lastReminder = ""; return ""; }
    if (out.chatDataPatch) {
        saveChatData(d => Object.assign(d, out.chatDataPatch))
            .then(() => out.notices.forEach(n => notice(n.kind, n.text, n.title)))
            .catch(e => console.error("[Story Ledger] could not save imported rules", e));
    }
    lastReminder = ctx().substituteParams(out.reminder);
    return ctx().substituteParams(out.text);
}

let lastInjection = "";
let lastReminder = "";
let lastGenerationType = "normal";

function clearInjection() {
    lastInjection = "";
    lastReminder = "";
    ctx().setExtensionPrompt(PROMPT_KEY, "", IN_CHAT, 1);
    ctx().setExtensionPrompt(REMINDER_KEY, "", IN_CHAT, 0, false, 0);
}
// This generation's dice and fudge controls, tied to its chat/reply index. A continuation
// reads the existing block's dice; swipes reuse the same reply's armed fudges.
let pendingTurn = null;
const chatId = () => (ctx().getCurrentChatId ? ctx().getCurrentChatId() : null);
const pendingFor = index => pendingTurn && pendingTurn.chatId === chatId() && pendingTurn.index === index ? pendingTurn : null;

globalThis.storyLedgerInterceptor = async function (_chat, _contextSize, _abort, type) {
    try {
        const s = settings();
        lastGenerationType = type || "normal";
        if (fixupContinues(type)) {
            // The fix-up's own continue: the reply's dice and fudges stay as they were, and the
            // reminder asks for the ledger comment alone.
            lastReminder = "";
            lastInjection = s.enabled ? buildInjection("continue", { config: fixupRun.config, kase: fixupRun.kase }) : "";
            const auto = s.placement !== "macro" ? lastInjection : "";
            ctx().setExtensionPrompt(PROMPT_KEY, auto, IN_CHAT, Number(s.depth) || 0, false, Number(s.role) || 0);
            ctx().setExtensionPrompt(REMINDER_KEY, s.placement !== "macro" ? lastReminder : "", IN_CHAT, 0, false, 0);
            return;
        }
        if (fixupRun?.mode === "full" && !fixupRun.abandoned && fixupRun.chatId === chatId()) {
            console.warn("[Story Ledger] another generation started during the ledger fix-up; it gets no ledger prompt");
            clearInjection();
            return;
        }
        // Background generations (summaries, other extensions' tasks) get nothing.
        if (!SKIP_TYPES.has(type) && s.enabled) {
            const raw = ctx().chat || [];
            const turn = prepareTurn({ chat: raw, type, settings: s, chatData: chatData(), pendingSame: pendingFor(generationBase(raw.length, type)) });
            if (turn.fudgesChanged) await saveChatData(d => { d.fudges = turn.fudgesNext; });
            pendingTurn = { chatId: chatId(), ...turn.pending };
        }
        lastReminder = "";
        lastInjection = (SKIP_TYPES.has(type) || !s.enabled) ? "" : buildInjection(type);
        const auto = s.placement !== "macro" ? lastInjection : "";
        ctx().setExtensionPrompt(PROMPT_KEY, auto, IN_CHAT, Number(s.depth) || 0, false, Number(s.role) || 0);
        ctx().setExtensionPrompt(REMINDER_KEY, s.placement !== "macro" ? lastReminder : "", IN_CHAT, 0, false, 0);
    } catch (e) {
        console.error("[Story Ledger] interceptor failed", e);
        clearInjection();
    }
};

// ── Writing the block into a reply ──────────────────────────────────────────

/**
 * Recompute message `i`'s block from the block before it and its own comment (core.rebuildMessage),
 * write it into the reply and its swipe, save, and show the notices. A received reply takes the
 * dice rolled for it; ↻ rebuild keeps the dice its block already shows; a fix-up hands in the
 * config it already settled.
 */
async function rebuildMessage(i, { collect = true, config: given = null } = {}) {
    const c = ctx().chat || [];
    const msg = c[i];
    if (!msg || msg.is_user || msg.is_system) return;
    const out = core.rebuildMessage({
        chat: c, index: i, settings: settings(), chatData: chatData(), userName: ctx().name1,
        pending: pendingFor(i), collect, givenConfig: given, proposalSource: `m${i}s${msg.swipe_id ?? 0}`,
    });
    setReply(msg, out.mes);
    ctx().updateMessageBlock(i, msg);
    await ctx().saveChat();
    decorateAll();
    if (out.chatDataPatch) await saveChatData(d => Object.assign(d, out.chatDataPatch));
    for (const n of out.notices) notice(n.kind, n.text, n.title);
}

async function onMessageReceived(id, type) {
    if (!settings().enabled || SKIP_TYPES.has(type)) return;
    const c = ctx().chat || [];
    const i = Number.isInteger(Number(id)) && c[Number(id)] ? Number(id) : c.length - 1;
    if (fixupRun && fixupRun.chatId === chatId() && fixupRun.index === i) return;   // the fix-up finishes this reply itself
    try { await rebuildMessage(i); } catch (e) { console.error("[Story Ledger] could not write the block", e); }
}

// ── Ledger fix-up: ask for the missing comment or Thoughts and keep only that ─

// The one run in flight: { chatId, index, swipeId, mes (snapshot), kase, mode, config, stopped, abandoned, error }
let fixupRun = null;
let fixupAsking = false;

// Is this generation the fix-up's own Full-mode continue?
const fixupContinues = type => type === "continue" && fixupRun?.mode === "full" && !fixupRun.abandoned
    && fixupRun.chatId === chatId() && fixupRun.index === generationBase((ctx().chat || []).length, type);

// The dice and fudges the reply already has: a fix-up never rolls, merges or consumes any.
const fixupConfig = i => core.fixupConfig({ chat: ctx().chat || [], index: i, settings: settings(), chatData: chatData(), userName: ctx().name1 });

// Write a reply's text, keeping the current swipe in step with it.
function setReply(msg, mes) {
    msg.mes = mes;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) msg.swipes[msg.swipe_id] = mes;
}

function mainPromptText() {
    const c = ctx();
    const chat = c.chatCompletionSettings?.prompts?.find(p => p.identifier === "main")?.content;
    const text = c.powerUserSettings?.sysprompt?.content;
    return c.substituteParams(String((c.mainApi === "openai" ? chat : text) ?? chat ?? text ?? ""));
}

function cardsInChat() {
    const c = ctx();
    const members = c.groupId ? ((c.groups || []).find(g => g.id === c.groupId)?.members || []) : null;
    const cards = members ? members.map(avatar => (c.characters || []).find(ch => ch.avatar === avatar)) : [(c.characters || [])[c.characterId]];
    return cards.filter(Boolean).map(ch => ({ name: ch.name, description: ch.description || "", personality: ch.personality || "" }));
}

// The lean prompt's input for the reply `run` started from. State comes from before the reply.
function leanInputs(i, run) {
    const c = ctx();
    return core.leanInputs({
        chat: c.chat || [], index: i, run, settings: settings(), chatData: chatData(), userName: c.name1,
        mainPrompt: mainPromptText(),
        characters: cardsInChat(),
        personaName: c.name1,
        summary: String(c.extensionPrompts?.["1_memory"]?.value || "").trim(),
        substitute: text => c.substituteParams(text),
    });
}

/** "missing", "thoughts" or null: what ✎ would ask for on message `i`. Only the last reply, and only while idle. */
export function fixupCaseFor(i) {
    return core.fixupCaseFor({ chat: ctx().chat || [], index: i, settings: settings(), busy: Boolean(fixupRun || fixupAsking) });
}

export async function startFixup(i) {
    const s = settings();
    const chat = ctx().chat || [];
    const msg = chat[i];
    const kase = fixupCaseFor(i);
    if (!kase) return;
    const mode = s.fixupMode === "lean" ? "lean" : "full";
    fixupAsking = true;
    let ok = false;
    try {
        ok = await ctx().Popup.show.confirm("Write the missing ledger part?",
            `${kase === "missing" ? "This reply has no ledger comment; one will be written." : "This reply's ledger comment has no Thoughts; they will be added."} The prose is never changed, and nothing is kept unless the answer is usable. ${mode === "lean" ? "Lean: short prompt" : "Full: normal prompt"}`);
    } finally { fixupAsking = false; }
    if (!ok || (ctx().chat || [])[i] !== msg || fixupCaseFor(i) !== kase) return;   // nothing may have changed while the popup was open
    const run = fixupRun = {
        chatId: chatId(), index: i, swipeId: msg.swipe_id, mes: msg.mes, kase, mode,
        config: fixupConfig(i), stopped: false, abandoned: false, error: null,
    };
    decorateAll();
    if (mode === "full") {
        try { await ctx().executeSlashCommandsWithOptions("/continue await=true"); } catch (e) { run.error = e; }
        await finalizeFixup(run);
    } else {
        let output = null;
        try { output = await ctx().generateRaw({ prompt: buildLeanPrompt(leanInputs(i, run)) }); } catch (e) { run.error = e; }
        await finalizeFixup(run, output);
    }
}

/** Judge what the run produced, then splice it into the reply it started from or put the reply back. */
async function finalizeFixup(run, output = null) {
    try {
        const chat = ctx().chat || [];
        const msg = chat[run.index];
        const unchanged = !run.abandoned && chatId() === run.chatId && core.fixupReplyUnchanged({ run, chat });
        if (!unchanged) {
            if (!run.abandoned) notice("warning", "The reply changed during the ledger fix-up; it was left as it is.", "📒 Story Ledger");
            return;
        }
        let reason = run.stopped ? "stopped" : run.error ? (run.error.message || String(run.error)) : null;
        let judged = null;
        if (!reason) {
            judged = core.judgeFixup({ run, chat, settings: settings(), chatData: chatData(), userName: ctx().name1, output });
            if (!judged.ok) reason = judged.reason;
        }
        // the reply as the run found it (only what the run itself wrote is undone: the guard proved it)
        const putBack = async why => {
            if (msg.mes !== run.mes) {
                setReply(msg, run.mes);
                ctx().updateMessageBlock(run.index, msg);
                await ctx().saveChat();
            }
            notice("warning", `Ledger fix-up kept nothing: ${why}.`, "📒 Story Ledger");
        };
        if (reason) { await putBack(reason); return; }
        setReply(msg, judged.mes);
        try { await rebuildMessage(run.index, { config: run.config }); }
        catch (e) {
            console.error("[Story Ledger] could not write the fixed block", e);
            await putBack(e.message || String(e));
        }
    } catch (e) {
        console.error("[Story Ledger] the ledger fix-up failed", e);
    } finally {
        if (fixupRun === run) fixupRun = null;
        decorateAll();
    }
}

// ── Display ─────────────────────────────────────────────────────────────────

function newestBlockIndex() {
    const chat = ctx().chat || [];
    return latestState(chat, chat.length, engineConfig())?.index ?? -1;
}

function decorateMessage(i, newestIndex = newestBlockIndex()) {
    const el = document.querySelector(`#chat .mes[mesid="${i}"] .mes_text`);
    if (!el) return;
    const s = settings();
    if (!s.enabled || !String(((ctx().chat || [])[i] || {}).mes || "").includes(BLOCK_MARK)) { undecorate(el); return; }
    const theme = THEMES[s.theme] || THEMES.frankenstein;   // display only: the message text never changes
    theme.decorate(el, { config: engineConfig(), mesIndex: i, isNewest: i === newestIndex, fixup: i === newestIndex ? fixupCaseFor(i) : null });
}
const decorateAll = () => {
    const newestIndex = newestBlockIndex();
    document.querySelectorAll("#chat .mes[mesid]").forEach(el => decorateMessage(Number(el.getAttribute("mesid")), newestIndex));
};

// While a reply streams, the unfinished comment is shown as text until "-->"
// arrives. Hide it in the live view.
function hideStreamingLedger() {
    const last = document.querySelector("#chat .mes.last_mes .mes_text");
    if (!last) return;
    let hiding = false;
    for (const child of last.children) {
        if (!hiding && /<!--\s*Story_Ledger/.test(child.textContent)) hiding = true;
        if (hiding) child.style.display = "none";
    }
}

/**
 * Change the quests in the newest reply's block, as a hand edit would: only the 📜 QUESTS
 * rows are rewritten, so the reply's thoughts, checks and physics stay. Returns the
 * status from rewriteNewestSection ("ok" | "noblock" | "unreadable" | "nosection").
 */
async function editNewestQuests(mutator) {
    const c = ctx().chat || [];
    const r = rewriteNewestSection(c, c.length, engineConfig(), "quests", mutator);
    if (r.status !== "ok") return r;
    const msg = c[r.index];
    msg.mes = r.mes;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) msg.swipes[msg.swipe_id] = msg.mes;
    ctx().updateMessageBlock(r.index, msg);
    await ctx().saveChat();
    decorateMessage(r.index);
    return r;
}

// ── The popup ───────────────────────────────────────────────────────────────

const lines = text => String(text || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const validDie = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 20;
const dieValue = (dice, key) => key.startsWith("fate.") ? dice.fate[key.at(-1)] : key === "world" ? dice.world : dice.checks;

function readFudgePanel($root) {
    const fudge = { appliedTo: null }, dice = {};
    for (const key of ["fate.a", "fate.b", "fate.c", "world"]) {
        const locked = $root.find(`[data-fudge-lock="${key}"]`).prop("checked");
        const value = $root.find(`[data-fudge-value="${key}"]`).val();
        if (locked && validDie(value)) dice[key] = Number(value);
    }
    if ($root.find('[data-fudge-lock="checks"]').prop("checked")) {
        const values = [0, 1, 2].map(i => Number($root.find(`[data-fudge-check="${i}"]`).val()));
        if (values.every(validDie)) dice.checks = values;
    }
    if (Object.keys(dice).length) fudge.dice = dice;
    const tier = String($root.find("#sl-fudge-tier").val() || "");
    const source = String($root.find("#sl-fudge-source").val() || "");
    const fire = String($root.find("#sl-fudge-fire").val() || "");
    if (tier) fudge.tier = tier;
    if (source) fudge.source = source;
    if ($root.find("#sl-fudge-calm").prop("checked")) fudge.calm = true;
    if (fire) fudge.fire = fire;
    return fudge;
}

const popupHtml = (tab, previewBaseDice = null) => core.popupHtml(
    tab, { chat: ctx().chat || [], settings: settings(), chatData: chatData(), userName: ctx().name1 }, previewBaseDice);

export async function openLedgerPopup(startTab = "rules") {
    let tab = startTab;
    let previewBaseDice = rollTurnDice();
    const popup = new (ctx().Popup)(popupHtml(tab, previewBaseDice), ctx().POPUP_TYPE.TEXT, "", { wide: true, large: true, allowVerticalScrolling: true, okButton: "Close" });
    const $root = $(popup.dlg);
    const refresh = () => $root.find(".sl-popup").replaceWith(popupHtml(tab, previewBaseDice));
    const done = (msg) => { if (msg) toastr.success(msg, "📒 Story Ledger"); refresh(); };
    const updatePreview = () => {
        if (tab !== "dice") return;
        const chat = ctx().chat || [];
        const state = stateBefore(chat, chat.length, engineConfig());
        const fudge = readFudgePanel($root);
        const applied = withFudges(previewBaseDice, fudge);
        const text = renderTurnFacts(state, engineConfig({ dice: applied.dice, fudges: fudge, fudgedDice: applied.fudged, rolls: applied.dice.checks }));
        $root.find("#sl-turn-preview").text(text || "No turn facts for the enabled sections.");
    };

    $root.on("click", "[data-sl-popup-tab]", e => { tab = $(e.currentTarget).data("sl-popup-tab"); refresh(); });
    $root.on("change", "#sl-nb-enabled", async e => { await saveChatData(d => { d.notebook.enabled = e.target.checked; }); });
    $root.on("click", "#sl-save-rules", async () => { await saveChatData(d => { d.notebook.rules = lines($root.find("#sl-rules").val()); }); done("Rules saved. The next reply's block shows them."); });
    $root.on("click", "#sl-save-threads", async () => { await saveChatData(d => { d.notebook.threads = lines($root.find("#sl-threads").val()); }); done("Starting threads saved."); });
    $root.on("click", "#sl-import", async () => {
        const got = importFromLegacyNotebook(ctx().chat || []);
        if (!got.rules.length && !got.threads.length) { toastr.warning("No previous notebook found in this chat.", "📒 Story Ledger"); return; }
        const current = lines($root.find("#sl-rules").val());
        $root.find("#sl-rules").val([...current, ...got.rules.filter(x => !current.includes(x))].join("\n"));
        if (got.threads.length) await saveChatData(d => { if (!d.notebook.threads.length) d.notebook.threads = got.threads; });
        toastr.info(`Imported ${got.rules.length} rule(s), ${got.threads.length} thread(s). Review the rules, edit any that name the old preset's mechanics, then Save.`, "📒 Story Ledger");
    });
    $root.on("click", ".sl-approve, .sl-reject", async e => {
        const id = $(e.currentTarget).data("id");
        const decision = $(e.currentTarget).hasClass("sl-approve") ? "approve" : "reject";
        await saveChatData(d => {
            const item = d.notebook.inbox.find(i => i.id === id);
            d.notebook = item && item.stale && decision === "reject"
                ? { ...d.notebook, inbox: d.notebook.inbox.filter(i => i.id !== id) }
                : applyDecision(d.notebook, id, decision);
        });
        done();
    });
    $root.on("click", "#sl-clock-set", async () => {
        const text = String($root.find("#sl-clock").val() || "").trim();
        if (!text) return;
        await saveChatData(d => { d.notebook.clockOverride = { text, atLength: (ctx().chat || []).length }; });
        done("Story time corrected.");
    });
    $root.on("click", "#sl-clock-clear", async () => { await saveChatData(d => { delete d.notebook.clockOverride; }); done(); });
    $root.on("input", "[data-fudge-value]", e => {
        const key = e.currentTarget.dataset.fudgeValue;
        $root.find(`[data-fudge-lock="${key}"]`).prop("checked", true);
        updatePreview();
    });
    $root.on("input", "[data-fudge-check]", () => { $root.find('[data-fudge-lock="checks"]').prop("checked", true); updatePreview(); });
    $root.on("change", "[data-fudge-lock]", e => {
        const key = e.currentTarget.dataset.fudgeLock;
        if (!e.currentTarget.checked) {
            if (key === "checks") [0, 1, 2].forEach(i => $root.find(`[data-fudge-check="${i}"]`).val(previewBaseDice.checks[i]));
            else $root.find(`[data-fudge-value="${key}"]`).val(dieValue(previewBaseDice, key));
        }
        updatePreview();
    });
    $root.on("change", "#sl-fudge-tier, #sl-fudge-source, #sl-fudge-calm, #sl-fudge-fire", updatePreview);
    $root.on("click", "#sl-reroll-unlocked", () => {
        previewBaseDice = rollTurnDice();
        for (const key of ["fate.a", "fate.b", "fate.c", "world"]) {
            if (!$root.find(`[data-fudge-lock="${key}"]`).prop("checked")) $root.find(`[data-fudge-value="${key}"]`).val(dieValue(previewBaseDice, key));
        }
        if (!$root.find('[data-fudge-lock="checks"]').prop("checked")) [0, 1, 2].forEach(i => $root.find(`[data-fudge-check="${i}"]`).val(previewBaseDice.checks[i]));
        updatePreview();
    });
    $root.on("click", "#sl-save-fudges", async () => {
        const fudge = readFudgePanel($root);
        const value = hasFudgeSettings(fudge) ? fudge : null;
        await saveChatData(d => { d.fudges = value; });
        done(value ? `Armed for the next reply: ${fudgeSummary(value)}.` : "No fudges are set.");
    });
    $root.on("click", "#sl-clear-fudges", async () => {
        await saveChatData(d => { d.fudges = null; });
        done("Fudges cleared.");
    });
    $root.on("change", "[data-set]", e => {
        const el = e.currentTarget, k = el.dataset.set;
        settings()[k] = el.type === "checkbox" ? el.checked : (el.type === "number" ? Number(el.value) : el.value);
        if (k === "placement" || (k === "enabled" && !settings().enabled)) clearInjection();
        if (k === "fixupMode") $root.find("#sl-fixup-history").toggle(el.value === "lean");
        saveSettings();
        decorateAll();
    });
    $root.on("change", "[data-section]", e => {
        settings().sections[e.currentTarget.dataset.section] = e.currentTarget.checked;
        saveSettings();
    });
    $root.on("click", "#sl-save-config", () => {
        const c = resolveConfig(settings().config);
        $root.find("[data-cfg]").each((_, el) => { c[el.dataset.cfg] = Number(el.value); });
        $root.find("[data-cfg-gate]").each((_, el) => { c.romanceGate[el.dataset.cfgGate] = Number(el.value); });
        $root.find("[data-cfg-phi]").each((_, el) => { c.phi[el.dataset.cfgPhi] = Number(el.value); });
        $root.find("[data-cfg-axis]").each((_, el) => { const a = c.axes.find(x => x.key === el.dataset.cfgAxis); a[el.dataset.field] = Number(el.value); });
        $root.find("[data-cfg-decay]").each((_, el) => { c.decay[Number(el.dataset.cfgDecay)].period = Number(el.value); });
        c.offstageSkip = String($root.find("[data-cfg-skip]").val() || "").split(/[,\s]+/).map(Number).filter(Number.isFinite);
        const form = { firing: String($root.find("[data-chk-firing]").val() || "model") };
        $root.find("[data-chk]").each((_, el) => { form[el.dataset.chk] = el.value; });
        c.sectionConfig.chekhov = sanitizeChekhov(form, c.sectionConfig.chekhov);
        const fateForm = {};
        $root.find("[data-fate]").each((_, el) => { fateForm[el.dataset.fate] = el.value; });
        c.sectionConfig.fate = sanitizeFate(fateForm, c.sectionConfig.fate);
        const titlesForm = {};
        $root.find("[data-titles]").each((_, el) => { titlesForm[el.dataset.titles] = el.value; });
        c.sectionConfig.titles = sanitizeTitles(titlesForm, c.sectionConfig.titles);
        c.sectionConfig.threadLimit = sanitizeThreadLimit($root.find("[data-threads]").val(), c.sectionConfig.threadLimit);
        settings().config = c;
        saveSettings();
        done("Engine numbers saved. They apply from the next reply on.");
    });
    $root.on("click", "#sl-reset-config", () => { settings().config = {}; saveSettings(); done("Reset to defaults."); });
    const setMixed = () => { const all = $root.find("#sl-send-all")[0]; if (all) all.indeterminate = all.dataset.mixed === "1"; };
    const sendQuests = async (ids, on) => {
        const r = await editNewestQuests(st => setSend(st, ids, on));
        if (r.status === "unreadable") toastr.warning(`The newest block has row(s) that no longer read — fix them first, so they are not overwritten: ${r.errors.map(e => `${e.section}: ${e.row}`).join("; ")}`, "🗺️ Story Ledger");
        else if (r.status === "nosection") toastr.warning("The newest block has no 📜 QUESTS section (is the Quests section switched off?).", "🗺️ Story Ledger");
        else if (r.status === "noblock") toastr.warning("No reply carries a Story Ledger block yet.", "🗺️ Story Ledger");
        refresh();
        setMixed();
    };
    $root.on("change", ".sl-send", e => sendQuests([String(e.currentTarget.dataset.id)], e.currentTarget.checked));
    $root.on("change", "#sl-send-all", e => sendQuests("all", e.currentTarget.checked));
    $root.on("click", "[data-rel-prune], [data-rel-restore]", async e => {
        const button = e.currentTarget;
        button.disabled = true;
        try {
            const pruned = button.dataset.relPrune !== undefined;
            const out = core.setRelationshipPruned({ chat: ctx().chat || [], settings: settings(), chatData: chatData(), userName: ctx().name1 }, pruned ? button.dataset.relPrune : button.dataset.relRestore, pruned);
            if (out.ok) await saveChatData(d => Object.assign(d, out.chatDataPatch));
            else toastr.warning("That relationship is no longer available. Reopen the Relationships tab.", "💞 Story Ledger");
        } catch (error) {
            toastr.error(error?.message || "The relationship choice could not be saved.", "💞 Story Ledger");
        } finally {
            button.disabled = false;
            refresh();
        }
    });
    $root.on("click", "[data-sl-popup-tab]", () => setTimeout(setMixed, 0));

    setTimeout(setMixed, 0);   // the master checkbox's partial state when the popup opens on the Quests tab
    await popup.show();
}

// ── Wiring ──────────────────────────────────────────────────────────────────

async function confirmRebuild(i) {
    const ok = await ctx().Popup.show.confirm("Rebuild this block?", "It is recomputed from the block before it and this reply's ledger comment. Hand edits to this block are replaced.");
    if (ok) await rebuildMessage(i, { collect: false });
}

function registerSlashCommands() {
    if (globalThis.__storyLedgerSlashCommandsRegistered) return;
    const c = ctx();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument } = c;
    const argumentType = c.ARGUMENT_TYPE?.STRING || globalThis.ARGUMENT_TYPE?.STRING || "string";
    if (!SlashCommandParser || !SlashCommand || !SlashCommandArgument) return;

    const add = (name, description, help, handler) => SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name,
        callback: async (_namedArgs, unnamedArgs) => {
            try { await handler(String(unnamedArgs ?? "").trim()); }
            catch (error) { toastr.warning(error.message || String(error), "📒 Story Ledger"); }
            return "";
        },
        unnamedArgumentList: [SlashCommandArgument.fromProps({ description, typeList: argumentType, isRequired: false })],
        helpString: `<div>${help}</div>`,
    }));
    const arm = async (fudge, message) => {
        await saveChatData(d => { d.fudges = hasFudgeSettings(fudge) ? { ...fudge, appliedTo: null } : null; });
        toastr.success(message, "🎲 Story Ledger");
    };

    add("ledger-dice", "dice locks, reroll, or clear", "Lock dice with <code>fate.a=20 world=7 checks=20,3,11</code>, use <code>reroll</code> to clear dice locks, or <code>clear</code> to clear every fudge.", async text => {
        if (text.toLowerCase() === "clear") { await arm(null, "Fudges cleared."); return; }
        const current = chatData().fudges || {};
        if (text.toLowerCase() === "reroll") {
            const next = { ...current };
            delete next.dice;
            next.appliedTo = null;
            await arm(next, "Dice locks cleared; unlocked dice will roll next turn.");
            return;
        }
        const parsed = parseDiceCommand(text);
        const next = { ...current, dice: { ...(current.dice || {}), ...parsed.dice }, appliedTo: null };
        await arm(next, `Armed for the next reply: ${fudgeSummary(next)}.`);
    });
    add("ledger-force", "tier, source, or calm", "Force an outcome with <code>MAJOR WEIGHTED</code>, <code>MINOR TRUE</code>, or <code>calm</code>.", async text => {
        const current = { ...(chatData().fudges || {}) };
        delete current.tier; delete current.source; delete current.calm;
        const next = { ...current, ...parseForceCommand(text), appliedTo: null };
        await arm(next, `Armed for the next reply: ${fudgeSummary(next)}.`);
    });
    add("ledger-fire", "bullet id or none", "Force a bullet with <code>B2</code> or prevent a bullet firing with <code>none</code>.", async text => {
        const value = text.toLowerCase() === "none" ? "none" : (/^B\d+$/i.test(text) ? text.toUpperCase() : "");
        if (!value) throw new Error("Use a loaded bullet id such as B2, or none.");
        if (value !== "none") {
            const chat = ctx().chat || [];
            const state = stateBefore(chat, chat.length, engineConfig());
            if (!state.chekhov.bullets.some(b => b.id.toLowerCase() === value.toLowerCase())) throw new Error(`${value} is not a loaded bullet.`);
        }
        const next = { ...(chatData().fudges || {}), fire: value, appliedTo: null };
        await arm(next, `Armed for the next reply: ${fudgeSummary(next)}.`);
    });
    globalThis.__storyLedgerSlashCommandsRegistered = true;
}

function init() {
    const c = ctx();
    const t = c.eventTypes;
    registerSlashCommands();
    c.eventSource.on(t.MESSAGE_RECEIVED, onMessageReceived);
    c.eventSource.on(t.CHAT_COMPLETION_PROMPT_READY, data => {
        const messages = data && (data.chat || data.messages);
        if (Array.isArray(messages) && settings().enabled) stripForPrompt(messages);
    });
    // Text completion builds one prompt string instead of a message list.
    if (t.GENERATE_AFTER_COMBINE_PROMPTS) c.eventSource.on(t.GENERATE_AFTER_COMBINE_PROMPTS, data => {
        if (data && typeof data.prompt === "string" && settings().enabled) data.prompt = stripPromptText(data.prompt);
    });
    for (const ev of [t.CHARACTER_MESSAGE_RENDERED, t.MESSAGE_UPDATED, t.MESSAGE_SWIPED, t.MESSAGE_EDITED]) {
        if (ev) c.eventSource.on(ev, () => setTimeout(decorateAll, 0));
    }
    for (const ev of [t.CHAT_CHANGED, t.MORE_MESSAGES_LOADED]) if (ev) c.eventSource.on(ev, () => setTimeout(decorateAll, 0));
    if (t.CHAT_CHANGED) c.eventSource.on(t.CHAT_CHANGED, () => { pendingTurn = null; if (fixupRun) fixupRun.abandoned = true; });
    if (t.GENERATION_STOPPED) c.eventSource.on(t.GENERATION_STOPPED, () => { if (fixupRun?.mode === "full") fixupRun.stopped = true; });
    if (t.STREAM_TOKEN_RECEIVED) c.eventSource.on(t.STREAM_TOKEN_RECEIVED, () => hideStreamingLedger());

    c.registerMacro("story_ledger", () => lastInjection || buildInjection(lastGenerationType));

    $(document).on("click", ".sl-rebuild", e => {
        e.preventDefault(); e.stopPropagation();
        const i = Number($(e.currentTarget).closest(".mes").attr("mesid"));
        if (Number.isInteger(i)) confirmRebuild(i);
    });
    $(document).on("click", ".sl-fixup", e => {
        e.preventDefault(); e.stopPropagation();
        const i = Number($(e.currentTarget).closest(".mes").attr("mesid"));
        if (Number.isInteger(i)) startFixup(i).catch(err => console.error("[Story Ledger] the ledger fix-up failed to start", err));
    });
    $(document).on("click", ".sl-next-turn", e => {
        e.preventDefault(); e.stopPropagation();
        openLedgerPopup("dice");
    });
    if (!$("#sl-menu").length) {
        $("#extensionsMenu").append(`<div id="sl-menu" class="list-group-item flex-container flexGap5 interactable" tabindex="0" title="Story Ledger"><div class="fa-solid fa-book-bookmark extensionsMenuExtensionButton"></div><span>Story Ledger</span></div>`);
        $("#sl-menu").on("click", () => openLedgerPopup());
    }
    decorateAll();
}

jQuery(() => {
    try { init(); } catch (e) { console.error("[Story Ledger] failed to start", e); }
});
