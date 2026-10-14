// ──────────────────────────────────────────────────────────────────────────────
// Rules Notebook — the pure half. (Local fork addition; not part of upstream.)
//
// Two lists with two owners:
//   rules    ([R]) constants the READER owns. The model never edits them; it can
//            only propose add/edit/remove, and a proposal waits in the inbox until
//            the reader approves it. Injected verbatim every turn.
//   threads  ([T]) open arcs the MODEL maintains. It rewrites the list inside a
//            <Notebook> block each turn; the newest AI reply that carries one is the
//            truth. Reading it at prompt time, from whichever swipe is current, makes
//            threads swipe-safe and edit-safe without bookkeeping.
//
// Nothing here touches SillyTavern, the DOM or storage, so it is tested with plain
// node (tests/notebook.test.mjs). The glue lives in ./index.js.
// ──────────────────────────────────────────────────────────────────────────────

import { ledgerLines } from "./normalize.js";
import { headingOf } from "./headings.js";
import { isCommandPlaceholder } from "./commands.js";

export const NOTEBOOK_TAG = "Story_Ledger";
// <Story_Ledger> is this extension's tag — deliberately not "<ledger>", which Ancient
// Access's tracker uses for a different block. <Notebook> is what the Megumin fork's
// block used, so a chat that ran the fork keeps its threads and clock.
const BLOCK_TAGS = "(?:Story_Ledger|Notebook)";

export function emptyNotebook() {
    return { enabled: true, rules: [], threads: [], inbox: [], rejected: [], nextId: 1 };
}

const norm = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const key = s => norm(s).toLowerCase();

// ── Reading the model's block ───────────────────────────────────────────────

// The block is normally written as an HTML comment, <!-- Story_Ledger … -->, because
// SillyTavern's renderer hides a finished comment completely, while an unknown tag
// is stripped but its contents are shown as prose. The tag forms are still read.
export const LEDGER_BLOCK_RE = new RegExp(
    `<!--\\s*Story_Ledger\\b([\\s\\S]*?)(?:-->|$)|<${BLOCK_TAGS}\\b[^>]*>([\\s\\S]*?)(?:<\\/${BLOCK_TAGS}\\s*>|$)`, "gi");

/** The last ledger block in a message: its body and form ("comment" or "tag"), or null. */
export function lastLedgerBlock(mes) {
    const re = new RegExp(LEDGER_BLOCK_RE.source, "gi");
    let m, last = null;
    while ((m = re.exec(String(mes || "")))) {
        last = m[1] !== undefined ? { body: m[1], kind: "comment" } : { body: m[2], kind: "tag" };
        if (m[0] === "") re.lastIndex++;
    }
    return last;
}

/** The body of the last ledger block in a message, or null. */
export function notebookBody(mes) {
    return lastLedgerBlock(mes)?.body ?? null;
}

// Lines under a "Heading:" up to the next heading or the end.
export function section(body, heading) {
    const lines = body.split(/\r?\n|<br\s*\/?>/i);
    const out = [];
    let inside = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (/^[A-Za-z][A-Za-z ]{1,30}:\s*$/.test(norm(line))) {
            inside = norm(line).toLowerCase().startsWith(heading.toLowerCase());
            continue;
        }
        if (inside && line) out.push(line);
    }
    return out;
}

const bullet = line => norm(line).replace(/^[-*•]\s*/, "");

const NOW_LINE = /^\s*(?:[-*•]\s*)?Now\s*:\s*(.*)$/im;
const isSkeleton = s => /^\[.*\]$/.test(s);
// an explicit "nothing to propose" under Proposed rules
const NO_PROPOSALS = /^(?:none|n\/a|nothing|no proposals?|[—–-])\.?$/i;

/** The thread lines the model may write under Threads:, one command each. */
export const THREAD_COMMANDS = [
    { id: "threads.add", form: "+ [T] thread that opened", example: "+ [T] Meet Mara at the mill on Day 4 at dawn", keywords: ["T"] },
    { id: "threads.remove", form: "- [T] thread that resolved", example: "- [T] Ask about the letter", keywords: ["T"] },
];

/** The rule proposals the model may write under Proposed rules:, one command each. */
export const PROPOSAL_COMMANDS = [
    { id: "rules.add", form: "add: rule", example: "add: Mara never lies to Jan", keywords: ["add"] },
    { id: "rules.edit", form: "edit R#: new text", example: "edit R1: Mara never lies to Jan, except to protect him", keywords: ["edit"] },
    { id: "rules.remove", form: "remove R#: why", example: "remove R1: the reader dropped it", keywords: ["remove"] },
];

