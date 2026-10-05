// ──────────────────────────────────────────────────────────────────────────────
// What every display theme shares: undoing a decoration. Themes only add nodes
// marked .sl-ui / .sl-ui-inline, wrap text in [data-sl-wrap], stash originals in
// [data-sl-orig] and add sl-* classes — so one undo serves them all. The message
// text is never touched.
// ──────────────────────────────────────────────────────────────────────────────

const THEME_CLASSES = [
    "sl-fk-section", "sl-grp-people", "sl-grp-memory", "sl-grp-sim", "sl-fk-has-bars",
    "sl-theme-frankenstein", "sl-theme-sola", "sl-theme-megumin",
    "sl-sola-card", "sl-sola-bond", "sl-sola-cabinet", "sl-sola-note", "sl-mg-hidden",
];

/** Undo whatever a theme did inside `root` (a .mes_text element). */
export function undecorate(root) {
    root.querySelectorAll(".sl-ui").forEach(n => n.remove());
    // the HUD strip sits just before the block, outside its <details>
    root.querySelectorAll(".sl-sola-hud").forEach(n => n.remove());
    root.querySelectorAll("[data-sl-orig]").forEach(n => { n.innerHTML = n.dataset.slOrig; delete n.dataset.slOrig; });
    root.querySelectorAll("[data-sl-wrap]").forEach(n => n.replaceWith(document.createTextNode(n.dataset.slWrap)));
    root.querySelectorAll(THEME_CLASSES.map(c => `.${c}`).join(", ")).forEach(n => {
        n.classList.remove(...THEME_CLASSES);
        delete n.dataset.slTheme;
        delete n.dataset.slTab;
    });
}
