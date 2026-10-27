import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(new URL(path, `file://${root}`), "utf8"));
const manifest = readJson("config/chatone-fork.json");
assert.match(manifest.upstreamTag, /^v\d+\.\d+\.\d+$/);
assert.match(manifest.upstreamCommit, /^[a-f0-9]{40}$/);
assert.equal(readJson("package.json").version, manifest.upstreamVersion);
assert.equal(readJson("package-lock.json").packages[""].version, manifest.upstreamVersion);
assert.match(manifest.dockerBase, /@sha256:[a-f0-9]{64}$/);
assert.ok(
  readFileSync(new URL("Dockerfile", `file://${root}`), "utf8").includes(
    `FROM ${manifest.dockerBase} AS base`
  )
);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
assert.equal(git("rev-parse", `${manifest.upstreamTag}^{commit}`), manifest.upstreamCommit);
git("merge-base", "--is-ancestor", manifest.upstreamCommit, "HEAD");
console.log(
  `ChatOne fork ${manifest.upstreamVersion}-chatone.${manifest.forkRevision}; verified base ${manifest.upstreamCommit}`
);
