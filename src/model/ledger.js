// ──────────────────────────────────────────────────────────────────────────────
// The <Story_Ledger> block and everything assembled around it: turns for the
// relationship engine, the handover from another preset, the text the model reads,
// and keeping old blocks out of the prompt. Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { notebookBody, parseNotebookBlock, section, LEDGER_BLOCK_RE } from "./notebook.js";
import { parseRelationLines, describePair, PATTERN_GLOSS } from "./relations.js";

const LEDGER_RE = new RegExp(LEDGER_BLOCK_RE.source, "gi");

/** Everything one reply's block says, or null when it has none. */
export function parseLedger(mes) {
    const nb = parseNotebookBlock(mes);
    if (!nb) return null;
    const body = notebookBody(mes);
    const presentLine = body.match(/^\s*(?:[-*•]\s*)?Present\s*:\s*(.*)$/im);
    const present = presentLine
        ? presentLine[1].replace(/<[^>]+>/g, "").split(/[,;]/).map(s => s.trim()).filter(s => s && !/^\[.*\]$/.test(s))
        : [];
    const relations = parseRelationLines(section(body, "Relationships"));
    return { ...nb, present, relations };
}

/**
 * The chat as engine turns: one per AI reply from the first reply that carries a
 * ledger onward (a reply that forgot its block still advances the clock). The player
 * is always present — they are the one the scene follows.
 */
export function buildTurns(chat, userName) {
    const msgs = chat || [];
    const firstIndex = msgs.findIndex(m => m && !m.is_user && !m.is_system && parseLedger(m.mes));
    const turns = [], messageIndexes = [];
    if (firstIndex < 0) return { turns, messageIndexes, firstIndex };
    for (let i = firstIndex; i < msgs.length; i++) {
        const m = msgs[i];
        if (!m || m.is_user || m.is_system) continue;
        const parsed = parseLedger(m.mes);
        const present = new Set(parsed ? parsed.present : []);
        if (userName) present.add(userName);
        turns.push({ events: parsed ? parsed.relations : null, present: [...present] });
        messageIndexes.push(i);
    }
    return { turns, messageIndexes, firstIndex };
}

/** Reader corrections are stamped with the chat length when made; the engine wants turn indexes. */
export function correctionsToTurns(corrections, messageIndexes) {
    return (corrections || []).map(({ atLength, ...rest }) => ({
        at: messageIndexes.filter(i => i < atLength).length,
        ...rest,
    }));
}

/** The turn number of the newest Freaky/Realistic Frankenstein internal-states block, or null. */
export function importFfTurn(chat) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_user) continue;
        const hit = String(m.mes || "").match(/INTERNAL STATES\s*\(Turn:\s*(\d+)\)/i);
        if (hit) return Number(hit[1]);
    }
    return null;
}

// Another preset's state block: Freaky/Realistic Frankenstein, Megumin, Sola, Ancient Access.
const FOREIGN_STATE = /<internal_states>|<!--\s*GFX_START\s*-->|<Blocks>|<sola_hud\b|<ledger\b/i;

/** True while the newest state-bearing AI reply was written under another preset. */
export function needsHandover(chat) {
    for (let i = (chat || []).length - 1; i >= 0; i--) {
        const m = chat[i];
        if (!m || m.is_user || m.is_system) continue;
        if (parseLedger(m.mes)) return false;
        if (FOREIGN_STATE.test(m.mes || "")) return true;
    }
    return false;
}

// ── What the model reads ────────────────────────────────────────────────────

