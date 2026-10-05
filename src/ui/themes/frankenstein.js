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

const escHtml = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function outerDetails(root) {
    return [...root.querySelectorAll("details")].find(d => {
        const s = d.querySelector(":scope > summary");
        return s && /INTERNAL STATES/i.test(s.textContent);
    }) || null;
}

function relationBars(section, config) {
    const text = section.textContent;
    const rows = [];
    const re = /([^\n|]+?)\s→\s([^\n|]+?)\s*\|\s*((?:[A-Za-z]{1,3}\s+-?\d+·-?\d+\s*)+)/g;
    let m;
    while ((m = re.exec(text))) {
        const vals = {};
        for (const t of m[3].matchAll(/([A-Za-z]{1,3})\s+(-?\d+)·(-?\d+)/g)) vals[t[1]] = { v: Number(t[2]), acc: Number(t[3]) };
        rows.push({ from: m[1].replace(/^[-*•\s]+/, "").trim(), to: m[2].trim(), vals });
    }
    if (!rows.length) return null;
    const max = config.axisMax || 20;
    const wrap = document.createElement("div");
    wrap.className = "sl-ui sl-fk-pairs";
    wrap.innerHTML = rows.map(r => `<div class="sl-fk-pair"><div class="sl-fk-pair-name">${escHtml(r.from)} → ${escHtml(r.to)}</div>${
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

/** Decorate the rendered block inside `root` (a .mes_text element). */
export function decorate(root, { config }) {
    const outer = outerDetails(root);
    if (!outer || outer.dataset.slTheme === "frankenstein") return;
    undecorate(root);
    outer.dataset.slTheme = "frankenstein";
    outer.classList.add("sl-theme-frankenstein");
    const head = outer.querySelector(":scope > summary");
    head.insertAdjacentHTML("beforeend", `<span class="sl-ui sl-rebuild" title="Rebuild this block from the one before it and this reply's ledger comment">↻</span>`);
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
    }
}

/** Undo everything decorate() did inside `root`. */
export function undecorate(root) {
    root.querySelectorAll(".sl-ui").forEach(n => n.remove());
    root.querySelectorAll("[data-sl-orig]").forEach(n => { n.innerHTML = n.dataset.slOrig; delete n.dataset.slOrig; });
    root.querySelectorAll(".sl-fk-section, .sl-theme-frankenstein").forEach(n => {
        n.classList.remove("sl-fk-section", "sl-grp-people", "sl-grp-memory", "sl-grp-sim", "sl-fk-has-bars", "sl-theme-frankenstein");
        delete n.dataset.slTheme;
    });
}
