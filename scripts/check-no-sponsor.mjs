/**
 * Fails if sponsor code reached the browser bundle of a build made with the switch off.
 * Run after `next build`. NEXT_DIST_DIR picks the build, the same as next.config.ts.
 */
import fs from "node:fs";
import path from "node:path";

if (process.env.NEXT_PUBLIC_SPONSOR_UI === "1") {
  console.log("Sponsor UI is switched on for this build, so there is nothing to check.");
  process.exit(0);
}
const dir = path.join(process.env.NEXT_DIST_DIR || ".next", "static");
const needle = /bryntum|ag-studio/i;
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(dir);
const hits = files.filter((f) => needle.test(fs.readFileSync(f, "latin1")));
if (hits.length) {
  console.error(`Sponsor code found in the browser bundle:\n${hits.join("\n")}`);
  process.exit(1);
}
console.log(`No sponsor code in ${files.length} browser files.`);