// a proposal line, bullet already gone → { op, target, text } or null
function proposalOf(line) {
    let m;
    if ((m = line.match(/^add\s*:\s*(.+)$/i))) return { op: "add", target: null, text: m[1].trim() };
    if ((m = line.match(/^edit\s+R?(\d+)\s*:\s*(.+)$/i))) return { op: "edit", target: Number(m[1]), text: m[2].trim() };
    if ((m = line.match(/^remove\s+R?(\d+)\s*(?::\s*(.*))?$/i))) return { op: "remove", target: Number(m[1]), text: (m[2] || "").trim() };
    return null;
}

// the tag forms (<Story_Ledger>, <Notebook>) read exactly as before normalization existed
function legacyNotebook(body) {
    const nowMatch = body.match(NOW_LINE);
    const nowText = nowMatch ? norm(nowMatch[1]) : "";
    const now = nowText && !isSkeleton(nowText) ? nowText : null;
    const threads = section(body, "Threads")
        .filter(l => !NOW_LINE.test(l) && !/^\s*(?:[-*•]\s*)?Present\s*:/i.test(l))   // stray one-line fields are not threads
        .map(bullet)
        .map(t => t.replace(/^\[T\]\s*/i, ""))
        .filter(t => t && !isSkeleton(t));                // drop an unfilled "[...]" skeleton line
    const proposals = section(body, "Proposed rules").map(bullet).map(proposalOf).filter(Boolean);
    return { now, threads, proposals };
}

const CORE_FIELD = /^(Now|Present|Public)\s*:\s*(.*)$/i;

/** The comment form's notebook from its normalized records (shared with parseChanges, not re-split). */
export function notebookFromRecords(records) {
    let nowText = null, current = null;
    const threads = [], proposals = [], unparsed = [];
    for (const rec of records) {
        const f = rec.text.match(CORE_FIELD);
        if (f) {
            if (nowText === null && f[1].toLowerCase() === "now") nowText = f[2].trim();
            current = null;                                // a core field ends the section, as in parseChanges
            continue;                                      // stray one-line fields are not threads
        }
        const h = headingOf(rec);
        if (h) { current = h.known ? h.name : null; continue; }
        if (isCommandPlaceholder(rec.text, current === "Threads" ? THREAD_COMMANDS : current === "Proposed rules" ? PROPOSAL_COMMANDS : [])) continue;
        if (current === "Threads") {
            const t = rec.text.replace(/^\[T\]\s*/i, "");
            if (t && !isSkeleton(t)) threads.push(t);
        } else if (current === "Proposed rules") {
            const p = proposalOf(rec.text);
            if (p) proposals.push(p);
            else if (rec.text && !isSkeleton(rec.text) && !NO_PROPOSALS.test(rec.text)) unparsed.push(rec.text);   // skeletons are parseChanges' to report
        }
    }
    const now = nowText && !isSkeleton(nowText) ? nowText : null;
    return { now, threads, proposals, unparsed };
}

/**
 * { now: string|null, threads: string[], proposals: {op,target,text}[] } or null when the reply has no block.
 * The comment form adds `unparsed: string[]` (proposal lines it could not read); the tag forms do not.
 */
export function parseNotebookBlock(mes) {
    const block = lastLedgerBlock(mes);
    if (block === null) return null;
    return block.kind === "comment" ? notebookFromRecords(ledgerLines(block.body)) : legacyNotebook(block.body);
}

// ── Story clock ─────────────────────────────────────────────────────────────
//
// The free-text FALLBACK to World State's structured time line. World State lives
// inside <Blocks>, which Megumin strips from replies three or more back, so the
// model only ever sees the newest time. This keeps the current time and a short
// trail of past times in [[rules_notebook]], which is never stripped.
//
// Derived from the chat at prompt time, not stored, so it follows swipes and edits.

const WORLD_STATE_TIME = /\*\*\s*📅\s*Time:\s*\*\*\s*([^|\n]+?)\s*(?:\||\n|$)/i;
const HEADER_TIME = /^\[\s*🕰️?\s*([^\]\n]+?)\s*\]\s*$/m;   // FF / Ancient Access header line

/** The time a single reply states, in order of preference, or null. */
function stampOf(mes) {
    const nb = parseNotebookBlock(mes);
    if (nb && nb.now) return { text: nb.now, source: "notebook" };
    const ws = String(mes || "").match(WORLD_STATE_TIME);
    if (ws && !isSkeleton(norm(ws[1]))) return { text: norm(ws[1]), source: "world_state" };
    const hd = String(mes || "").match(HEADER_TIME);
    if (hd) return { text: norm(hd[1]), source: "ff_header" };
    return null;
}

