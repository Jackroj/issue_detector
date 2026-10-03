import * as esbuild from "esbuild";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");

const watch = process.argv.includes("--watch");

const ENTRY_POINTS = [
  "background/index.ts",
  "content/index.ts",
  "content/main-world.ts",
  "devtools/devtools.ts",
  "devtools/panel.ts",
  "popup/popup.ts",
  "options/options.ts",
];

const STATIC_EXTENSIONS = new Set([".html", ".css", ".png", ".json"]);

async function copyStaticFiles() {
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!STATIC_EXTENSIONS.has(ext)) continue;

      const relPath = path.relative(SRC, srcPath);
      const destPath = path.join(DIST, relPath);
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    }
  }
  await walk(SRC);
  await fs.copyFile(path.join(__dirname, "manifest.json"), path.join(DIST, "manifest.json"));
}

async function build() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });

  const options = {
    entryPoints: ENTRY_POINTS.map((e) => path.join(SRC, e)),
    outdir: DIST,
    outbase: SRC,
    bundle: true,
    format: "iife",
    target: "chrome111",
    sourcemap: true,
    logLevel: "info",
  };

  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    await copyStaticFiles();
    console.log("Watching for changes... (static files copied once; re-run build for static-only edits)");
  } else {
    await esbuild.build(options);
    await copyStaticFiles();
    console.log(`Build complete: ${DIST}`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
