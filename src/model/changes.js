// ──────────────────────────────────────────────────────────────────────────────
// The model's <!-- Story_Ledger … --> comment, read as CHANGES: only what this
// reply moved. Scene fields are one-liners; every other section is a list of
// change lines. Sections a later phase owns are kept raw in `sections`.
// Pure: no SillyTavern, no DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { notebookBody, parseNotebookBlock } from "./notebook.js";
import { parseRelationLines } from "./relations.js";

const clean = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const unbullet = s => s.replace(/^\s*[-*•]\s+/, "");
const isSkeleton = s => /^\[.*\]$/.test(s);
const FIELD = /^\s*(?:[-*•]\s*)?(Now|Present|Public)\s*:\s*(.*)$/i;
const HEADING = /^([A-Za-z][A-Za-z ]{0,30}):\s*$/;

/** Changes in a reply, or null when it carries no Story_Ledger comment. */
export function parseChanges(mes) {
    const body = notebookBody(mes);
    if (body === null) return null;
    const out = {
        now: null, present: null, public: null,
        threads: { add: [], remove: [] },
        relations: null, proposals: [], sections: {}, unparsed: [],
    };
    const raw = {};            // section name → raw lines (bullets kept)
    let current = null;
    for (const line of body.split(/\r?\n|<br\s*\/?>/i)) {
        if (!line.trim()) continue;
        const f = line.match(FIELD);
        if (f) {
            const v = clean(f[2]);
            const k = f[1].toLowerCase();
            if (v && !isSkeleton(v)) {
                if (k === "now") out.now = v;
                else if (k === "present") out.present = v.split(/[,;]/).map(s => s.trim()).filter(s => s && !isSkeleton(s));
                else out.public = /^(yes|true|public)\b/i.test(v);
            }
            current = null;
            continue;
        }
        const h = line.match(HEADING);
        if (h) { current = h[1].trim().replace(/\s+/g, " "); raw[current] = raw[current] || []; continue; }
        if (current) raw[current].push(line.trim());
    }
    for (const [name, lines] of Object.entries(raw)) {
        const key = name.toLowerCase();
        if (key === "threads") {
            for (const l of lines) {
                // "- + [T] x" / "- - [T] x"; without a list bullet the [T] tag is required,
                // so a plain "- something" is never read as a removal.
                const m = l.match(/^[-*•]\s+([+-])\s*(?:\[T\]\s*)?(.+)$/i) || l.match(/^([+-])\s*\[T\]\s*(.+)$/i);
                const text = m && clean(m[2]);
                if (m && text && !isSkeleton(text)) (m[1] === "+" ? out.threads.add : out.threads.remove).push(text);
                else out.unparsed.push({ section: name, line: clean(unbullet(l)) });
            }
        } else if (key !== "relationships" && key !== "proposed rules") {
            // A line still in its "[…]" template form is the model echoing the template, not a change.
            const all = lines.map(l => clean(unbullet(l))).filter(Boolean);
            for (const l of all.filter(isSkeleton)) out.unparsed.push({ section: name, line: l });
            out.sections[name] = all.filter(l => !isSkeleton(l));
        }
    }
    out.relations = parseRelationLines(raw.Relationships || raw.relationships || []);
    out.proposals = (parseNotebookBlock(mes) || { proposals: [] }).proposals;
    return out;
}