/**
 * { now: {text, source}|null, timeline: string[] } — the newest stated time and the
 * last `max` distinct times in story order. A reader correction (notebook.clockOverride,
 * stamped with the chat length when it was set) wins until a newer reply states a time.
 */
export function storyTime(chat, notebook, max = 6) {
    const msgs = chat || [];
    let now = null, nowIndex = -1;
    const trail = [];
    for (let i = msgs.length - 1; i >= 0 && trail.length < max; i--) {
        const msg = msgs[i];
        if (!msg || msg.is_user || msg.is_system) continue;
        const s = stampOf(msg.mes);
        if (!s) continue;
        if (!now) { now = s; nowIndex = i; }
        if (trail[trail.length - 1] !== s.text) trail.push(s.text);
    }
    const override = notebook && notebook.clockOverride;
    if (override && override.text && (nowIndex < 0 || nowIndex < override.atLength)) {
        now = { text: override.text, source: "reader" };
    }
    return { now, timeline: trail.reverse() };
}

const dayOf = s => { const m = String(s || "").match(/\bDay\s+(\d+)\b/i); return m ? Number(m[1]) : null; };

/** [previous, current] → {from, to} when an explicit Day counter went backwards, else null. */
export function dayRegression([previous, current]) {
    const a = dayOf(previous), b = dayOf(current);
    return a !== null && b !== null && b < a ? { from: a, to: b } : null;
}

/** Threads from the newest AI reply carrying a ledger block, else the stored list. */
export function latestThreads(chat, notebook) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg || msg.is_user || msg.is_system) continue;
        const nb = parseNotebookBlock(msg.mes);
        if (nb) return nb.threads;
    }
    return (notebook && notebook.threads) || [];
}

// ── Inbox ───────────────────────────────────────────────────────────────────

const signature = (op, targetText, text) => `${op}|${key(targetText)}|${key(text)}`;

/**
 * Turn a reply's proposals into inbox items. An edit/remove records the TEXT of the
 * rule it pointed at, so a later reorder by the reader cannot make it hit the wrong
 * rule. Duplicates, proposals already rejected, and adds of a rule that already
 * exists are dropped. An edit/remove of a missing rule is pushed onto `diagnostics` when given.
 */
export function collectProposals(notebook, proposals, sourceId, diagnostics = null) {
    const nb = { ...notebook, inbox: [...(notebook.inbox || [])], rejected: [...(notebook.rejected || [])] };
    let nextId = nb.nextId || 1;
    const existingRules = new Set((nb.rules || []).map(key));
    const seen = new Set([...nb.inbox.map(i => i.signature), ...nb.rejected]);
    for (const p of proposals || []) {
        if (!p || !p.op) continue;
        if (p.op === "add" && (!p.text || existingRules.has(key(p.text)))) continue;
        const targetText = p.op === "add" ? "" : (nb.rules || [])[p.target - 1];
        if (p.op !== "add" && targetText === undefined) {                   // points at no rule
            if (Array.isArray(diagnostics)) diagnostics.push({ section: "Proposed rules", line: `${p.op} R${p.target}`, reason: `no rule R${p.target}` });
            continue;
        }
        if (p.op === "edit" && key(targetText) === key(p.text)) continue;   // no-op edit
        const sig = signature(p.op, targetText, p.text);
        if (seen.has(sig)) continue;
        seen.add(sig);
        nb.inbox.push({ id: `p${nextId++}`, op: p.op, targetText, text: p.text, source: sourceId, signature: sig });
    }
    nb.nextId = nextId;
    return nb;
}

/** "approve" or "reject" one inbox item. A target that no longer exists marks it stale. */
export function applyDecision(notebook, itemId, decision) {
    const nb = { ...notebook, rules: [...(notebook.rules || [])], inbox: [...(notebook.inbox || [])], rejected: [...(notebook.rejected || [])] };
    const idx = nb.inbox.findIndex(i => i.id === itemId);
    if (idx < 0) return nb;
    const item = nb.inbox[idx];
    if (decision === "reject") {
        nb.rejected.push(item.signature);
        nb.inbox.splice(idx, 1);
        return nb;
    }
    if (item.op === "add") {
        nb.rules.push(item.text);
    } else {
        const at = nb.rules.findIndex(r => key(r) === key(item.targetText));
        if (at < 0) {
            nb.inbox[idx] = { ...item, stale: true };
            return nb;
        }
        if (item.op === "edit") nb.rules[at] = item.text;
        else nb.rules.splice(at, 1);
    }
    nb.inbox.splice(idx, 1);
    return nb;
}

// ── What the model reads ────────────────────────────────────────────────────

const describe = i => i.op === "add" ? `- add: ${i.text}`
    : i.op === "edit" ? `- edit "${i.targetText}" → ${i.text}`
    : `- remove "${i.targetText}"${i.text ? ` (${i.text})` : ""}`;

