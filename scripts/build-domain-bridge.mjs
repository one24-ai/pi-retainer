#!/usr/bin/env node
/**
 * Prepare compat/pi-domain, the package published under the old name: it bundles this exact
 * version of pi-retainer and loads its extension, so `pi install npm:pi-domain` keeps working.
 * The release workflow runs it after publishing pi-retainer, then publishes the bridge.
 *
 *   node scripts/build-domain-bridge.mjs
 *
 * It sets the bridge's version and its pi-retainer dependency to this package's version, copies
 * the peer dependencies and engines, points `pi.extensions` at the bundled copy, packs this
 * package and installs the tarball into compat/pi-domain/node_modules (without peers, which pi
 * supplies). It never publishes.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = join(root, "compat", "pi-domain");
const main = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bridgePath = join(bridgeDir, "package.json");
const bridge = JSON.parse(readFileSync(bridgePath, "utf8"));

bridge.version = main.version;
bridge.dependencies = { [main.name]: main.version };
bridge.peerDependencies = main.peerDependencies;
bridge.engines = main.engines;
bridge.pi = { extensions: main.pi.extensions.map((p) => `node_modules/${main.name}/${p.replace(/^\.\//, "")}`) };
writeFileSync(bridgePath, `${JSON.stringify(bridge, null, 2)}\n`);

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
const tarball = run("npm", ["pack", "--silent", "--ignore-scripts", "--pack-destination", bridgeDir], root).split("\n").pop();
rmSync(join(bridgeDir, "node_modules"), { recursive: true, force: true });
run("npm", ["install", `./${tarball}`, "--no-save", "--omit=peer", "--ignore-scripts", "--no-audit", "--no-fund"], bridgeDir);
rmSync(join(bridgeDir, tarball));
console.log(`compat/pi-domain ready: pi-domain ${bridge.version} bundling ${main.name} ${main.version}`);
