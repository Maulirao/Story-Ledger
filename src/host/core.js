// ──────────────────────────────────────────────────────────────────────────────
// The host-free core of Story Ledger's wiring. Everything index.js used to do between
// "SillyTavern gave me the chat" and "here is what to show/save/send" lives here, as pure
// functions of plain data: no SillyTavern, no DOM, no jQuery, no toastr.
//
// Two hosts call it: index.js (SillyTavern) and localchar/server.mjs + localchar/browser.mjs
// (LocalChar). Because both run these same functions, a block means the same thing in both.
//
// Conventions:
//   * `chat` is an array of SillyTavern-shaped messages: { mes, is_user, is_system, name,
//     swipe_id }. A host with other message shapes converts first.
//   * `settings` is the normalized global settings (normalizeSettings), `chatData` the
//     per-chat document (normalizeChatData). Functions never mutate them; a result that
//     should change the chat data comes back as `chatDataPatch` for the host to apply.
//   * Text for the model comes back BEFORE the host's macro substitution (substituteParams or
//     the compiler's macro evaluator); the host substitutes.
//   * Notices come back as { kind, title, text }; the host decides how to show them.
// ──────────────────────────────────────────────────────────────────────────────

import {
    emptyNotebook, collectProposals, importFromLegacyNotebook, storyTime, dayRegression,
} from "../model/notebook.js";
import { resolveConfig } from "../model/config.js";
import { describePair, PATTERN_GLOSS, relationsNotice } from "../model/relations.js";
import { parseChanges } from "../model/changes.js";
import { renderBlock } from "../model/block.js";
import { postTurn, latestState, initialState, writeBlockInto, stripBlocks, generationBase, withClockOverride, unreadNotices } from "../model/turn.js";
import { renderStatePrompt, needsHandover, renderRules, renderTurnFacts, buildTemplate, buildHandover } from "../model/prompt.js";
import { buildGenerationReminder, buildLedgerDuty } from "../model/generation-reminder.js";
import { needsFixup, acceptFixup, spliceMissing, spliceThoughts, fixupConfigInputs } from "../model/fixup.js";
import { importForeign, proposeImportedRules } from "../model/import/index.js";
import { SECTIONS } from "../model/sections/registry.js";
import { rollTurnDice, withFudges, fudgesForGeneration, diceFromBlock } from "../model/dice.js";

export { generationBase, importFromLegacyNotebook };

// ── Settings (global) and chat data (per chat) ──────────────────────────────

export const SKIP_TYPES = new Set(["quiet", "impersonate", "first_message"]);

const DEFAULT_SECTIONS = { scene: true, relationships: true, notebook: true, ...Object.fromEntries(SECTIONS.map(sec => [sec.key, true])) };
export const DEFAULT_SETTINGS = { enabled: true, stickyNotices: true, fixupMode: "full", fixupHistory: 4, depth: 1, role: 0, placement: "auto", theme: "frankenstein", checkStyle: "dnd", config: {} };

/** DEFAULT_SETTINGS plus the 0.1 migration. Returns a new object; the input is not touched. */
export function normalizeSettings(raw) {
    const s = { ...DEFAULT_SETTINGS, config: {}, ...(raw || {}) };
    if (!s.sections) {
        // 0.1 had one switch per part; carry the reader's choices over.
        s.sections = {
            scene: s.clock !== false,
            relationships: s.relations !== false,
            notebook: s.notebook !== false,
        };
        delete s.clock; delete s.relations; delete s.notebook;
    }
    s.sections = { ...DEFAULT_SECTIONS, ...s.sections };
    return s;
}

/**
 * The per-chat document, created on first use. `meta` is the object the host persists
 * (ST: chat_metadata; LocalChar: `{ storyLedger: <the extension row> }`); the document is
 * kept inside it and returned, so a host that saves `meta` saves the document.
 */
export function normalizeChatData(meta) {
    if (!meta.storyLedger) {
        // A chat that ran the Megumin fork keeps its notebook.
        const legacy = meta.meguminNotebook;
        meta.storyLedger = { notebook: legacy ? { ...emptyNotebook(), ...legacy } : emptyNotebook() };
    }
    const d = meta.storyLedger;
    d.notebook = { ...emptyNotebook(), ...(d.notebook || {}) };
    if (d.fudges === undefined) d.fudges = null;
    // d.ctOffset / d.corrections are 0.1's replay inputs. They are kept: a 0.1 chat with
    // no block yet is replayed from its comments with them (initialState).
    return d;
}

export const activeRules = nb => (nb.enabled === false ? [] : nb.rules);

export const engineConfig = (settings, userName, extra = {}) => ({
    ...resolveConfig(settings.config), userName,
    sections: settings.sections, checkStyle: settings.checkStyle, ...extra,
});

// ── The state before message `index` ────────────────────────────────────────

/**
 * { state, errors } — errors are rows of the previous block that no longer parse. A clock
 * correction from the popup that is newer than that block is the story time (so due
 * setups are judged by the corrected time, the same one the model is told).
 */
