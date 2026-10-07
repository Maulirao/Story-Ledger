// ──────────────────────────────────────────────────────────────────────────────
// The model's <!-- Story_Ledger … --> comment, read as CHANGES: only what this
// reply moved. Scene fields are one-liners; every other section is a list of
// change lines. Sections a later phase owns are kept raw in `sections`.
// Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { lastLedgerBlock, parseNotebookBlock, notebookFromRecords } from "./notebook.js";
import { parseRelationLines } from "./relations.js";
import { ledgerLines } from "./normalize.js";
import { headingOf } from "./headings.js";

const clean = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const unbullet = s => s.replace(/^\s*[-*•]\s+/, "");
const isSkeleton = s => /^\[.*\]$/.test(s);
const FIELD = /^\s*(?:[-*•]\s*)?(Now|Present|Public)\s*:\s*(.*)$/i;
const CORE_FIELD = /^(Now|Present|Public)\s*:\s*(.*)$/i;
const HEADING = /^([A-Za-z][A-Za-z ]{0,30}):\s*$/;
// headings whose lines are read here, not handed on in `sections`
const OWN = new Set(["Threads", "Relationships", "Proposed rules"]);

const emptyChanges = () => ({
    now: null, present: null, public: null,
    threads: { add: [], remove: [] },
    relations: null, proposals: [], sections: {}, unparsed: [],
});

// a Now/Present/Public value into `out` (an unfilled skeleton changes nothing)
function setField(out, name, v) {
    if (!v || isSkeleton(v)) return;
    const k = name.toLowerCase();
    if (k === "now") out.now = v;
    else if (k === "present") out.present = v.split(/[,;]/).map(s => s.trim()).filter(s => s && !isSkeleton(s));
    else out.public = /^(yes|true|public)\b/i.test(v);
}

/** Changes in a reply, or null when it carries no Story_Ledger comment. */
export function parseChanges(mes) {
    const block = lastLedgerBlock(mes);
    if (block === null) return null;
    return block.kind === "comment" ? parseComment(ledgerLines(block.body)) : parseLegacyLines(block.body, mes);
}

// The <!-- Story_Ledger --> comment, one normalized record per line. `raw`/`rawThreads`
// keep each operation's unfolded text at the same index as its parsed value.
function parseComment(records) {
    const out = { ...emptyChanges(), raw: {}, rawThreads: { add: [], remove: [] } };
    const relationships = [];
    let current = null;            // a canonical heading, { unknown: name }, or null
    for (const rec of records) {
        const f = rec.text.match(CORE_FIELD);
        if (f) { setField(out, f[1], f[2].trim()); current = null; continue; }
        const h = headingOf(rec);
        if (h) {
            current = h.known ? h.name : { unknown: h.name };
            if (h.known && !OWN.has(h.name)) { out.sections[h.name] = out.sections[h.name] || []; out.raw[h.name] = out.raw[h.name] || []; }
            continue;
        }
        if (!current) continue;
        if (typeof current === "object") { out.unparsed.push({ section: current.unknown, line: rec.text, raw: rec.raw }); continue; }
        if (current === "Threads") readThread(out, rec);
        else if (current === "Relationships") relationships.push(rec);
        else if (current === "Proposed rules") continue;
        // a line still in its "[…]" template form is the model echoing the template, not a change
        else if (isSkeleton(rec.text)) out.unparsed.push({ section: current, line: rec.text });
        else { out.sections[current].push(rec.text); out.raw[current].push(rec.unfolded); }
    }
    out.relations = parseRelationLines(relationships);
    const nb = notebookFromRecords(records);
    out.proposals = nb.proposals;
    for (const line of nb.unparsed) out.unparsed.push({ section: "Proposed rules", line });
    return out;
}

// "+ [T] x" / "- [T] x" after the list bullet; without a bullet the [T] tag is required,
// so a plain "- something" is never read as a removal
function readThread(out, rec) {
    const re = rec.bulleted ? /^([+-])\s*(?:\[T\]\s*)?(.+)$/i : /^([+-])\s*\[T\]\s*(.+)$/i;
    const m = rec.text.match(re);
    const text = m && m[2].trim();
    if (!m || !text || isSkeleton(text)) { out.unparsed.push({ section: "Threads", line: rec.text }); return; }
    const u = rec.unfolded.match(re);
    const op = m[1] === "+" ? "add" : "remove";
    out.threads[op].push(text);
    out.rawThreads[op].push(u ? u[2].trim() : text);
}

// The tag forms (<Story_Ledger>, <Notebook>): the reading from before normalization, unchanged.
function parseLegacyLines(body, mes) {
    const out = emptyChanges();
    const raw = {};            // section name → raw lines (bullets kept)
    let current = null;
    for (const line of body.split(/\r?\n|<br\s*\/?>/i)) {
        if (!line.trim()) continue;
        const f = line.match(FIELD);
        if (f) { setField(out, f[1], clean(f[2])); current = null; continue; }
        const h = line.match(HEADING);
        if (h) { current = h[1].trim().replace(/\s+/g, " "); raw[current] = raw[current] || []; continue; }
        if (current) raw[current].push(line.trim());
    }
    for (const [name, lines] of Object.entries(raw)) {
        const key = name.toLowerCase();
        if (key === "threads") {
            for (const l of lines) {
                const m = l.match(/^[-*•]\s+([+-])\s*(?:\[T\]\s*)?(.+)$/i) || l.match(/^([+-])\s*\[T\]\s*(.+)$/i);
                const text = m && clean(m[2]);
                if (m && text && !isSkeleton(text)) (m[1] === "+" ? out.threads.add : out.threads.remove).push(text);
                else out.unparsed.push({ section: name, line: clean(unbullet(l)) });
            }
        } else if (key !== "relationships" && key !== "proposed rules") {
            const all = lines.map(l => clean(unbullet(l))).filter(Boolean);
            for (const l of all.filter(isSkeleton)) out.unparsed.push({ section: name, line: l });
            out.sections[name] = all.filter(l => !isSkeleton(l));
        }
    }
    out.relations = parseRelationLines(raw.Relationships || raw.relationships || [], { legacy: true });
    out.proposals = parseNotebookBlock(mes).proposals;
    return out;
}