export function renderNotebookPrompt(notebook, threads, time = null) {
    const rules = (notebook && notebook.rules) || [];
    const inbox = ((notebook && notebook.inbox) || []).filter(i => !i.stale);
    const now = time && time.now;
    if (!rules.length && !(threads || []).length && !inbox.length && !now) return "";
    const parts = ["<rules_notebook>",
        "The reader's notebook for this story. RULES are constants the reader set: they outrank style habits and tracker limits, and you never contradict, soften, reinterpret, or let one lapse. You cannot change a rule; you can only propose a change in your Story_Ledger block, and the reader decides."];
    if (now) {
        parts.push("", `Current story time: ${now.text}${now.source === "reader" ? " (set by the reader — continue from it)" : ""}`);
        if ((time.timeline || []).length > 1) parts.push(`Recent timeline: ${time.timeline.join(" → ")}`);
        parts.push("Advance time only by what actually happens; a conversation takes minutes, sleep and travel skip ahead. Day numbers never go backwards.");
    }
    if (rules.length) parts.push("", "Rules:", ...rules.map((r, n) => `R${n + 1}. ${r}`));
    if ((threads || []).length) parts.push("", "Open threads (yours to maintain; to update one, write `- [T]` with its old wording and `+ [T]` with the new):", ...threads.map(t => `- [T] ${t}`));
    if (inbox.length) parts.push("", "Already proposed, awaiting the reader — do not propose these again:", ...inbox.map(describe));
    parts.push("</rules_notebook>");
    return parts.join("\n");
}

export const NOTEBOOK_BLOCK_TEMPLATE = [
    "Now: [Story time after this reply, free text — e.g. Day 12 — Tuesday, March 4, 21:44 | Lake, the lawn. Day N counts from the story's first day and never resets.]",
    "Threads:",
    "- [T] [Every open thread, carried forward and updated each turn: an intention, open question, promise, debt, appointment (with day and time), unresolved arc. Retire one when it resolves. At most 12.]",
    "Proposed rules:",
    "- [ONLY when the story establishes a fact that must never drift, or the reader gives a lasting out-of-character instruction. Write `add: <rule>`, `edit R#: <new text>`, or `remove R#: <why>`. Omit this section on every other turn. Never restate an existing rule here.]",
].join("\n");

// ── Importing a notebook another preset kept in the chat ────────────────────

// The notebook section of a message in any of the formats this chat may hold:
// Freaky/Realistic Frankenstein's GM'S NOTEBOOK, Sola's <story_notes>, Ancient
// Access's <ledger>.
function legacyNotebookSection(mes) {
    const s = String(mes || "");
    let m = s.match(/GM'S NOTEBOOK\s*<\/summary>([\s\S]*?)<\/details>/i);
    if (m) return m[1];
    m = s.match(/<story_notes\b[^>]*>([\s\S]*?)<\/story_notes>/i);
    if (m) return m[1];
    m = s.match(/<ledger\b[^>]*>[\s\S]*?NOTEBOOK:\s*([\s\S]*?)(?:\n[A-Z][A-Z &]{2,}:|<\/ledger>)/i);
    if (m) return m[1];
    return null;
}

/** [R]/[T] entries from the newest message that carries a legacy notebook. */
export function importFromLegacyNotebook(chat) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg || msg.is_user) continue;
        const body = legacyNotebookSection(msg.mes);
        if (body === null) continue;
        const rules = [], threads = [];
        // entries one per line, or pipe-separated on one line ("[R] a | [T] b", the pipe possibly as &#124;)
        for (const raw of body.split(/\r?\n|<br\s*\/?>|\s+(?:\||&#124;)\s+(?=(?:[-*•]\s*)?\[[RTD]\])/i)) {
            const line = bullet(raw);
            const m = line.match(/^\[(R|T)\]\s*(.+)$/i);
            if (!m) continue;
            (m[1].toUpperCase() === "R" ? rules : threads).push(m[2].trim());
        }
        return { rules, threads };
    }
    return { rules: [], threads: [] };
}

// ── FF handover ─────────────────────────────────────────────────────────────

const FF_STATE = /<internal_states>|<!--\s*GFX_START\s*-->/i;
const MEGUMIN_STATE = /<Blocks>/i;

/** True while the newest state-bearing AI reply is FF's and no Megumin <Blocks> follows it. */
export function needsFfHandover(chat) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const msg = chat[i];
        if (!msg || msg.is_user || msg.is_system) continue;
        if (MEGUMIN_STATE.test(msg.mes || "")) return false;
        if (FF_STATE.test(msg.mes || "")) return true;
    }
    return false;
}
