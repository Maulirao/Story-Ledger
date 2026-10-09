// ──────────────────────────────────────────────────────────────────────────────
// Frankenstein theme — FF5's look for the state block, applied to the rendered
// message only. The message text is never touched: this runs on the DOM that
// SillyTavern drew, reads each section's text, and adds classes, chips, bars and
// the ↻ rebuild control. Safe to call repeatedly.
// ──────────────────────────────────────────────────────────────────────────────

const GROUPS = [
    [/SCENE|AGENDAS|LOCATIONS|RELATIONSHIPS|FACTIONS|CAST/i, "sl-grp-people"],
    [/NOTEBOOK|QUESTS|CHEKHOV|THOUGHTS|INV|LAST/i, "sl-grp-memory"],
    [/FATE|WORLD|DND|PHYSICS|ARROW/i, "sl-grp-sim"],
];

import { undecorate } from "./common.js";
import { pairRows } from "./layout.js";

export { undecorate };

const escHtml = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

export function outerDetails(root) {
    return [...root.querySelectorAll("details")].find(d => {
        const s = d.querySelector(":scope > summary");
        return s && /INTERNAL STATES/i.test(s.textContent);
    }) || null;
}

function relationBars(section, config) {
    // one text line per row, however SillyTavern rendered them (<br>, newlines, list items, paragraphs)
    const lines = section.innerHTML.split(/<br\s*\/?>|\n|<\/li>|<\/p>/i).map(html => {
        const el = document.createElement("div");
        el.innerHTML = html;
        return el.textContent;
    });
    const rows = pairRows(lines);
    if (!rows.length) return null;
    const max = config.axisMax || 20;
    const wrap = document.createElement("div");
    wrap.className = "sl-ui sl-fk-pairs";
    wrap.innerHTML = rows.map(r => `<div class="sl-fk-pair"><div class="sl-fk-pair-name">${escHtml(r.from)} → ${escHtml(r.to)}</div>${
        r.note ? `<div class="sl-fk-pair-note">${escHtml(r.note)}</div>` : ""}${
        config.axes.filter(a => a.kind === "fond").map(f => {
            const fv = r.vals[f.key] || { v: 0, acc: 0 }, mv = r.vals[f.mirror] || { v: 0, acc: 0 };
            const mirror = config.axes.find(a => a.key === f.mirror);
            return `<div class="sl-fk-row"><span class="sl-fk-lab sl-fond">${escHtml(f.name)} <b>${fv.v}</b>${fv.acc ? `<small>+${fv.acc}</small>` : ""}</span>`
                + `<span class="sl-fk-bar sl-fond"><i style="width:${Math.max(0, Math.min(100, fv.v / max * 100))}%"></i></span>`
                + `<span class="sl-fk-bar sl-friction"><i style="width:${Math.max(0, Math.min(100, mv.v / max * 100))}%"></i></span>`
                + `<span class="sl-fk-lab sl-friction"><b>${mv.v}</b>${mv.acc ? `<small>+${mv.acc}</small>` : ""} ${escHtml(mirror ? mirror.name : f.mirror)}</span></div>`;
        }).join("")}</div>`).join("");
    return wrap;
}

function syncNextTurnButton(outer, isNewest) {
    const head = outer.querySelector(":scope > summary");
    const existing = head && head.querySelector(".sl-next-turn");
    if (!head) return;
    if (isNewest && !existing) head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-next-turn" title="Set next turn dice and preview">🎲</span>`);
    else if (!isNewest && existing) existing.remove();
}

const FIXUP_TITLES = { missing: "Write the missing ledger comment", thoughts: "Add the missing Thoughts" };

/** ✎ asks the model for the part of the ledger this reply lacks. `fixup` is null, "missing" or "thoughts". */
export function syncFixupButton(outer, fixup) {
    const head = outer.querySelector(":scope > summary");
    if (!head) return;
    const existing = head.querySelector(".sl-fixup");
    if (!fixup) { if (existing) existing.remove(); return; }
    if (!existing) head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-fixup" title="${FIXUP_TITLES[fixup]}">✎</span>`);
    else if (existing.title !== FIXUP_TITLES[fixup]) existing.title = FIXUP_TITLES[fixup];
}

function fateChips(section) {
    const rows = [...section.querySelectorAll("li, p, div")].filter(el => !el.querySelector("li, p, div"));
    for (const row of rows) {
        let html = row.innerHTML;
        if (/This turn:/i.test(row.textContent)) {
            html = html.replace(/\b(AMBIENT|MINOR|MAJOR)\b/gi, tier => `<span class="sl-ui-inline sl-fk-tier sl-fk-tier-${tier.toLowerCase()}">${tier}</span>`);
        }
        if (/\(fudged(?::[^)]*)?\)/i.test(row.textContent)) {
            html = html.replace(/\(fudged(?::[^)]*)?\)/gi, marker => `<span class="sl-ui-inline sl-fk-fudged">${marker}</span>`);
        }
        if (html !== row.innerHTML) { row.dataset.slOrig = row.innerHTML; row.innerHTML = html; }
    }
}

