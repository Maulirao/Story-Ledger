// ──────────────────────────────────────────────────────────────────────────────
// Painting dialogue voices on screen. The host has already rendered the message and thrown
// the <Name> tags away, so the plan comes from the raw message text and each tagged quote is
// found again among the rendered ones. Display only: the message text is never touched, and
// unpaintVoices puts the rendered nodes back as they were. Nothing here runs at import, so
// node tests can load it without a DOM.
// ──────────────────────────────────────────────────────────────────────────────

import { planPaint, matchQuotes, quotesIn, trailingTagAt } from "../model/voices.js";

const SHOW_TEXT = 4;   // NodeFilter.SHOW_TEXT
// the quote kinds SillyTavern pairs, so on-screen quotes split the same way as quotesIn's
const QUOTE = /"[^"\n]{1,2000}?"|“[^”\n]{1,2000}?”|«[^»\n]{1,2000}?»|「[^」\n]{1,2000}?」|『[^』\n]{1,2000}?』|＂[^＂\n]{1,2000}?＂/g;

/**
 * The span's class list and colour variables for one planned quote. `options.ring` (Settings →
 * "Telepathy with a listener: Eclipse ring") rings listener lines instead of banding them plain.
 */
export function spanAttrs(span, options = {}) {
    const className = ["sl-voice", span.bottom ? "sl-voice-two" : "", span.mind ? "sl-voice-mind" : "",
        span.listener && options.ring ? "sl-voice-ring" : "", span.tone ? `sl-tone-${span.tone}` : ""]
        .filter(Boolean).join(" ");
    return { className, style: `--sl-top:${span.top};--sl-bottom:${span.bottom ?? span.top}` };
}

/** The page-wide SVG filter mind lines use (style.css: .sl-voice-mind). */
export const MIND_FILTER_ID = "sl-mind-eclipse";