/** Compact state for every pair with at least one member present. "" when none. */
export function renderRelationsPrompt(state, present, config) {
    const here = new Set(present || []);
    const lines = [];
    for (const p of Object.values(state.pairs)) {
        if (!here.has(p.from) && !here.has(p.to)) continue;
        const d = describePair(state, p.from, p.to, config);
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

export const RELATIONSHIP_RULES = `<relationship_rules>
Every relationship line is how one character feels toward another — directional; {{user}}'s own feelings are the reader's and are never tracked. Twelve axes, 1–20, in opposed pairs: Eros/Misos (romantic), Ludus/Eris (playful), Philia/Echthros (friendship), Pragma/Stasis (practical), Storge/Adiaphora (familial), Agape/Phthonos (selfless / resentful giving). Φ is a character's own self-regard (−20…20): low Φ makes fondness hard to receive.
Fondness and friction coexist and tick independently; one interaction can tick both. You only report raw material — the ledger converts accumulators into axis changes on its own schedule. Write in the Relationships section:
- Ticks: \`A → B: E_acc +1 (reason) | M_acc +2 (reason)\` — +1 or +2 per accumulator, only for what happened in this reply. Friction map: romance hurt → M, cruelty → Er, broken trust → Ec, practical frustration → St, neglect → Ad, resentment → Pt.
- Self-regard: \`A: Φ_acc +1 (reason)\` or a negative value.
- \`DIRECT A → B: E +1 (reason)\` — only for a genuinely significant moment; it is what breaks a stalemate.
- \`NEW A → B: E 3, M 4, L 3, Er 3, Ph 4, Ec 5, Pr 3, St 4, Sg 3, Ad 3, Ag 3, Pt 4 | Φ 2 (why)\` — the first time a relationship matters: every axis at least 3, values varied, friction outweighing fondness unless the card says otherwise.
Never state the numbers in prose; show them through behavior. Romantic or sexual initiation happens only where the ledger says romance is allowed; forcing it elsewhere meets discomfort or anger. "Reads as" patterns are interpretation, not rules.
</relationship_rules>`;

export const LEDGER_TEMPLATE = `At the very end of your reply, after the prose, write exactly one ledger block inside an HTML comment, as below. The reader never sees it; never write "-->" inside it.
<!-- Story_Ledger
Now: [story time after this reply, free text — e.g. Day 12 — Tuesday, March 4, 21:44 | the lawn. Day N counts from the story's first day and never resets.]
Present: [every named character in the scene, comma separated]
Threads:
- [T] [every open thread, carried forward and updated: an intention, open question, promise, debt, appointment with day and time, unresolved arc. Retire one when it resolves. At most 12.]
Relationships:
- [only this reply's events, as described in the relationship rules. Omit the section when nothing moved.]
Proposed rules:
- [ONLY when the story establishes a fact that must never drift, or the reader gives a lasting out-of-character instruction: \`add: <rule>\`, \`edit R#: <new text>\`, or \`remove R#: <why>\`. Omit this section on every other turn.]
-->`;

export const HANDOVER = `<ledger_handover>
This chat ran under another preset until now. The story continues exactly where it stands; only the bookkeeping changes. From the newest state block in the history — a Freaky/Realistic Frankenstein header and <internal_states>, Megumin's <Blocks>, Sola's <sola_hud>, or Ancient Access's <ledger> — fill this reply's Story_Ledger:
- Now: from that state's time, date and place. Keep its Day number and continue counting from it.
- Threads: every open thread or [T] entry, as written.
- Relationships: one NEW line for every relationship that state tracked, calibrated from what it recorded (FF's BOND −5…20 with Sparks and Grudge, Megumin's Affection/Trust/Desire, Sola's named dynamics) and from the story so far. High BOND means fondness on the axes that fit this relationship; Grudge and hostility mean friction.
- Proposed rules: if the reader's notebook below does not already hold that state's [R] rules, propose each as add:.
Stop writing the old preset's state block from this reply on, even though it is still visible in the history.
</ledger_handover>`;

/** Remove every ledger block except the newest assistant message's own. Mutates `messages`. */
export function stripOldLedgers(messages) {
    let lastAssistant = -1;
    messages.forEach((m, i) => { if (m && m.role === "assistant" && typeof m.content === "string" && LEDGER_RE.test(m.content)) lastAssistant = i; LEDGER_RE.lastIndex = 0; });
    messages.forEach((m, i) => {
        if (!m || m.role !== "assistant" || typeof m.content !== "string" || i === lastAssistant) return;
        m.content = m.content.replace(LEDGER_RE, "").replace(/\s+$/, "");
    });
    return messages;
}
