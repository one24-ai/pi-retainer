import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_SETTINGS, loadSettings, parseSettings, settingsPath } from "../extensions/retainer/settings.ts";

test("no file: the defaults, and no error", () => {
	const r = loadSettings(join(tmpdir(), "pi-retainer-none", "pi-retainer.json"));
	assert.deepEqual(r.settings, DEFAULT_SETTINGS);
	assert.equal(r.error, undefined);
});

test("values are taken, clamped and type-checked one by one", () => {
	assert.equal(DEFAULT_SETTINGS.summaries.save, false, "summaries are not saved unless asked for");
	const s = parseSettings({
		recall: { maxChars: 2500, maxItems: 1000, globalShare: 2, inlineChars: "big" },
		write: { warnChars: -5 },
		summaries: { save: true, keep: 1.6 },
		backup: { everyHours: 0 },
		other: 1,
	});
	assert.equal(s.recall.maxChars, 2500);
	assert.equal(s.recall.maxItems, 200, "clamped to the maximum");
	assert.equal(s.recall.globalShare, 1, "clamped to 1");
	assert.equal(s.recall.inlineChars, DEFAULT_SETTINGS.recall.inlineChars, "wrong type: default");
	assert.equal(s.write.warnChars, 0, "clamped to 0, which turns the warning off");
	assert.equal(s.summaries.save, true);
	assert.equal(s.summaries.keep, 2, "rounded");
	assert.equal(s.summaries.maxChars, DEFAULT_SETTINGS.summaries.maxChars, "missing: default");
	assert.equal(s.backup.everyHours, 0);
	assert.equal(s.backup.keep, DEFAULT_SETTINGS.backup.keep);
	assert.equal(s.tools.exposure, "direct", "missing: default");
	assert.equal(parseSettings({ tools: { exposure: "deferred" } }).tools.exposure, "deferred");
	assert.equal(parseSettings({ tools: { exposure: "codemode" } }).tools.exposure, "codemode");
	assert.equal(parseSettings({ tools: { exposure: "hidden" } }).tools.exposure, "direct", "not one of ours: default");
});

test("anything that is not an object is the defaults", () => {
	for (const raw of [null, 3, "x", [], { recall: [] }]) assert.deepEqual(parseSettings(raw), DEFAULT_SETTINGS);
});

test("a malformed file gives the defaults and says why", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-retainer-settings-"));
	try {
		const path = join(dir, "pi-retainer.json");
		writeFileSync(path, "{ recall: ");
		const r = loadSettings(path);
		assert.deepEqual(r.settings, DEFAULT_SETTINGS);
		assert.match(r.error ?? "", /not valid JSON/);
		writeFileSync(path, JSON.stringify({ recall: { maxChars: 1234 } }));
		assert.equal(loadSettings(path).settings.recall.maxChars, 1234);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("the file lives in pi's agent directory", () => {
	assert.equal(settingsPath("/cfg"), "/cfg/pi-retainer.json");
});

test("a recall budget too small for the header is raised; 0 turns recall off", () => {
	assert.equal(parseSettings({ recall: { maxChars: 100 } }).recall.maxChars, 500);
	assert.equal(parseSettings({ recall: { maxChars: 0 } }).recall.maxChars, 0);
});

test("write.checkSecrets and write.similarity: defaults, zero, clamping and wrong types", () => {
	assert.equal(DEFAULT_SETTINGS.write.checkSecrets, true);
	assert.equal(DEFAULT_SETTINGS.write.similarity, 0.5);
	assert.equal(parseSettings({ write: { checkSecrets: false } }).write.checkSecrets, false);
	assert.equal(parseSettings({ write: { checkSecrets: "no" } }).write.checkSecrets, true, "not a boolean: the default");
	assert.equal(parseSettings({ write: { similarity: 0 } }).write.similarity, 0, "0 turns it off");
	assert.equal(parseSettings({ write: { similarity: 0.05 } }).write.similarity, 0.2, "raised to the floor");
	assert.equal(parseSettings({ write: { similarity: -1 } }).write.similarity, 0.2);
	assert.equal(parseSettings({ write: { similarity: 7 } }).write.similarity, 1, "capped at 1");
	assert.equal(parseSettings({ write: { similarity: "high" } }).write.similarity, 0.5, "not a number: the default");
	assert.equal(parseSettings({ write: { similarity: 0.8 } }).write.similarity, 0.8);
});

test("compact settings: defaults and limits", () => {
	assert.deepEqual(DEFAULT_SETTINGS.compact, { maxPerRun: 25, concurrency: 3 });
	assert.deepEqual(parseSettings({ compact: { maxPerRun: 1000, concurrency: 99 } }).compact, { maxPerRun: 200, concurrency: 8 });
	assert.deepEqual(parseSettings({ compact: { maxPerRun: 0, concurrency: -2 } }).compact, { maxPerRun: 1, concurrency: 1 });
	assert.deepEqual(parseSettings({ compact: { maxPerRun: "many" } }).compact, { maxPerRun: 25, concurrency: 3 });
});