// "Eclipse": a white rim, a white corona and a faint violet glow around the dark (mind) pixels
// only, and a thin black rim around the coloured ones, so the speaker's colour is never washed
// out. Dark and bright are told apart by luminance (feColorMatrix), then each mask is grown or
// blurred; the letters themselves go on top unchanged.
const MIND_FILTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
<filter id="${MIND_FILTER_ID}" x="-20%" y="-80%" width="140%" height="260%" color-interpolation-filters="sRGB">
<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -0.9 -1.77 -0.33 1 0" result="dark"/>
<feMorphology in="dark" operator="dilate" radius="0.6" result="rim"/>
<feGaussianBlur in="dark" stdDeviation="2" result="corona"/>
<feGaussianBlur in="dark" stdDeviation="6" result="haloA"/>
<feFlood flood-color="#cdb9ff" flood-opacity="0.55"/><feComposite in2="haloA" operator="in" result="halo"/>
<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.9 1.77 0.33 0 -0.6" result="brightRaw"/>
<feComposite in="brightRaw" in2="SourceAlpha" operator="in" result="bright"/>
<feMorphology in="bright" operator="dilate" radius="0.9" result="blackRim"/>
<feMerge><feMergeNode in="halo"/><feMergeNode in="corona"/><feMergeNode in="rim"/><feMergeNode in="blackRim"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="sl-mind-ring" x="-20%" y="-80%" width="140%" height="260%" color-interpolation-filters="sRGB">
<feMorphology in="SourceAlpha" operator="dilate" radius="1.1" result="blackRim"/>
<feMorphology in="SourceAlpha" operator="dilate" radius="1.7" result="outerA"/>
<feFlood flood-color="#fff"/><feComposite in2="outerA" operator="in" result="whiteRing"/>
<feGaussianBlur in="outerA" stdDeviation="2" result="glowA"/>
<feFlood flood-color="#fff" flood-opacity="0.85"/><feComposite in2="glowA" operator="in" result="glow"/>
<feGaussianBlur in="outerA" stdDeviation="6" result="haloA"/>
<feFlood flood-color="#cdb9ff" flood-opacity="0.55"/><feComposite in2="haloA" operator="in" result="halo"/>
<feMerge><feMergeNode in="halo"/><feMergeNode in="glow"/><feMergeNode in="whiteRing"/><feMergeNode in="blackRim"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter></defs></svg>`;

/** Put the mind filter on the page once. A no-op without a real document (node tests, stubs). */
export function ensureMindFilter(doc) {
    if (!doc || typeof doc.getElementById !== "function" || !doc.body || doc.getElementById(MIND_FILTER_ID)) return;
    const box = doc.createElement("div");
    box.innerHTML = MIND_FILTER_SVG;
    doc.body.appendChild(box.firstChild);
}

// A mind quote sits on a starry band: its own span, since the letters' background is the
// two-colour split. Marked data-sl-voice, so unpaintVoices takes it away too.
function inBand(doc, span, voice) {
    if (!span.mind) return voice;
    const band = doc.createElement("span");
    band.className = "sl-voice-band";
    band.setAttribute("data-sl-voice", "");
    band.appendChild(voice);
    return band;
}

function voiceSpan(doc, span, options) {
    const el = doc.createElement("span");
    const { className, style } = spanAttrs(span, options);
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

// A name the browser does not open a tag on (<Élodie>, <Аня>) stays on screen as text right
// before its quote: hide it (display only; unpaintVoices puts it back).
function hideLiteralTag(doc, node) {
    if (!node || node.nodeType !== 3) return;
    const t = trailingTagAt(node.data);
    if (!t) return;
    const tag = node.splitText(t.at);
    tag.splitText(t.length);
    const hide = doc.createElement("span");
    hide.className = "sl-voice-tag";
    hide.setAttribute("data-sl-voice", "");
    tag.parentNode.insertBefore(hide, tag);
    hide.appendChild(tag);
}

/**
 * Colour the tagged quotes of `rawText` inside the rendered message `el`, from the chat's voices.
 * Every quote of the raw text, tagged or not, is lined up with the rendered ones in order, so an
 * untagged quote with the same words as a tagged one is never painted in its place.
 */
export function paintVoices(el, rawText, list, options = {}) {
    unpaintVoices(el);
    const plan = planPaint(rawText, list).filter(p => p.index >= 0);
    if (!plan.length) return;
    const all = quotesIn(rawText);
    const doc = el.ownerDocument;
    if (plan.some(p => p.mind)) ensureMindFilter(doc);

    // SillyTavern wraps every quote in <q>
    const qs = [...el.querySelectorAll("q")].filter(q => !inBlock(q));
    if (qs.length) {
        const aligned = matchQuotes(all, qs.map(q => q.textContent));
        for (const p of plan) {
            const at = aligned[p.index];
            if (at < 0) continue;
            const span = voiceSpan(doc, p, options);
            while (qs[at].firstChild) span.appendChild(qs[at].firstChild);
            qs[at].appendChild(inBand(doc, p, span));
            hideLiteralTag(doc, qs[at].previousSibling);
        }
        return;
    }

    // elsewhere (LocalChar): quotes that sit inside one text node
    const found = [];
    const walker = doc.createTreeWalker(el, SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (inBlock(node)) continue;
        for (const m of node.data.matchAll(QUOTE)) found.push({ node, start: m.index, end: m.index + m[0].length, text: m[0] });
    }
    const aligned = matchQuotes(all, found.map(f => f.text));
    const hits = plan.map(p => ({ at: aligned[p.index], p })).filter(h => h.at >= 0).sort((a, b) => b.at - a.at);
    // back to front, so splitting a text node never moves a match still to come
    for (const { at, p } of hits) {
        const { node, start, end } = found[at];
        const quote = node.splitText(start);
        quote.splitText(end - start);
        const span = voiceSpan(doc, p, options);
        quote.parentNode.insertBefore(inBand(doc, p, span), quote);
        span.appendChild(quote);
        hideLiteralTag(doc, node);
    }
}
