// Matching people named in change lines to the names already in the state.

/** The existing spelling of `name` (case-insensitive), or `name` as written. */
export function findName(names, name) {
    const want = String(name || "").trim();
    return (names || []).find(n => n.toLowerCase() === want.toLowerCase()) || want;
}

/** True when `name` is among `names`, ignoring case. */
export const hasName = (names, name) => (names || []).some(n => n.toLowerCase() === String(name || "").trim().toLowerCase());
