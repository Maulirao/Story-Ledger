// Builds what LocalChar loads: localchar/dist/browser.mjs (one self-contained ES module, no imports:
// LocalChar imports it from a Blob URL) and localchar/dist/style.css. Run `npm run build:localchar` and
// commit the result; tests/localchar-bundle.test.mjs fails when the committed bundle is stale.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export async function buildBrowser({ outdir = join(here, "dist"), esbuild = null } = {}) {
    esbuild ||= await import("esbuild");
    mkdirSync(outdir, { recursive: true });
    await esbuild.build({
        entryPoints: [join(here, "browser.mjs")],
        outfile: join(outdir, "browser.mjs"),
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        charset: "utf8",
        legalComments: "none",
        absWorkingDir: root,
        logLevel: "warning",
    });
    // LocalChar's mapping of SillyTavern's theme variables and classes first, then the extension's own CSS.
    const css = `${readFileSync(join(here, "style.css"), "utf8")}\n${readFileSync(join(root, "style.css"), "utf8")}`;
    writeFileSync(join(outdir, "style.css"), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await buildBrowser();
    console.log("built localchar/dist/browser.mjs and style.css");
}
