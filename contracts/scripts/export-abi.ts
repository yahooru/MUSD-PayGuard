/** Writes abi/PayGuardRouter.json from the compiled artifact (no network access). */
import hre from "hardhat";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

async function main() {
  const artifact = await hre.artifacts.readArtifact("PayGuardRouter");
  const dir = path.resolve(__dirname, "..", "abi");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "PayGuardRouter.json"), JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`Wrote ${artifact.abi.length} ABI entries to abi/PayGuardRouter.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
