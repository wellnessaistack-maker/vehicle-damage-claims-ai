// Copies the demo and test photos into public/ so the browser can load them.
// Runs before dev and build; public/demo and public/eval are not committed.
import { cpSync, rmSync } from "node:fs";

for (const [from, to] of [
  ["demo-images", "public/demo"],
  ["eval/images", "public/eval/images"],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