export function startOf(chat, index, config, chatData) {
    const d = chatData;
    const found = latestState(chat, index, config);
    if (found) return { state: withClockOverride(found.state, d.notebook.clockOverride, found.index), errors: found.errors };
    const s = initialState(chat.slice(0, index), config, { ctOffset: d.ctOffset ?? null, corrections: d.corrections || [] });
    if (!s.threads.length && d.notebook.threads.length) s.threads = [...d.notebook.threads];   // reader's starting list
    return { state: withClockOverride(s, d.notebook.clockOverride, -1), errors: [] };
}

export const stateBefore = (chat, index, config, chatData) => startOf(chat, index, config, chatData).state;

export function blockFor(state, { settings, chatData, userName }) {
    return renderBlock(state, { rules: activeRules(chatData.notebook), config: engineConfig(settings, userName), sections: settings.sections });
}

// ── What the model reads ────────────────────────────────────────────────────

// What a turn tells the model about the story before message `c.length`: the state, and the four texts built from it.
export function ledgerPromptParts(c, config, chatData, settings) {
    const nb = chatData.notebook;
    const state = stateBefore(c, c.length, config, chatData);
    const time = storyTime(c, nb);
    if (state.scene.now && (!time.now || time.now.source !== "reader")) time.now = { text: state.scene.now, source: "notebook" };
    const statePrompt = renderStatePrompt(state, {
        notebook: nb.enabled === false ? { ...nb, rules: [], inbox: [] } : nb, config, sections: settings.sections, time,
    });
    return { state, statePrompt, rules: renderRules(config), template: buildTemplate(config), facts: renderTurnFacts(state, config) };
}

export const mergeTurnDice = (shown, fallback) => ({
    fate: shown.fate || fallback.fate,
    world: Number.isInteger(shown.world) ? shown.world : fallback.world,
    checks: Array.isArray(shown.checks) ? [...shown.checks] : [...fallback.checks],
});

/**
 * This generation's dice and the fudge lifecycle. `pendingSame` is the host's pending turn
 * for this chat and reply index, if it has one (a continue reuses its dice). Returns the
 * pending record to keep, and the fudges to store (`fudgesChanged` says whether they differ).
 * Call only for a generation that gets ledger work (not SKIP_TYPES, ledger on).
 */
export function prepareTurn({ chat, type, settings, chatData, pendingSame = null, rng }) {
    const index = generationBase(chat.length, type);
    const fresh = rollTurnDice(rng);
    const baseDice = type === "continue"
        ? mergeTurnDice(diceFromBlock(chat[index]?.mes), pendingSame?.dice || fresh)
        : fresh;
    const stored = chatData.fudges;
    const lifecycle = fudgesForGeneration(stored, index);
    const applied = withFudges(baseDice, lifecycle.active);
    return {
        pending: { index, dice: applied.dice, fudges: lifecycle.active, fudged: applied.fudged },
        fudgesNext: lifecycle.next,
        fudgesChanged: JSON.stringify(lifecycle.next) !== JSON.stringify(stored),
    };
}

/**
 * The injection for a generation: { text, reminder, chatDataPatch, notices }. `text` is the
 * <story_ledger> block (with the reminder appended when placement is "macro"), `reminder`
 * the in-chat reminder; both before macro substitution. The raw chat is used, never a host's
 * prompt-side copy, because prompt-side regex may already have trimmed the blocks out of that.
 * `pending` is the pending turn for THIS generation's reply index, or null. A fix-up passes
 * the `givenConfig` its reply was built with and the `kase` it is asking for.
 */
export function buildInjection({ chat: raw, type = "normal", settings: s, chatData, userName, pending = null, kase = null, givenConfig = null }) {
    const none = { text: "", reminder: "", chatDataPatch: null, notices: [] };
    if (!s.enabled || SKIP_TYPES.has(type)) return none;
    const base = generationBase(raw.length, type);
    const c = raw.slice(0, base);
    const active = givenConfig ? null : pending;
    const config = givenConfig || engineConfig(s, userName, active ? {
        dice: active.dice, fudges: active.fudges, fudgedDice: active.fudged, rolls: active.dice.checks,
    } : {});
    const reminderType = kase ? "ledger" : type;
    const { state, statePrompt, rules, template, facts } = ledgerPromptParts(c, config, chatData, s);
    const parts = [];
    let chatDataPatch = null;
    const notices = [];
    const duty = buildLedgerDuty(config, reminderType);
    if (duty) parts.push(duty);
    if (needsHandover(c)) {
        // the importer already read what it could; the model is asked only for the rest
        const imp = importForeign(c, config);
        parts.push(buildHandover(imp.imported, { hasNow: Boolean(state.scene.now), sections: s.sections, unread: imp.unread }));
        const r = proposeImportedRules(chatData.notebook, imp.rules, chatData.imported);
        if (r.done && !chatData.imported) {
            chatDataPatch = { notebook: r.notebook, imported: { source: imp.source, index: imp.index } };
            notices.push({ kind: "info", title: "📒 Story Ledger", text: `${imp.rules.length} rule(s) from the previous preset are waiting in the 📜 Rules inbox.` });
        }
    }
    if (statePrompt) parts.push(statePrompt);
    parts.push(rules);
    parts.push(template);
    if (facts) parts.push(facts);
    const reminder = buildGenerationReminder(state, config, reminderType, { kase });
    const appended = s.placement === "macro" ? `\n\n${reminder}` : "";
    return { text: `<story_ledger>\n${parts.join("\n\n")}\n</story_ledger>${appended}`, reminder, chatDataPatch, notices };
}

