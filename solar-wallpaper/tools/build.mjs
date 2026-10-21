// Builds the files in dist/ that come from src/ (see tools/bundles.mjs), so the pages work
// straight from disk (file://) and inside wallpaper apps, with no server.
import { writeFileSync } from "node:fs";
import { makeBundles } from "./bundles.mjs";

const files = await makeBundles();
for (const [path, text] of Object.entries(files)) {
  writeFileSync(new URL(`../${path}`, import.meta.url), text);
  console.log(`  ${path}  ${(text.length / 1024).toFixed(1)}kb`);
}
