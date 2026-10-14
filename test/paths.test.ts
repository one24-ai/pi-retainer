import assert from "node:assert/strict";
import { test } from "node:test";
import { backupDirFor, dataDir, defaultDbPath, resolveDb } from "../extensions/retainer/paths.ts";

const home = "/home/u";

test("the default is the XDG data directory under home", () => {
	assert.equal(defaultDbPath({}, home), "/home/u/.local/share/pi-retainer/retainer.db");
	assert.deepEqual(resolveDb({}, home), { path: "/home/u/.local/share/pi-retainer/retainer.db", source: "default" });
});

test("XDG_DATA_HOME is honoured when absolute and ignored when relative or empty", () => {
	assert.equal(dataDir({ XDG_DATA_HOME: "/data" }, home), "/data/pi-retainer");
	assert.equal(dataDir({ XDG_DATA_HOME: "data" }, home), "/home/u/.local/share/pi-retainer");
	assert.equal(dataDir({ XDG_DATA_HOME: "" }, home), "/home/u/.local/share/pi-retainer");
});

test("PI_RETAINER_DB overrides the default", () => {
	assert.deepEqual(resolveDb({ PI_RETAINER_DB: "/a.db" }, home), { path: "/a.db", source: "env" });
});

test("snapshots go beside the database, default or overridden", () => {
	assert.equal(backupDirFor(resolveDb({}, home)), "/home/u/.local/share/pi-retainer/backups");
	assert.equal(backupDirFor({ path: "/data/x/retainer.db", source: "env" }), "/data/x/backups");
});