// ── Writing the block into a reply ──────────────────────────────────────────

/**
 * Recompute message `index`'s block from the block before it and its own comment. Returns
 * null for a message that gets none (a user or system message), else
 * { mes, notices, chatDataPatch }: the host writes `mes` into the reply (and its swipe),
 * saves, applies the patch, and shows the notices. Warnings are returned every time, so a
 * ↻ rebuild that meets the same problem says so again; rule proposals are only collected
 * when the reply arrives (`collect`), since rule numbers may have moved since.
 * `pending` is the pending turn for this reply index, or null; a fix-up hands in the
 * `givenConfig` it already settled; `proposalSource` names where a proposal came from.
 */
export function rebuildMessage({ chat: c, index, settings: s, chatData, userName, pending = null, collect = true, givenConfig = null, proposalSource }) {
    const msg = c[index];
    if (!msg || msg.is_user || msg.is_system) return null;
    // A received reply takes the dice rolled for it (same chat, same reply); ↻ rebuild keeps
    // the dice its block already shows. A fix-up hands in the config it already settled.
    const config = givenConfig || (() => {
        const dice = pending ? pending.dice : diceFromBlock(msg.mes);
        const saved = chatData.fudges;
        const fudges = pending ? pending.fudges : (saved && saved.appliedTo === index ? saved : null);
        return engineConfig(s, userName, { dice, fudges, fudgedDice: pending ? pending.fudged : withFudges(dice, fudges).fudged, rolls: dice.checks || [] });
    })();
    const start = startOf(c, index, config, chatData);
    const prev = start.state;
    // Read the comment with every block taken out: after a continue, the rest of a
    // cut-off comment sits after the block, and the block's own "-->" would end it early.
    const changes = parseChanges(stripBlocks(msg.mes));
    const { state, log, unparsed, warnings } = postTurn(prev, changes, config);
    const mes = writeBlockInto(msg.mes, blockFor(state, { settings: s, chatData, userName }));

    const notices = [];
    let chatDataPatch = null;
    const note = (kind, title, text) => notices.push({ kind, title, text });
    if (start.errors.length) note("warning", "📒 Story Ledger", `${start.errors.length} row(s) in the previous block could not be read and kept their earlier values: ${start.errors.map(e => `${e.section}: ${e.row}`).join("; ")}`);
    if (!changes) {
        note("warning", "📒 Story Ledger", "No ledger comment in this reply — the turn still advanced. Press ✎ on the block to have it written, or swipe.");
        return { mes, notices, chatDataPatch };
    }
    if (s.sections.scene) {
        const back = dayRegression([prev.scene.now, state.scene.now]);
        if (back) note("warning", "🕰️ Story clock", `The story went from Day ${back.from} back to Day ${back.to}. Swipe, or edit the block's Now line.`);
    }
    const refused = relationsNotice(log, changes.relations.unparsed);
    if (s.sections.relationships && refused) note("info", "💞 Story Ledger", refused);
    const unread = unreadNotices(changes, unparsed, s.sections, warnings);
    if (unread.length) note("info", "📒 Story Ledger", `Could not apply: ${unread.map(u => `${u.section}: "${u.line}"${u.reason ? ` — ${u.reason}` : ""}`).join("; ")}`);
    for (const w of warnings || []) if (!unread.some(u => u.section === w.section && u.line === w.line)) note("warning", w.section === "Chekhov" ? "🔫 Story Ledger" : "📒 Story Ledger", w.text);
    if (collect && s.sections.notebook && changes.proposals.length) {
        const before = chatData.notebook;
        const cannot = [];
        const after = collectProposals(before, changes.proposals, proposalSource, cannot);
        const added = after.inbox.length - before.inbox.length;
        if (added > 0) {
            chatDataPatch = { notebook: after };
            note("info", "📜 Story Ledger", `${added} rule proposal${added > 1 ? "s" : ""} waiting.`);
        }
        if (cannot.length) note("info", "📜 Story Ledger", `Could not apply: ${cannot.map(x => `${x.section}: "${x.line}" (${x.reason})`).join("; ")}`);
    }
    return { mes, notices, chatDataPatch };
}

// ── Ledger fix-up ───────────────────────────────────────────────────────────

