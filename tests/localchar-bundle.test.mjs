// The committed bundle (localchar/dist/browser.mjs) is what LocalChar loads, so it must be what the
// source builds to, and it must be self-contained: LocalChar imports it from a Blob URL, where a
// relative or bare import has nothing to resolve against.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dist = new URL("../localchar/dist/", import.meta.url);

test("the bundle and its stylesheet are committed", () => {
    assert.ok(existsSync(new URL("browser.mjs", dist)), "run: npm run build:localchar");
    assert.ok(existsSync(new URL("style.css", dist)));
});

test("bundle has no import statements", () => {
    const code = readFileSync(new URL("browser.mjs", dist), "utf8");
    assert.doesNotMatch(code, /^\s*import\s/m, "a static import");
    assert.doesNotMatch(code, /^\s*export\s+\{[^}]*\}\s+from\s/m, "a re-export from another module");
    assert.doesNotMatch(code, /\bimport\s*\(/, "a dynamic import");
    assert.doesNotMatch(code, /\brequire\s*\(/);
    assert.match(code, /export\s*\{[^}]*\bregister\b|export default/, "it still exports register as the default");
});

test("bundle is fresh", async t => {
    let esbuild;
    try { esbuild = await import("esbuild"); } catch { t.skip("esbuild is not installed here (npm install); freshness NOT checked"); return; }
    const { buildBrowser } = await import("../localchar/build.mjs");
    const out = mkdtempSync(join(tmpdir(), "sl-bundle-"));
    try {
        await buildBrowser({ outdir: out, esbuild });
        const fresh = readFileSync(join(out, "browser.mjs"), "utf8");
        const committed = readFileSync(new URL("browser.mjs", dist), "utf8");
        assert.equal(committed.replace(/\r\n/g, "\n"), fresh.replace(/\r\n/g, "\n"), "the bundle is stale: run npm run build:localchar and commit it");
        const css = readFileSync(join(out, "style.css"), "utf8");
        assert.equal(readFileSync(new URL("style.css", dist), "utf8").replace(/\r\n/g, "\n"), css.replace(/\r\n/g, "\n"));
    } finally { rmSync(out, { recursive: true, force: true }); }
});
