// ──────────────────────────────────────────────────────────────────────────────
// Every state section beyond the phase-1 three (scene, relationships, notebook), in
// the order they are written into the block. Each module implements the section
// interface documented in docs/superpowers/plans/2026-10-05-phase-2-people-and-story.md.
// ──────────────────────────────────────────────────────────────────────────────

import cast from "./cast.js";
import agendas from "./agendas.js";
import locations from "./locations.js";
import factions from "./factions.js";
import quests from "./quests.js";
import inventory from "./inventory.js";
import last from "./last.js";

export const SECTIONS = [cast, agendas, locations, factions, quests, inventory, last];

/** Sections switched on in `sections` (a key that is missing counts as on). */
export const enabledSections = (sections = {}) => SECTIONS.filter(s => (sections || {})[s.key] !== false);

export const sectionByKey = key => SECTIONS.find(s => s.key === key) || null;

/** The phase-1 sections, by key. */
export const CORE_KEYS = ["scene", "relationships", "notebook"];
