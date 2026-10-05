// ──────────────────────────────────────────────────────────────────────────────
// What the model reads: the state from the newest block (rules, threads, time,
// relationships), the rules for reporting changes, the comment template, and the
// one-time handover from another preset. Plus keeping state blocks and old
// comments out of the prompt. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { notebookBody, renderNotebookPrompt, LEDGER_BLOCK_RE } from "./notebook.js";
import { describePair, PATTERN_GLOSS } from "./relations.js";
import { findBlock, BLOCK_MARK } from "./block.js";
import { enabledSections, needsPresent } from "./sections/registry.js";
import { sectionContext, preTurnFacts } from "./turn.js";

const COMMENT_RE = new RegExp(LEDGER_BLOCK_RE.source, "gi");

/** Compact relationship state for every pair with at least one member present. "" when none. */
function renderRelations(state, config) {
    const here = new Set([...(state.scene.present || []), ...(config.userName ? [config.userName] : [])]);
    const rel = { ct: state.ct, pairs: state.rel.pairs, selves: state.rel.selves };
    const lines = [];
    for (const p of Object.values(state.rel.pairs)) {
        if (!here.has(p.from) && !here.has(p.to)) continue;
        const d = describePair(rel, p.from, p.to, config);
        const fmt = kind => config.axes.filter(a => a.kind === kind)
            .map(a => `${a.key} ${d.axes[a.key].value} ${d.axes[a.key].tier}${d.axes[a.key].acc ? ` (acc ${d.axes[a.key].acc})` : ""}`).join(" · ");
        const flags = [`romance ${d.romance}`];
        if (d.walls.length) flags.push(`WALL ${d.walls.join(", ")}`);
        if (d.patterns.length) flags.push(`reads as ${d.patterns.map(id => `${id} (${PATTERN_GLOSS[id]})`).join(", ")}`);
        lines.push(`${p.from} → ${p.to} · Φ(${p.from}) ${d.phi} · ${flags.join(" · ")}\n  fondness: ${fmt("fond")}\n  friction: ${fmt("friction")}`);
    }
    if (!lines.length) return "";
    return ["Relationships (kept by the ledger — never recalculate or restate these numbers; report only this reply's events):", ...lines].join("\n");
}

/**
 * The state part of the injection. `time` is storyTime()'s result when the caller has
 * one (it carries the reader's clock override and the recent timeline); otherwise the
 * block's own Now line is the story time.
 */
export function renderStatePrompt(state, { notebook, config, sections, time = null }) {
    const parts = [];
    if (sections.notebook !== false || sections.scene !== false) {
        const t = time && time.now ? time : (state.scene.now ? { now: { text: state.scene.now, source: "notebook" }, timeline: [] } : null);
        const nb = renderNotebookPrompt(sections.notebook !== false ? notebook : { rules: [], inbox: [] }, sections.notebook !== false ? state.threads : [], sections.scene !== false ? t : null);
        if (nb) parts.push(nb);
    }
    if (sections.relationships !== false) {
        const rel = renderRelations(state, config);
        if (rel) parts.push(rel);
    }
    const ctx = sectionContext(state, state.scene.present, { ...config, sections });
    for (const sec of enabledSections(sections)) {
        if (!sec.carried) continue;
        const text = sec.prompt(state[sec.key] ?? sec.empty(), state, ctx);
        if (text) parts.push(text);
    }
    return parts.join("\n\n");
}

// Another preset's state block: Freaky/Realistic Frankenstein, Megumin, Sola, Ancient Access.
const FOREIGN_STATE = /<internal_states>|<!--\s*GFX_START\s*-->|<Blocks>|<sola_hud\b|<ledger\b/i;

/** True while the newest state-bearing AI reply was written under another preset. */
export function needsHandover(chat) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        const mes = m.mes || "";
        if (mes.includes(BLOCK_MARK) || notebookBody(mes) !== null) return false;
        if (FOREIGN_STATE.test(mes)) return true;
    }
    return false;
}

