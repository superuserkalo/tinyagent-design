// Copies the built TinyAgent TypeScript SDK into vendor/tiny-agent-sdk so the
// site builds without the SDK's repository. Run it after rebuilding the SDK:
//   TINYAGENT_SDK=~/tinyagent/tinyagents/typescript npm run sync-sdk
// The SDK is not on npm yet; package.json depends on "file:./vendor/tiny-agent-sdk".
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(process.env.TINYAGENT_SDK ?? join(homedir(), "tinyagent/tinyagents/typescript"));
const target = resolve(import.meta.dirname, "../vendor/tiny-agent-sdk");
const dist = join(source, "dist");

if (!existsSync(join(dist, "browser.js"))) {
  console.error(`No built SDK at ${dist}. Run \`npm run build\` in ${source} first.`);
  process.exit(1);
}
// A dist older than its sources is stale: refuse rather than vendor old code.
const built = statSync(join(dist, "browser.js")).mtimeMs;
const stale = readdirSync(source).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
  && statSync(join(source, name)).mtimeMs > built);
if (stale.length) {
  console.error(`dist/ is older than ${stale.join(", ")}. Run \`npm run build\` in ${source} first.`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(dist, join(target, "dist"), { recursive: true });
cpSync(join(source, "LICENSE"), join(target, "LICENSE"));

// Keep what a consumer needs. Lifecycle scripts would try to rebuild from sources that are not here.
const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
delete pkg.scripts;
delete pkg.devDependencies;
delete pkg.bin;
pkg.files = ["dist"];
writeFileSync(join(target, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
console.log(`Vendored tiny-agent-sdk ${pkg.version} from ${source}`);
