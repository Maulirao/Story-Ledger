// ──────────────────────────────────────────────────────────────────────────────
// Painting dialogue voices on screen. The host has already rendered the message and thrown
// the <Name> tags away, so the plan comes from the raw message text and each tagged quote is
// found again among the rendered ones. Display only: the message text is never touched, and
// unpaintVoices puts the rendered nodes back as they were. Nothing here runs at import, so
// node tests can load it without a DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { planPaint, matchQuotes } from "../model/voices.js";

const SHOW_TEXT = 4;   // NodeFilter.SHOW_TEXT
const QUOTE = /[“"][^”"]{1,2000}?[”"]/g;

/** The span's class list and colour variables for one planned quote. */
export function spanAttrs(span) {
    const className = ["sl-voice", span.bottom ? "sl-voice-two" : "", span.mind ? "sl-voice-mind" : "", span.tone ? `sl-tone-${span.tone}` : ""]
        .filter(Boolean).join(" ");
    return { className, style: `--sl-top:${span.top};--sl-bottom:${span.bottom ?? span.top}` };
}

function voiceSpan(doc, span) {
    const el = doc.createElement("span");
    const { className, style } = spanAttrs(span);
    el.className = className;
    el.setAttribute("style", style);
    el.setAttribute("data-sl-voice", "");
    return el;
}

// a quote inside the ledger block or Story Ledger's own UI is never dialogue
const inBlock = node => Boolean((node.nodeType === 1 ? node : node.parentElement)?.closest?.("details, .sl-ui"));

/** Undo paintVoices inside `el`. */
export function unpaintVoices(el) {
    for (const span of [...el.querySelectorAll("[data-sl-voice]")]) {
        const parent = span.parentNode;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
        parent.normalize?.();
    }
}

/** Colour the tagged quotes of `rawText` inside the rendered message `el`, from the chat's voices. */
export function paintVoices(el, rawText, list) {
    unpaintVoices(el);
    const plan = planPaint(rawText, list);
    if (!plan.length) return;
    const planned = plan.map(p => p.quote);
    const doc = el.ownerDocument;

    // SillyTavern wraps every quote in <q>
    const qs = [...el.querySelectorAll("q")].filter(q => !inBlock(q));
    if (qs.length) {
        matchQuotes(planned, qs.map(q => q.textContent)).forEach((at, i) => {
            if (at < 0) return;
            const span = voiceSpan(doc, plan[i]);
            while (qs[at].firstChild) span.appendChild(qs[at].firstChild);
            qs[at].appendChild(span);
        });
        return;
    }

    // elsewhere (LocalChar): quotes that sit inside one text node
    const found = [];
    const walker = doc.createTreeWalker(el, SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (inBlock(node)) continue;
        for (const m of node.data.matchAll(QUOTE)) found.push({ node, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    const hits = matchQuotes(planned, found.map(f => f.text)).map((at, i) => ({ at, i })).filter(h => h.at >= 0);
    // back to front, so splitting a text node never moves a match still to come
    for (const { at, i } of hits.reverse()) {
        const { node, start, end } = found[at];
        const quote = node.splitText(start);
        quote.splitText(end - start);
        const span = voiceSpan(doc, plan[i]);
        quote.parentNode.insertBefore(span, quote);
        span.appendChild(quote);
    }
}