export const RELATIONSHIP_RULES = `<relationship_rules>
Every relationship line is how one character feels toward another — directional; {{user}}'s own feelings are the reader's and are never tracked. Twelve axes, 1–20, in opposed pairs: Eros/Misos (romantic), Ludus/Eris (playful), Philia/Echthros (friendship), Pragma/Stasis (practical), Storge/Adiaphora (familial), Agape/Phthonos (selfless / resentful giving). Φ is a character's own self-regard (−20…20): low Φ makes fondness hard to receive.
Fondness and friction coexist and tick independently; one interaction can tick both. You only report raw material — the ledger converts accumulators into axis changes on its own schedule. Write in the Relationships section:
- Ticks: \`A → B: E_acc +1 (reason) | M_acc +2 (reason)\` — +1 or +2 per accumulator, only for what happened in this reply. Friction map: romance hurt → M, cruelty → Er, broken trust → Ec, practical frustration → St, neglect → Ad, resentment → Pt.
- Self-regard: \`A: Φ_acc +1 (reason)\` or a negative value.
- \`DIRECT A → B: E +1 (reason)\` — only for a genuinely significant moment; it is what breaks a stalemate.
- \`NEW A → B: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2 (why)\` — the first time a relationship matters: every axis at least 3, values varied, friction outweighing fondness unless the card says otherwise.
Never state the numbers in prose; show them through behavior. Romantic or sexual initiation happens only where the ledger says romance is allowed; forcing it elsewhere meets discomfort or anger. "Reads as" patterns are interpretation, not rules.
</relationship_rules>`;

const TEMPLATE_HEAD = `At the very end of your reply, after the prose, write exactly one ledger comment as below. Report only what changed in this reply — the ledger keeps everything else and writes the full state block itself; never write a state block, <internal_states> or GFX markers yourself. Omit any section where nothing changed. The reader never sees the comment; never write "-->" inside it.`;

/** The comment template for the sections that are switched on, in block order. */
export function buildTemplate(config = {}) {
    const on = k => ((config.sections || {})[k] !== false);
    const ctx = { config, checkStyle: config.checkStyle || "dnd", sections: config.sections || {} };
    const lines = ["<!-- Story_Ledger"];
    const present = "Present: [every named character in the scene, comma separated]";
    if (on("scene")) lines.push(
        "Now: [story time after this reply, free text — e.g. Day 12 — Tuesday, March 4, 21:44 | the lawn. Day N counts from the story's first day and never resets.]",
        present,
        "Public: [yes when the scene is in a public or exposed place, else no]");
    else if (needsPresent(config.sections)) lines.push(present);
    if (on("notebook")) lines.push(
        "Threads:",
        "- + [T] [a thread that opened: an intention, open question, promise, debt, appointment with day and time, unresolved arc]",
        "- - [T] [a thread that resolved, written as it appears in the list]");
    if (on("relationships")) lines.push("Relationships:", "- [only this reply's events, as described in the relationship rules]");
    for (const sec of enabledSections(config.sections)) lines.push(...sec.template(ctx));
    if (on("notebook")) lines.push(
        "Proposed rules:",
        "- [ONLY when the story establishes a fact that must never drift, or the reader gives a lasting out-of-character instruction: `add: <rule>`, `edit R#: <new text>`, or `remove R#: <why>`]");
    lines.push("-->");
    return `${TEMPLATE_HEAD}\n${lines.join("\n")}`;
}

export const LEDGER_TEMPLATE = buildTemplate({ sections: {} });

/** How to judge what to report, for the sections that are switched on. */
export function renderRules(config = {}) {
    const ctx = { config, checkStyle: config.checkStyle || "dnd", sections: config.sections || {} };
    const parts = [];
    if ((config.sections || {}).relationships !== false) parts.push(RELATIONSHIP_RULES);
    for (const sec of enabledSections(config.sections)) {
        const r = sec.rules(ctx);
        if (r) parts.push(r);
    }
    return `<ledger_rules>\n${parts.join("\n\n")}\n</ledger_rules>`;
}

/** What this turn already holds before the reply is written: announcements and dice. "" when nothing. */
export function renderTurnFacts(state, config = {}) {
    const facts = preTurnFacts(state, config);
    if (!facts.length) return "";
    const head = [`Turn ${state.ct + 1}`, state.scene.now, state.scene.present.length ? `present: ${state.scene.present.join(", ")}` : ""].filter(Boolean).join(" · ");
    return `<story_ledger_turn>\n${head}\n${facts.join("\n")}\n</story_ledger_turn>`;
}

