// ──────────────────────────────────────────────────────────────────────────────
// Sola theme — Sola's warm showrunner look on the state block, display only: a HUD
// strip of chips (Now · Present · Fate tier) above the block, relationships as the
// bond & chemistry card, thoughts as the thought cabinet, Fate as a director's note.
// Built on the shared decoration, so ↻, 🎲, bars and chips work the same.
// ──────────────────────────────────────────────────────────────────────────────

import { decorateWith, outerDetails } from "./frankenstein.js";
import { hudChips } from "./layout.js";

export { undecorate } from "./common.js";

const escHtml = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

const sectionText = (outer, re) => {
    const d = [...outer.querySelectorAll("details")].find(x => re.test((x.querySelector(":scope > summary") || {}).textContent || ""));
    return d ? d.textContent : "";
};
const field = (text, label, next) => {
    const m = text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=${next}|$)`));
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
};

/** Decorate the rendered block inside `root` (a .mes_text element). */
export function decorate(root, ctx) {
    const fresh = decorateWith(root, ctx, "sola");
    if (!fresh) return;
    const outer = outerDetails(root);
    const scene = sectionText(outer, /SCENE$/);
    const fate = sectionText(outer, /FATE/);
    const turn = fate.match(/This turn:\s*(AMBIENT|MINOR|MAJOR)\s*\+\s*(TRUE|WEIGHTED)/);
    const chips = hudChips({
        now: field(scene, "Now", "Present:|Public:"),
        present: field(scene, "Present", "Public:"),
        tier: turn ? turn[1] : "", source: turn ? turn[2] : "",
    });
    if (chips.length) {
        outer.insertAdjacentHTML("beforebegin", `<div class="sl-ui sl-sola-hud">${chips.map(c =>
            `<span class="sl-sola-chip sl-sola-${c.kind}"><b>${escHtml(c.label)}</b> ${escHtml(c.value)}</span>`).join("")}</div>`);
    }
    for (const d of outer.querySelectorAll("details")) {
        const title = (d.querySelector(":scope > summary") || {}).textContent || "";
        if (/INTERNAL STATES/i.test(title)) continue;
        d.classList.add(/RELATIONSHIPS/i.test(title) ? "sl-sola-bond" : /THOUGHTS/i.test(title) ? "sl-sola-cabinet" : /FATE/i.test(title) ? "sl-sola-note" : "sl-sola-card");
    }
}