/** Decorate the rendered block inside `root` (a .mes_text element). */
export const decorate = (root, ctx) => decorateWith(root, ctx, "frankenstein");

/**
 * The shared decoration — ↻ and 🎲 controls, relationship bars, notebook tags,
 * Chekhov chips, Fate tier chips — under theme `theme`. Other themes build on it.
 * Returns true when it decorated afresh, false when the block already had `theme`.
 */
export function decorateWith(root, { config, isNewest = false, fixup = null }, theme) {
    const outer = outerDetails(root);
    if (!outer) return false;
    if (outer.dataset.slTheme === theme) { syncNextTurnButton(outer, isNewest); syncFixupButton(outer, fixup); return false; }
    undecorate(root);
    outer.dataset.slTheme = theme;
    outer.classList.add(`sl-theme-${theme}`);
    const head = outer.querySelector(":scope > summary");
    head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-rebuild" title="Rebuild this block from the one before it and this reply's ledger comment">↻</span>`);
    syncNextTurnButton(outer, isNewest);
    syncFixupButton(outer, fixup);
    for (const d of outer.querySelectorAll("details")) {
        const s = d.querySelector(":scope > summary");
        if (!s) continue;
        const title = s.textContent;
        const grp = GROUPS.find(([re]) => re.test(title));
        if (grp) d.classList.add("sl-fk-section", grp[1]);
        if (/RELATIONSHIPS/i.test(title)) {
            const bars = relationBars(d, config);
            if (bars) { d.classList.add("sl-fk-has-bars"); s.insertAdjacentElement("afterend", bars); }
        }
        if (/NOTEBOOK/i.test(title)) {
            for (const node of [...d.querySelectorAll("li, p, span, div")].filter(n => !n.children.length || n.tagName === "LI")) {
                if (/\[(R|T)\]/.test(node.innerHTML) && !node.closest(".sl-ui")) {
                    node.dataset.slOrig = node.innerHTML;
                    node.innerHTML = node.innerHTML.replace(/\[(R|T)\]/g, (_, k) => `<span class="sl-ui-inline sl-fk-tag sl-fk-${k}">${k}</span>`);
                }
            }
        }
        if (/CHEKHOV/i.test(title)) chekhovChips(d);
        if (/FATE ROUTINE/i.test(title)) fateChips(d);
    }
    return true;
}

// Bullet tags as chips: hot · eligible · secret · LOCKED … · at … (scheduled, or due once reached) · fired: …
// Only the tag part of a row is touched — never the setup's description.
const CHIP_RES = [
    [/·\s*(hot)\b/g, () => "hot"], [/·\s*(eligible)\b/g, () => "eligible"], [/·\s*(secret)\b/g, () => "secret"],
    [/·\s*(LOCKED .+?)(?=\s·\s(?:at |after B|eligible)|$|<)/g, () => "locked"],
    [/·\s*(at (?:Day \d+ )?\d{1,2}:\d{2}(?: next-day)?(?: reached)?)/g, t => (/reached$/.test(t) ? "due" : "scheduled")],
    [/\|\s*(fired:)/g, () => "fired"],
];
const TAGS_START = /\|\s*(?:w[123]\s·\sage|fired:)/;
const chipLine = line => {
    const at = line.search(TAGS_START);
    if (at < 0) return line;
    let tags = line.slice(at);
    for (const [re, kind] of CHIP_RES) tags = tags.replace(re, (m, t) => `${m.startsWith("|") ? "| " : " "}<span class="sl-ui-inline sl-fk-chip sl-fk-${kind(t)}">${t}</span>`);
    return line.slice(0, at) + tags;
};
function chekhovChips(section) {
    for (const child of [...section.childNodes]) {
        if (child.nodeType === 1 && (child.tagName === "SUMMARY" || child.classList.contains("sl-ui"))) continue;
        let el = child;
        if (child.nodeType === 3) {
            if (!child.textContent.trim()) continue;
            el = document.createElement("span");
            el.dataset.slWrap = child.textContent;   // the original text, restored by undecorate
            child.replaceWith(el);
            el.textContent = child.textContent;
        }
        if (el.nodeType !== 1) continue;
        const html = el.innerHTML.split(/(<br\s*\/?>|\n)/i).map(part => (/^(<br\s*\/?>|\n)$/i.test(part) ? part : chipLine(part))).join("");
        if (html !== el.innerHTML) { if (!el.dataset.slWrap) el.dataset.slOrig = el.innerHTML; el.innerHTML = html; }
    }
}
