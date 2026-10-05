// ──────────────────────────────────────────────────────────────────────────────
// Megumin theme — Megumin Suite's master block card on the state block, display
// only: one card with a tab strip (Scene · People · Relationships · Story · Fate ·
// Notes), one tab's sections visible at a time. Built on the shared decoration, so
// ↻, 🎲, bars and chips work the same. The chosen tab is display state only.
// ──────────────────────────────────────────────────────────────────────────────

import { decorateWith, outerDetails } from "./frankenstein.js";
import { sectionGroups } from "./layout.js";

export { undecorate } from "./common.js";

const ICON = { Scene: "🕰️", People: "👤", Relationships: "💞", Story: "📜", Fate: "🎲", Notes: "📓" };

/** Decorate the rendered block inside `root` (a .mes_text element). */
export function decorate(root, ctx) {
    const fresh = decorateWith(root, ctx, "megumin");
    if (!fresh) return;
    const outer = outerDetails(root);
    const head = outer.querySelector(":scope > summary");
    const sections = [...outer.querySelectorAll(":scope > details")];
    const titleOf = d => ((d.querySelector(":scope > summary") || {}).textContent || "").trim();
    const groups = sectionGroups(sections.map(titleOf));
    if (!groups.length) return;
    const strip = document.createElement("div");
    strip.className = "sl-ui sl-mg-tabs";
    strip.innerHTML = groups.map(g => `<button type="button" class="sl-mg-tab" data-tab="${g.tab}"><span>${ICON[g.tab] || "•"}</span> ${g.tab}</button>`).join("");
    head.insertAdjacentElement("afterend", strip);
    const show = tab => {
        const group = groups.find(g => g.tab === tab) || groups[0];
        outer.dataset.slTab = group.tab;
        for (const d of sections) {
            const visible = group.titles.includes(titleOf(d));
            d.classList.toggle("sl-mg-hidden", !visible);
            if (visible) d.open = true;
        }
        for (const b of strip.querySelectorAll(".sl-mg-tab")) b.classList.toggle("sl-mg-active", b.dataset.tab === group.tab);
    };
    strip.addEventListener("click", e => {
        const b = e.target.closest(".sl-mg-tab");
        if (!b) return;
        e.preventDefault();
        e.stopPropagation();
        show(b.dataset.tab);
    });
    show(groups[0].tab);
}
