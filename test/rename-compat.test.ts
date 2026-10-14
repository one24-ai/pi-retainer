/**
 * pi-retainer was called pi-domain. These check that what pi-domain left behind keeps working:
 * its environment variables, its database where it lies, its settings file and its snapshots.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listBackups, pruneBackups } from "../extensions/retainer/backup.ts";
import { legacyDbPath, resolveDb } from "../extensions/retainer/paths.ts";
import { findSnapshot, type SnapshotInfo } from "../extensions/retainer/restore.ts";
import { defaultRepoRoots } from "../extensions/retainer/scope.ts";
import { settingsPath } from "../extensions/retainer/settings.ts";

const home = "/home/u";
const temp = () => mkdtempSync(join(tmpdir(), "pi-retainer-compat-"));

test("PI_DOMAIN_DB and PI_DOMAIN_REPOS still work, and the new names win", () => {
	assert.deepEqual(resolveDb({ PI_DOMAIN_DB: "/old.db" }, home), { path: "/old.db", source: "env" });
	assert.deepEqual(resolveDb({ PI_DOMAIN_DB: "/old.db", PI_RETAINER_DB: "/new.db" }, home), { path: "/new.db", source: "env" });
	assert.deepEqual(defaultRepoRoots({ PI_DOMAIN_REPOS: "/a:/b" }, home), ["/a", "/b"]);
	assert.deepEqual(defaultRepoRoots({ PI_DOMAIN_REPOS: "/a", PI_RETAINER_REPOS: "/c" }, home), ["/c"]);
});

test("pi-domain's database is used where it is until a pi-retainer one exists", () => {
	const legacy = "/home/u/.local/share/pi-domain/domain.db";
	const fresh = "/home/u/.local/share/pi-retainer/retainer.db";
	assert.equal(legacyDbPath({}, home), legacy);
	assert.equal(legacyDbPath({ XDG_DATA_HOME: "/data" }, home), "/data/pi-domain/domain.db");
	assert.deepEqual(resolveDb({}, home, (p) => p === legacy), { path: legacy, source: "default" });
	assert.deepEqual(resolveDb({}, home, (p) => p === legacy || p === fresh), { path: fresh, source: "default" });
	assert.deepEqual(resolveDb({}, home, () => false), { path: fresh, source: "default" });
});

test("pi-domain.json is copied to pi-retainer.json once, and never over an existing one", () => {
	const dir = temp();
	try {
		writeFileSync(join(dir, "pi-domain.json"), '{"backup":{"keep":5}}');
		assert.equal(settingsPath(dir), join(dir, "pi-retainer.json"));
		assert.equal(readFileSync(join(dir, "pi-retainer.json"), "utf8"), '{"backup":{"keep":5}}');
		writeFileSync(join(dir, "pi-retainer.json"), '{"backup":{"keep":9}}');
		settingsPath(dir);
		assert.equal(readFileSync(join(dir, "pi-retainer.json"), "utf8"), '{"backup":{"keep":9}}');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pi-domain's snapshots are listed, pruned and found alongside the new ones", () => {
	const dir = temp();
	try {
		for (const f of ["domain-20261003-120000.db", "domain-20261004-120000.db", "retainer-20261005-120000.db", "other-20261005-120000.db"]) writeFileSync(join(dir, f), "x");
		assert.deepEqual(listBackups(dir), ["retainer-20261005-120000.db", "domain-20261004-120000.db", "domain-20261003-120000.db"]);
		assert.deepEqual(pruneBackups(dir, 2), ["domain-20261003-120000.db"]);
		const snaps = listBackups(dir).map((name) => ({ name }) as SnapshotInfo);
		assert.equal(findSnapshot(snaps, "20261004-120000")?.name, "domain-20261004-120000.db");
		assert.equal(findSnapshot(snaps, "20261005-120000")?.name, "retainer-20261005-120000.db");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