// What the handover asks the model for, per section the import may already have brought.
const HANDOVER_ASKS = [
    ["threads", "Threads: one `+ [T]` line for every open thread or [T] entry it holds."],
    ["agendas", "Agendas: a `new` line for every agenda it held, with its current step."],
    ["locations", "Locations: a `Name @ place` line for everyone it placed."],
    ["factions", "Factions: field lines for every faction it held."],
    ["quests", "Quests: a `+ Main|Side` line for every quest it held."],
    ["inv", "Inventory: a `+ item` line for every item {{user}} carried, plus titles and status."],
    ["cast", "Cast: field lines for everyone present — position, wearing, holding, condition."],
    ["chekhov", "Chekhov: a `load:` line for every planted setup it held (weight, hot, time lock)."],
    ["fate", "Fate/World: an open pursuit, deferred items and world happenings it held."],
];

/**
 * The one-time handover from another preset. The importer has already read what it
 * could (`imported`, section keys); the model is asked for relationships always,
 * Now only when no story time came across, and change lines only for the sections
 * that are on and were not imported.
 */
export function buildHandover(imported = [], { hasNow = false, sections = {}, unread = [] } = {}) {
    const have = new Set(imported);
    const on = k => (sections || {})[k] !== false;
    const lines = [
        "<ledger_handover>",
        "This chat ran under another preset until now. The story continues exactly where it stands; only the bookkeeping changes. The ledger has already read what it could from the newest state block in the history (a Freaky/Realistic Frankenstein <internal_states>, Megumin's <Blocks>, Sola's trackers, or Ancient Access's <ledger>). In this reply's Story_Ledger comment, add only what is still missing:",
    ];
    if (!hasNow && on("scene")) lines.push("- Now: from that state's time, date and place. Keep its Day number and continue counting from it.");
    if (on("relationships")) lines.push("- Relationships: one NEW line for every relationship that state tracked, calibrated from what it recorded (FF's BOND −5…20 with Sparks and Grudge, Megumin's Affection/Trust/Desire, Sola's named dynamics, AA's bonds) and from the story so far. High BOND means fondness on the axes that fit this relationship; Grudge and hostility mean friction.");
    for (const [key, ask] of HANDOVER_ASKS) if (on(key === "threads" ? "notebook" : key) && !have.has(key)) lines.push(`- ${ask}`);
    if (on("notebook")) lines.push("- Proposed rules: if the reader's notebook below does not already hold that state's [R] rules, propose each as add:.");
    if ((unread || []).length) lines.push(`- These parts of that block could not be read — carry them over with the change lines that fit: ${unread.join("; ")}.`);
    lines.push("Stop writing the old preset's state block from this reply on, even though it is still visible in the history.", "</ledger_handover>");
    return lines.join("\n");
}

export const HANDOVER = buildHandover([], { hasNow: false });

/** Remove every state block, and every ledger comment except the newest assistant message's own. Mutates. */
export function stripForPrompt(messages) {
    let newest = -1;
    messages.forEach((m, i) => {
        if (m && m.role === "assistant" && typeof m.content === "string" && notebookBody(m.content) !== null) newest = i;
    });
    messages.forEach((m, i) => {
        if (!m || typeof m.content !== "string") return;
        let text = m.content, at;
        while ((at = findBlock(text))) text = text.slice(0, at.start) + text.slice(at.end);
        if (m.role === "assistant" && i !== newest) text = text.replace(COMMENT_RE, "");
        if (text !== m.content) m.content = text.replace(/\s+$/, "");
    });
    return messages;
}

/**
 * Text completion: the whole prompt is one string. Remove every state block, and every
 * ledger comment except the last one in the chat — never touching the injected
 * <story_ledger> section, whose template looks like a comment.
 */
export function stripPromptText(text) {
    const parts = String(text || "").split(/(<story_ledger>[\s\S]*?<\/story_ledger>)/);
    const outside = i => i % 2 === 0;
    let lastPart = -1;
    parts.forEach((p, i) => { if (outside(i) && notebookBody(p) !== null) lastPart = i; });
    return parts.map((p, i) => {
        if (!outside(i)) return p;
        let t = p, at;
        while ((at = findBlock(t))) t = t.slice(0, at.start) + t.slice(at.end);
        if (i !== lastPart) return t.replace(COMMENT_RE, "");
        // keep only this part's last comment
        const all = [...t.matchAll(COMMENT_RE)];
        for (const m of all.slice(0, -1).reverse()) t = t.slice(0, m.index) + t.slice(m.index + m[0].length);
        return i === parts.length - 1 ? t.replace(/\s+$/, "") : t;
    }).join("");
}