/** "missing", "thoughts" or null: what ✎ would ask for on message `index`. Only the last reply, and only while idle (`busy`). */
export function fixupCaseFor({ chat, index, settings, busy }) {
    const msg = chat[index];
    if (busy || !settings.enabled || !msg || index !== chat.length - 1 || msg.is_user || msg.is_system) return null;
    return needsFixup(msg.mes, settings.sections);
}

/** The dice and fudges the reply already has: a fix-up never rolls, merges or consumes any. */
export function fixupConfig({ chat, index, settings, chatData, userName }) {
    const { dice, fudges } = fixupConfigInputs(chat[index].mes, chatData.fudges, index);
    return engineConfig(settings, userName, { dice, fudges, fudgedDice: withFudges(dice, fudges).fudged, rolls: dice.checks || [] });
}

// Every ledger comment of a message, finished or cut off, removed (history shows prose only).
export const withoutLedger = mes => stripBlocks(mes).replace(/<!--\s*Story_Ledger\b[\s\S]*?(?:-->|$)/gi, "").trim();

/** The lean prompt's input for the reply `run` started from. State comes from before the reply. */
export function leanInputs({ chat, index, run, settings, chatData, userName, mainPrompt, characters, personaName, summary, substitute = text => text }) {
    const { state, statePrompt, rules, template, facts } = ledgerPromptParts(chat.slice(0, index), run.config, chatData, settings);
    const history = chat.slice(0, index).filter(m => !m.is_system)
        .map(m => ({ role: m.is_user ? "user" : "assistant", name: m.name, text: withoutLedger(m.mes) })).filter(m => m.text);
    return {
        mainPrompt,
        characters,
        personaName,
        summary,
        statePrompt: substitute(statePrompt), rules: substitute(rules),
        template: substitute(template), turnFacts: substitute(facts),
        history,
        historyCount: settings.fixupHistory,
        reply: { name: chat[index].name, text: stripBlocks(run.mes) },
        reminder: substitute(buildGenerationReminder(state, run.config, "ledger", { kase: run.kase })),
    };
}

/** Is the reply still exactly what the fix-up started from (Full mode: that plus the continuation)? */
export function fixupReplyUnchanged({ run, chat }) {
    const msg = chat[run.index];
    return Boolean(msg && run.index === chat.length - 1 && msg.swipe_id === run.swipeId
        && (run.mode === "full" ? String(msg.mes).startsWith(run.mes) : msg.mes === run.mes));
}

/**
 * Judge what a fix-up produced. `output` is the lean mode's text; Full mode reads the
 * continuation off the reply itself. { ok: true, mes } is the reply with the usable part
 * spliced in (the host then rebuilds its block); { ok: false, reason } means keep nothing.
 */
export function judgeFixup({ run, chat, settings, chatData, userName, output = null }) {
    void userName;
    const msg = chat[run.index];
    const accepted = acceptFixup(run.mode === "full" ? msg.mes.slice(run.mes.length) : output, run.kase, {
        sections: settings.sections, prev: stateBefore(chat.slice(0, run.index), run.index, run.config, chatData), config: run.config,
    });
    if (!accepted.ok) return { ok: false, reason: accepted.reason };
    const text = stripBlocks(run.mes);
    return { ok: true, mes: accepted.comment ? spliceMissing(text, accepted.comment) : spliceThoughts(text, accepted.thoughts) };
}

// ── The popup's HTML ────────────────────────────────────────────────────────

export const esc = s => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

export function fudgeSummary(fudge) {
    const parts = [];
    if (fudge.dice) parts.push(...Object.keys(fudge.dice));
    if (fudge.calm) parts.push("calm");
    if (fudge.tier) parts.push(fudge.tier);
    if (fudge.source) parts.push(fudge.source);
    if (fudge.fire) parts.push(`fire ${fudge.fire}`);
    return parts.length ? parts.join(", ") : "none";
}

export const hasFudgeSettings = fudge => Object.keys(fudge || {}).some(key => key !== "appliedTo");

function pairCard(state, from, to, config) {
    const rel = { ct: state.ct, pairs: state.rel.pairs, selves: state.rel.selves };
    const d = describePair(rel, from, to, config);
    const rows = config.axes.filter(a => a.kind === "fond").map(f => {
        const m = config.axes.find(a => a.key === f.mirror);
        const fv = d.axes[f.key], mv = d.axes[m.key];
        const val = v => `<b>${v.value}</b>${v.acc ? `<small> +${v.acc}</small>` : ""}`;
        return `<div class="sl-row">
            <span class="sl-lab sl-fond" title="${esc(f.meaning)}">${esc(f.name)} ${val(fv)}</span>
            <span class="sl-bar sl-bar-fond"><i style="width:${(fv.value / config.axisMax) * 100}%"></i></span>
            <span class="sl-bar sl-bar-friction"><i style="width:${(mv.value / config.axisMax) * 100}%"></i></span>
            <span class="sl-lab sl-friction" title="${esc(m.meaning)}">${val(mv)} ${esc(m.name)}</span>
        </div>`;
    }).join("");
    const chips = [
        `<span class="sl-chip">Φ(${esc(from)}) ${d.phi}</span>`,
        `<span class="sl-chip ${d.romance === "allowed" ? "sl-ok" : "sl-locked"}">romance ${d.romance}</span>`,
        ...d.walls.map(w => `<span class="sl-chip sl-wall">WALL ${esc(w)}</span>`),
        ...d.patterns.map(p => `<span class="sl-chip sl-pattern" title="${esc(PATTERN_GLOSS[p])}">${esc(p)}</span>`),
    ].join("");
    return `<div class="sl-pair"><div class="sl-pair-head"><b>${esc(from)} → ${esc(to)}</b></div>
        <div class="sl-chips">${chips}</div>
        <div class="sl-mirror-head"><span>fondness</span><span>friction</span></div>${rows}</div>`;
}

