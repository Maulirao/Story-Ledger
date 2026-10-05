// ──────────────────────────────────────────────────────────────────────────────
// Every state section beyond the phase-1 three (scene, relationships, notebook), in
// the order they are written into the block. Each module implements the section
// interface documented in docs/superpowers/plans/2026-10-05-phase-2-people-and-story.md.
// ──────────────────────────────────────────────────────────────────────────────

import locations from "./locations.js";

export const SECTIONS = [locations];

/** Sections switched on in `sections` (a key that is missing counts as on). */
export const enabledSections = (sections = {}) => SECTIONS.filter(s => (sections || {})[s.key] !== false);

export const sectionByKey = key => SECTIONS.find(s => s.key === key) || null;

/** The phase-1 sections, by key. */
export const CORE_KEYS = ["scene", "relationships", "notebook"];
