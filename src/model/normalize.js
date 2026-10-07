// ──────────────────────────────────────────────────────────────────────────────
// Framing normalisation for the ledger comment's lines. Strips only what wraps a
// line (tags, odd spaces, a code span, one list marker, label emphasis) and folds
// curly quotes; the words of a value are never rewritten. Pure: no SillyTavern,
// no DOM.
// ──────────────────────────────────────────────────────────────────────────────

const TAG = /<\/?[A-Za-z][^<>]*>/g;
const ODD_SPACE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000\t]/g;
const MARKER = /^(?:[-*•·]|\d{1,3}[.)]|[a-z]\))\s+/;
const EMPHASIS = /^(\*\*|__)(.+?)\1/;

/** Remove HTML-ish tags (`<b>`, `</i>`, `<br/>`) only; `<->` and `a < b` stay. */
export function stripTags(s) {
    return s.replace(TAG, "");
}

/** Fold curly/angle double quotes to `"` and curly single quotes to `'`. */
export function foldQuotes(s) {
    return s.replace(/[“”„‟«»″]/g, "\"").replace(/[‘’‚‛′]/g, "'");
}

// unwrap a leading **label** / __label__ only when it reads as a label or is the whole text
function unwrapEmphasis(s) {
    const m = EMPHASIS.exec(s);
    if (!m) return s;
    const inner = m[2], rest = s.slice(m[0].length);
    if (inner.endsWith(":") || rest.startsWith(":") || rest.trim() === "") return inner + rest;
    return s;
}

/**
 * Normalise one ledger line. `raw` keeps the input minus a trailing `\r`; `unfolded`
 * is the framing-clean text before quote folding; `text` is `unfolded` with quotes folded.
 */
export function normalizeLine(raw) {
    raw = raw.replace(/\r$/, "");
    let s = stripTags(raw).replace(ODD_SPACE, " ").replace(/\s+/g, " ").trim();
    const code = /^`([^`]+)`$/.exec(s);
    if (code) s = code[1].trim();
    let bulleted = false;
    const mark = MARKER.exec(s);
    if (mark) {
        bulleted = true;
        s = s.slice(mark[0].length);
        const inner = /^`([^`]+)`$/.exec(s);          // a bulleted code span: "- `done Q1`"
        if (inner) s = inner[1].trim();
    }
    const unfolded = unwrapEmphasis(s).trim();
    return { raw, unfolded, text: foldQuotes(unfolded).trim(), bulleted };
}

/** Split a comment body into normalised lines (newlines and `<br>`), dropping empty ones. */
export function ledgerLines(body) {
    return body.split(/\r?\n|<br\s*\/?>/i).map(normalizeLine).filter(l => l.text !== "");
}
