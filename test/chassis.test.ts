import assert from "node:assert/strict";
import { test } from "node:test";
import { chassisLoaded, markPlainMessage, offerToolRows, registerSidebar, type SidebarState, toolRowSpecs } from "../extensions/retainer/chassis.ts";

const REGISTRY = Symbol.for("pi-chassis/registry");
const PENDING = Symbol.for("pi-chassis/pendingToolRows");
const PLAIN = Symbol.for("pi-chassis/plainMessageTypes");
const theme = { fg: (_c: string, t: string) => t };

test("chassisLoaded needs a registry with a register function", () => {
	assert.equal(chassisLoaded({}), false);
	assert.equal(chassisLoaded({ [REGISTRY]: {} }), false);
	assert.equal(chassisLoaded({ [REGISTRY]: { register: () => {} } }), true);
});

test("every memory tool has a complete row spec", () => {
	const specs = toolRowSpecs() as Record<string, any>;
	assert.deepEqual(Object.keys(specs).sort(), ["memory_forget", "memory_get", "memory_search", "memory_update", "memory_write"]);
	for (const [name, s] of Object.entries(specs)) {
		assert.equal(typeof s.title, "string", name);
		assert.equal(typeof s.describe, "function", name);
		assert.equal(typeof s.summarize, "function", name);
		assert.deepEqual(s.icon, { nerd: "\u{F09D1}", plain: "#" });
	}
	assert.equal(specs.memory_write.summarize({ details: { id: 7, deduplicated: false, long: true } }, {}, theme, false), "#7 saved long");
	assert.equal(specs.memory_search.summarize({ details: { count: 1 } }, {}, theme, false), "1 memory");
	assert.equal(specs.memory_get.describe({ ids: [3, 4] }, "/", theme), "#3 #4");
	assert.equal(specs.memory_forget.summarize({ content: [{ type: "text", text: "No memory #9 here" }] }, {}, theme, true), "No memory #9 here");
	// Arguments still streaming in are often incomplete; nothing may throw on them.
	for (const s of Object.values(specs)) {
		assert.doesNotThrow(() => s.describe(undefined, "/", theme));
		assert.doesNotThrow(() => s.summarize({}, undefined, theme, false));
	}
});

test("with chassis loaded the rows are registered under pi-retainer's id", () => {
	const calls: any[] = [];
	const g = { [REGISTRY]: { register() {}, toolRowsVersion: 1, registerToolRows: (specs: any, o: any) => (calls.push({ specs, o }), () => calls.push("removed")) } };
	const remove = offerToolRows(g);
	assert.equal(calls[0].o.id, "pi-retainer");
	assert.ok("memory_get" in calls[0].specs);
	remove();
	assert.equal(calls[1], "removed");
});

test("before chassis loads the rows wait in its queue, and a reload replaces the earlier entry", () => {
	const g: Record<symbol, any> = {};
	offerToolRows(g);
	offerToolRows(g);
	assert.equal(g[PENDING].length, 1, "one entry per owner");
	const remove = offerToolRows(g);
	let removedByHost = false;
	g[PENDING][0].attach(() => (removedByHost = true));
	remove();
	assert.equal(removedByHost, true, "removing after chassis took them calls chassis's remover");
	const g2: Record<symbol, any> = {};
	const r2 = offerToolRows(g2);
	r2();
	assert.equal(g2[PENDING].length, 0, "removing before chassis took them leaves the queue");
});

test("markPlainMessage adds to chassis's shared set, creating it if needed", () => {
	const g: Record<symbol, any> = {};
	markPlainMessage("memory-recall", g);
	assert.ok(g[PLAIN].has("memory-recall"));
	const existing = new Set(["other"]);
	const g2: Record<symbol, any> = { [PLAIN]: existing };
	markPlainMessage("memory-recall", g2);
	assert.equal(g2[PLAIN], existing);
	assert.deepEqual([...existing], ["other", "memory-recall"]);
});

test("the sidebar registers only with chassis, and shows only the recall size", () => {
	const state: SidebarState = { recalled: 0, total: 0, chars: 0, budget: 4000 };
	assert.equal(registerSidebar({}, {}, () => state, {}), undefined, "no chassis, no widget");

	let spec: any;
	let ctxGiven: unknown;
	const g = { [REGISTRY]: { apiVersion: 1, register: (_pi: unknown, s: any, c: unknown) => ((spec = s), (ctxGiven = c), { refresh() {}, dispose() {} }) } };
	const ctx = { hasUI: true };
	assert.ok(registerSidebar({}, ctx, () => state, g));
	assert.equal(ctxGiven, ctx, "the session's ctx is passed so the widget starts at once");
	assert.equal(spec.id, "pi-retainer");
	assert.equal(spec.sidebar, "section");
	assert.deepEqual(spec.render({}).text, "none yet");

	Object.assign(state, { recalled: 12, total: 31, chars: 3812 });
	assert.equal(spec.render({}).text, "12/31 · 3.8K/4.0K");
	assert.equal(spec.detail, undefined, "no list of memories");
	assert.equal(spec.onDetailClick, undefined);
});