/**
 * The popup's HTML for one tab. `view` is everything the host read: { chat, settings,
 * chatData, userName }. `previewBaseDice` is the Next-turn tab's rolled dice (rolled here when
 * absent). Both hosts render this same string and wire the same `data-` / `id` hooks.
 */
export function popupHtml(tab, view, previewBaseDice = null) {
    const { chat: c, settings: s, chatData, userName } = view;
    const config = engineConfig(s, userName);
    const nb = chatData.notebook;
    const state = stateBefore(c, c.length, config, chatData);
    const lines = text => String(text || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    void lines;
    const T = (id, label) => `<button class="sl-tab${tab === id ? " sl-on" : ""}" data-sl-popup-tab="${id}">${label}</button>`;
    let body = "";
    if (tab === "rules") {
        const inbox = nb.inbox.map(i => `<div class="sl-item${i.stale ? " sl-stale" : ""}">
            <div>${i.op === "add" ? `<b>Add</b> ${esc(i.text)}` : i.op === "edit" ? `<b>Edit</b> “${esc(i.targetText)}”<br>→ ${esc(i.text)}` : `<b>Remove</b> “${esc(i.targetText)}”${i.text ? `<br><i>${esc(i.text)}</i>` : ""}`}${i.stale ? "<br><small>The rule this pointed at no longer exists.</small>" : ""}</div>
            <div class="sl-btns">${i.stale ? "" : `<button class="menu_button sl-approve" data-id="${i.id}">Approve</button>`}<button class="menu_button sl-reject" data-id="${i.id}">${i.stale ? "Dismiss" : "Reject"}</button></div>
        </div>`).join("") || "<p><i>No proposals waiting.</i></p>";
        body = `<label class="checkbox_label"><input type="checkbox" id="sl-nb-enabled" ${nb.enabled === false ? "" : "checked"}> Use the notebook in this chat</label>
            <h4>Rules [R] <small>— one per line, sent verbatim every turn. Only you change these.</small></h4>
            <textarea id="sl-rules" class="text_pole" rows="12">${esc(nb.rules.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-rules">Save rules</button>
                <button class="menu_button" id="sl-import" title="Fill the boxes from the newest Freaky/Realistic Frankenstein, Sola, Ancient Access or Megumin-fork notebook in this chat. Rules are not saved until you press Save.">Import from previous preset</button></div>
            <h4>Proposals from the model</h4>${inbox}`;
    } else if (tab === "threads") {
        body = `<h4>Open threads [T] <small>— kept in the newest reply's block; edit them there</small></h4>
            <ul class="sl-list">${state.threads.map(t => `<li>${esc(t)}</li>`).join("") || "<li><i>None yet.</i></li>"}</ul>
            <h4>Starting list <small>— used only until the first reply carries a block</small></h4>
            <textarea id="sl-threads" class="text_pole" rows="6">${esc(nb.threads.join("\n"))}</textarea>
            <div class="sl-btns"><button class="menu_button" id="sl-save-threads">Save as starting list</button></div>`;
    } else if (tab === "clock") {
        const time = storyTime(c, nb);
        const now = time.now && time.now.source === "reader" ? time.now : (state.scene.now ? { text: state.scene.now, source: "notebook" } : time.now);
        const label = { notebook: "from the newest block", world_state: "from World State", ff_header: "from an old header", reader: "your correction — used until the next reply states a time" };
        body = `<h4>🕰️ Story clock</h4>
            <div>${now ? `<b>${esc(now.text)}</b> <small>(${label[now.source] || now.source})</small>` : "<i>No time stated yet.</i>"}</div>
            ${time.timeline.length > 1 ? `<div class="sl-timeline">${time.timeline.map(esc).join(" → ")}</div>` : ""}
            <div class="sl-btns"><input type="text" id="sl-clock" class="text_pole" placeholder="Correct the time, e.g. Day 12 — Tuesday, 21:44 | the lawn" value="${esc(nb.clockOverride ? nb.clockOverride.text : "")}">
                <button class="menu_button" id="sl-clock-set">Set correction</button>${nb.clockOverride ? `<button class="menu_button" id="sl-clock-clear">Clear</button>` : ""}</div>`;
    } else if (tab === "dice") {
        const dice = previewBaseDice || rollTurnDice();
        const fudge = chatData.fudges || {};
        const locks = fudge.dice || {};
        const die = (key, label, value, locked) => `<label class="sl-die"><span>${label}</span>
            <input type="number" class="text_pole sl-num" data-fudge-value="${key}" min="1" max="20" step="1" value="${esc(value)}">
            <input type="checkbox" data-fudge-lock="${key}" ${locked ? "checked" : ""}> lock</label>`;
        const checksLocked = Array.isArray(locks.checks) && locks.checks.length === 3;
        const checksValues = checksLocked ? locks.checks : dice.checks;
        const bulletOptions = (state.chekhov?.bullets || []).map(b => `<option value="${esc(b.id)}" ${fudge.fire === b.id ? "selected" : ""}>${esc(b.id)} — ${esc(b.desc)}</option>`).join("");
        const oldFire = fudge.fire && fudge.fire !== "none" && !(state.chekhov?.bullets || []).some(b => b.id === fudge.fire)
            ? `<option value="${esc(fudge.fire)}" selected>${esc(fudge.fire)} (not active)</option>` : "";
        const initialApplied = withFudges(dice, fudge);
        const initialFacts = renderTurnFacts(state, engineConfig(s, userName, { dice: initialApplied.dice, fudges: fudge, fudgedDice: initialApplied.fudged, rolls: initialApplied.dice.checks }));
        body = `<p class="sl-meta">Lock dice or outcomes for the next reply. Swipes and continues of that reply keep these controls.</p>
            <h4>Turn dice <small>— unlocked dice roll again when generation starts</small></h4>
            <div class="sl-dice-grid">
                ${die("fate.a", "Fate A", hasOwn(locks, "fate.a") ? locks["fate.a"] : dice.fate.a, hasOwn(locks, "fate.a"))}
                ${die("fate.b", "Fate B", hasOwn(locks, "fate.b") ? locks["fate.b"] : dice.fate.b, hasOwn(locks, "fate.b"))}
                ${die("fate.c", "Fate C", hasOwn(locks, "fate.c") ? locks["fate.c"] : dice.fate.c, hasOwn(locks, "fate.c"))}
                ${die("world", "World", hasOwn(locks, "world") ? locks.world : dice.world, hasOwn(locks, "world"))}
                <label class="sl-die sl-check-dice"><span>Checks</span>${checksValues.map((value, i) => `<input type="number" class="text_pole sl-num" data-fudge-check="${i}" min="1" max="20" step="1" value="${esc(value)}">`).join("")}
                    <input type="checkbox" data-fudge-lock="checks" ${checksLocked ? "checked" : ""}> lock all 3</label>
            </div>
            <h4>Outcome controls</h4>
            <div class="sl-dice-grid">
                <label>Tier <select class="text_pole" id="sl-fudge-tier"><option value="">Auto</option>${["AMBIENT", "MINOR", "MAJOR"].map(x => `<option value="${x}" ${fudge.tier === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
                <label>Source <select class="text_pole" id="sl-fudge-source"><option value="">Auto</option>${["TRUE", "WEIGHTED"].map(x => `<option value="${x}" ${fudge.source === x ? "selected" : ""}>${x}</option>`).join("")}</select></label>
                <label class="checkbox_label"><input type="checkbox" id="sl-fudge-calm" ${fudge.calm ? "checked" : ""}> Calm (AMBIENT + TRUE)</label>
                <label>Fire <select class="text_pole" id="sl-fudge-fire"><option value="">Auto</option><option value="none" ${fudge.fire === "none" ? "selected" : ""}>None</option>${oldFire}${bulletOptions}</select></label>
            </div>
            <div class="sl-btns"><button class="menu_button" id="sl-reroll-unlocked">Re-roll unlocked</button>
                <button class="menu_button" id="sl-save-fudges">Save for next turn</button><button class="menu_button" id="sl-clear-fudges">Clear fudges</button></div>
            <h4>Preview</h4><pre id="sl-turn-preview" class="sl-turn-preview">${esc(initialFacts || "No turn facts for the enabled sections.")}</pre>`;
    } else if (tab === "quests") {
        const found = latestState(c, c.length, config);
        const questsOff = s.sections.quests === false;
        if (!found) body = "<p><i>No reply carries a Story Ledger block yet — quests appear here once one does.</i></p>";
        else {
            const qs = found.state.quests || [];
            const done = qs.filter(q => q.status !== "active");
            const row = q => `<div class="sl-item"><div><b>${esc(q.id)} ${esc(q.kind)}</b> · ${esc(q.status)} — ${esc(q.objective)}${q.progress ? ` <small>(${esc(q.progress)})</small>` : ""}</div>${
                q.status === "active" ? "<small>active — always sent</small>"
                    : `<label class="checkbox_label"><input type="checkbox" class="sl-send" data-id="${esc(q.id)}" ${q.send ? "checked" : ""} ${questsOff ? "disabled" : ""}> Send to the model</label>`}</div>`;
            body = `${questsOff ? `<p class="sl-meta"><b>The 📜 Quests section is switched off in Settings</b> — quests are not tracked or sent; switch it back on to change these.</p>` : ""}<p class="sl-meta">Every quest stays in the block for you. Active quests always reach the model; a finished one only when you tick it.</p>
                ${done.length ? `<label class="checkbox_label"><input type="checkbox" id="sl-send-all" ${done.every(q => q.send) ? "checked" : ""} ${questsOff ? "disabled" : ""} data-mixed="${done.some(q => q.send) && !done.every(q => q.send) ? 1 : 0}"> <b>Send all finished quests</b></label>` : ""}
                ${qs.map(row).join("") || "<p><i>No quests yet.</i></p>"}`;
        }
    } else if (tab === "rel") {
        const here = new Set([...state.scene.present, config.userName]);
        const pairs = Object.values(state.rel.pairs).sort((a, b) => (here.has(b.from) || here.has(b.to)) - (here.has(a.from) || here.has(a.to)));
        body = `<div class="sl-meta">Turn ${state.ct} · present: ${state.scene.present.map(esc).join(", ") || "—"}</div>
            <p class="sl-meta">Edit the numbers in the newest reply's block to correct them; the next turn starts from your edit.</p>
            ${pairs.map(p => pairCard(state, p.from, p.to, config)).join("") || "<p><i>No relationships yet. The model creates them with NEW lines; on a chat that ran another preset, the first reply calibrates them from its old state.</i></p>"}`;
    } else {
        const cf = config;
        const axisRows = cf.axes.map(a => `<tr><td title="${esc(a.meaning)}">${esc(a.name)} (${a.key})</td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="period" value="${a.period}"></td><td><input type="number" class="text_pole sl-num" data-cfg-axis="${a.key}" data-field="threshold" value="${a.threshold}"></td></tr>`).join("");
        const decayRows = cf.decay.map((d, i) => `<tr><td>${d.pair.join(" ↔ ")}</td><td><input type="number" class="text_pole sl-num" data-cfg-decay="${i}" value="${d.period}"></td></tr>`).join("");
        const num = (k, label) => `<label>${label} <input type="number" class="text_pole sl-num" data-cfg="${k}" value="${cf[k]}"></label>`;
        const sec = { scene: "🕰️ Scene & story clock", relationships: "💞 Relationships", notebook: "📓 Rules notebook & threads",
            ...Object.fromEntries(SECTIONS.map(x => [x.key, typeof x.title === "function" ? x.title({ checkStyle: s.checkStyle }) : x.title])) };
        body = `<label class="checkbox_label"><input type="checkbox" data-set="enabled" ${s.enabled ? "checked" : ""}> Story Ledger on</label>
            <label class="checkbox_label" title="Warnings about a reply stay on screen until closed, so they are not missed while you are in another tab"><input type="checkbox" data-set="stickyNotices" ${s.stickyNotices !== false ? "checked" : ""}> Keep reply warnings until dismissed</label>
            <div class="sl-grid"><label>Ledger fix-up context <select class="text_pole" data-set="fixupMode">
                    <option value="full" title="Sends the whole normal prompt. If your provider caches prompts, much of it may be a cache hit." ${s.fixupMode !== "lean" ? "selected" : ""}>Full</option>
                    <option value="lean" title="Sends a short prompt (system, cards, summaries, recent messages). Fewer input tokens on long chats, but it does not reuse the chat's cached prefix." ${s.fixupMode === "lean" ? "selected" : ""}>Lean</option></select></label>
                <label id="sl-fixup-history" ${s.fixupMode === "lean" ? "" : 'style="display:none"'}>Recent messages <input type="number" class="text_pole sl-num" data-set="fixupHistory" value="${s.fixupHistory}" min="0" max="20"></label></div>
            <h4>Sections</h4>
            ${Object.entries(sec).map(([k, label]) => `<label class="checkbox_label"><input type="checkbox" data-section="${k}" ${s.sections[k] ? "checked" : ""}> ${label}</label>`).join("")}
            <h4>Look</h4>
            <div class="sl-grid"><label>Theme <select class="text_pole" data-set="theme">${[["frankenstein", "Frankenstein"], ["sola", "Sola"], ["megumin", "Megumin"]].map(([v, l]) => `<option value="${v}" ${(s.theme || "frankenstein") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
                <label>Check style <select class="text_pole" data-set="checkStyle"><option value="dnd" ${s.checkStyle !== "arrow" ? "selected" : ""}>DnD (locked DC)</option><option value="arrow" ${s.checkStyle === "arrow" ? "selected" : ""}>Wind's Arrow (Sola)</option></select></label></div>
            <h4>Prompt placement</h4>
            <div class="sl-grid">
                <label>Placement <select class="text_pole" data-set="placement"><option value="auto" ${s.placement === "auto" ? "selected" : ""}>automatic, in chat at depth</option><option value="macro" ${s.placement === "macro" ? "selected" : ""}>only where a preset uses {{story_ledger}}</option></select></label>
                <label>Depth <input type="number" class="text_pole sl-num" data-set="depth" value="${s.depth}" min="0"></label>
                <label>Role <select class="text_pole" data-set="role"><option value="0" ${+s.role === 0 ? "selected" : ""}>system</option><option value="1" ${+s.role === 1 ? "selected" : ""}>user</option><option value="2" ${+s.role === 2 ? "selected" : ""}>assistant</option></select></label>
            </div>
            <h4>Relationship engine numbers <small>— FrankenSIM 3.0's defaults; they apply from the next reply on</small></h4>
            <div class="sl-grid">${num("tickCap", "Tick cap / acc / turn")}${num("directMax", "DIRECT max")}${num("axisMin", "Axis min")}${num("axisMax", "Axis max")}${num("decayLead", "Decay gap")}${num("floorDivisor", "Floor divisor")}${num("floorMax", "Floor max")}${num("wallMin", "WALL min")}${num("gravityMin", "Gravity Well min")}</div>
            <div class="sl-grid"><label>Romance gate E ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="E" value="${cf.romanceGate.E}"></label><label>or L ≥ <input type="number" class="text_pole sl-num" data-cfg-gate="L" value="${cf.romanceGate.L}"></label>
                <label>Offstage skip values <input type="text" class="text_pole" data-cfg-skip value="${cf.offstageSkip.join(", ")}"></label></div>
            <div class="sl-grid"><label>Φ period <input type="number" class="text_pole sl-num" data-cfg-phi="period" value="${cf.phi.period}"></label><label>Φ threshold <input type="number" class="text_pole sl-num" data-cfg-phi="threshold" value="${cf.phi.threshold}"></label><label>Φ acc cap <input type="number" class="text_pole sl-num" data-cfg-phi="accCap" value="${cf.phi.accCap}"></label></div>
            <table class="sl-table"><tr><th>Axis</th><th>Convert every N turns</th><th>at accumulator ≥</th></tr>${axisRows}</table>
            <table class="sl-table"><tr><th>Mirror decay</th><th>every N turns</th></tr>${decayRows}</table>
            <h4>🔫 Chekhov's Gun</h4>
            <div class="sl-grid">
                <label>Who fires bullets <select class="text_pole" data-chk-firing>
                    <option value="model" ${cf.sectionConfig.chekhov.firing === "model" ? "selected" : ""}>The model, when the moment is right</option>
                    <option value="fate" ${cf.sectionConfig.chekhov.firing === "fate" ? "selected" : ""}>Fate's pick</option></select></label>
                ${[["eligibleAge", "Eligible from age"], ["pruneAge", "Prune at age"], ["cap", "Active cap"], ["maxLoadsPerTurn", "Loads per reply"], ["firedKeep", "Fired kept (0 = all)"]]
                    .map(([k, label]) => `<label>${label} <input type="number" min="${k === "eligibleAge" || k === "firedKeep" ? 0 : 1}" class="text_pole sl-num" data-chk="${k}" value="${cf.sectionConfig.chekhov[k]}"></label>`).join("")}
            </div>
            <h4>🎲 Fate & World Sim</h4>
            <div class="sl-grid">${[["deferredExpire", "Deferred expiry"], ["worldKeep", "World entries kept"], ["reach1Drop", "Drop Reach 1 at age"], ["pursuitLimit", "Pursuit limit"], ["residueKeep", "Residue lines kept"]]
                .map(([k, label]) => `<label>${label} <input type="number" min="1" class="text_pole sl-num" data-fate="${k}" value="${cf.sectionConfig.fate[k]}"></label>`).join("")}</div>
            <h4>🎖️ Titles</h4>
            <div class="sl-grid">${[["softCap", "Soft cap", 0, 20], ["hardCap", "Hard cap", 0, 20], ["situationalMax", "Situational max", 0, 5], ["retrofitBatch", "Retrofit per turn", 1, 30]]
                .map(([k, label, min, max]) => `<label>${label} <input type="number" min="${min}" max="${max}" class="text_pole sl-num" data-titles="${k}" value="${cf.sectionConfig.titles[k]}"></label>`).join("")}</div>
            <div class="sl-btns"><button class="menu_button" id="sl-save-config">Save engine numbers</button><button class="menu_button" id="sl-reset-config">Reset to defaults</button></div>`;
    }
    return `<div class="sl-popup">
        <h3>📒 Story Ledger</h3>
        <div class="sl-tabs sl-popup-tabs">${T("rules", "📜 Rules")}${T("threads", "🧵 Threads")}${T("clock", "🕰️ Clock")}${T("quests", "🗺️ Quests")}${T("rel", "💞 Relationships")}${T("dice", "🎲 Next turn")}${T("settings", "⚙️ Settings")}</div>
        <div class="sl-popup-body">${body}</div>
    </div>`;
}
