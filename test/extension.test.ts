/**
 * The extension wired to a fake pi around pi's real SessionManager: recall once per context
 * (never again on reload or resume, again after compaction or on another branch), the tools as the
 * model sees them, and the chassis pairing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { MemoryStore } from "../extensions/retainer/store.ts";

const REGISTRY = Symbol.for("pi-chassis/registry");
const PENDING = Symbol.for("pi-chassis/pendingToolRows");
const PLAIN = Symbol.for("pi-chassis/plainMessageTypes");

let dir: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "pi-retainer-ext-"));
	for (const k of ["PI_RETAINER_DB", "PI_CODING_AGENT_DIR"]) saved[k] = process.env[k];
	process.env.PI_RETAINER_DB = join(dir, "retainer.db");
	process.env.PI_CODING_AGENT_DIR = dir;
	const g = globalThis as Record<symbol, unknown>;
	delete g[REGISTRY];
	delete g[PENDING];
	delete g[PLAIN];
});

afterEach(() => {
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
	rmSync(dir, { recursive: true, force: true });
});

/** A fake pi with a real in-memory session. */
function fakePi() {
	const handlers = new Map<string, Function[]>();
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const notes: string[] = [];
	const sm = SessionManager.inMemory(dir);
	const pi: any = {
		on: (name: string, fn: Function) => {
			handlers.set(name, [...(handlers.get(name) ?? []), fn]);
			return () => {};
		},
		registerTool: (t: any) => tools.set(t.name, t),
		registerCommand: (name: string, c: any) => commands.set(name, c),
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		sendUserMessage: () => {},
	};
	const ctx: any = {
		cwd: dir,
		hasUI: true,
		isIdle: () => true,
		ui: { notify: (m: string) => notes.push(m), confirm: async () => true, select: async () => undefined, setStatus: () => {}, onTerminalInput: () => () => {} },
		model: { provider: "test", id: "fake-model" },
		modelRegistry: { streamSimple: () => ({ result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "{}" }] }) }) },
		sessionManager: sm,
	};
	const emit = async (name: string, event: any = {}) => {
		let out: any;
		for (const fn of handlers.get(name) ?? []) out = (await fn({ type: name, ...event }, ctx)) ?? out;
		return out;
	};
	/** A prompt as pi runs it: before_agent_start, then the user message and what the handler added. */
	const prompt = async (text: string) => {
		const r = await emit("before_agent_start", { messageType: "user", prompt: text, images: [], systemPrompt: "", systemPromptOptions: {} });
		const userId = sm.appendMessage({ role: "user", content: text, timestamp: Date.now() } as any);
		if (r?.message) sm.appendCustomMessageEntry(r.message.customType, r.message.content, r.message.display, r.message.details);
		return { message: r?.message, userId };
	};
	const call = async (name: string, params: any) => {
		const result = await tools.get(name).execute("id", params, undefined, undefined, ctx);
		sm.appendMessage({ role: "toolResult", toolCallId: "t", toolName: name, content: result.content, details: result.details, isError: false, timestamp: Date.now() } as any);
		return result;
	};
	const recalls = () => sm.buildContextEntries().filter((e: any) => e.type === "custom_message" && e.customType === "memory-recall").length;
	return { pi, ctx, sm, tools, commands, notes, emit, prompt, call, recalls };
}

async function load() {
	const mod = await import(`../extensions/retainer/index.ts?${Math.random()}`);
	const f = fakePi();
	mod.default(f.pi);
	return f;
}

const scopeOf = () => `project:${dir.split("/").pop()}`;

function seed(texts: Array<[string, Partial<{ pinned: boolean; global: boolean; kind: string }>?]>) {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const ids: number[] = [];
	for (const [text, o = {}] of texts) ids.push(s.write({ scope: o.global ? "global" : scopeOf(), kind: (o.kind ?? "fact") as any, text, pinned: o.pinned }).row.id);
	s.close();
	return ids;
}

test("recall comes with the first prompt, once; a reload or resume does not add another", async () => {
	seed([["Use pnpm, never npm.", { pinned: true }], ["The build is tsc.", {}], ["A summary of a long session.", { kind: "summary" }]]);
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const { message: first } = await f.prompt("hello");
	assert.ok(first, "recall on the first prompt");
	assert.equal(first.customType, "memory-recall");
	assert.match(first.content, /Use pnpm, never npm\./);
	assert.ok(!first.content.includes("summary of a long session"), "summaries are never recalled");
	assert.deepEqual({ count: first.details.count, total: first.details.total }, { count: 2, total: 2 });

	assert.equal((await f.prompt("and again")).message, undefined, "not on later prompts");
	for (const reason of ["reload", "resume"]) {
		await f.emit("session_start", { reason });
		assert.equal((await f.prompt(`after ${reason}`)).message, undefined, `not after ${reason}`);
	}
	assert.equal(f.recalls(), 1);
});

test("a run another extension starts with a custom message gets no recall; the next prompt does", async () => {
	seed([["A fact.", {}]]);
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const custom = await f.emit("before_agent_start", { messageType: "custom", message: { role: "custom", customType: "other", content: "x" }, systemPrompt: "", systemPromptOptions: {} });
	assert.equal(custom, undefined);
	assert.ok((await f.prompt("hello")).message, "recall on the first user prompt");
	assert.equal(f.recalls(), 1);
});

test("a recall left by an older version counts as present", async () => {
	seed([["A fact.", {}]]);
	const f = await load();
	f.sm.appendCustomMessageEntry("memory-recall", "old recall", true, { count: 7 });
	await f.emit("session_start", { reason: "resume" });
	assert.equal((await f.prompt("hi")).message, undefined);
	f.sm.appendCustomMessageEntry("memory-recall", "older still", true, undefined);
	assert.equal((await f.prompt("hi")).message, undefined);
});

test("after compaction summarises the recall away, the next prompt recalls again", async () => {
	seed([["A fact.", {}]]);
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	await f.prompt("one");
	const { userId } = await f.prompt("two");
	f.sm.appendCompaction("summary of one", userId, 1000);
	await f.emit("session_compact", { compactionEntry: { summary: "summary of one" }, reason: "threshold" });
	assert.equal(f.recalls(), 0);
	assert.ok((await f.prompt("three")).message);
	assert.equal(f.recalls(), 1);
});

test("a compaction that keeps the recall does not repeat it", async () => {
	seed([["A fact.", {}]]);
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const { userId } = await f.prompt("one");
	f.sm.appendCompaction("summary", userId, 1000);
	await f.emit("session_compact", { compactionEntry: { summary: "summary" }, reason: "threshold" });
	assert.equal((await f.prompt("two")).message, undefined);
});

test("moving to a branch without the recall brings one on the next prompt", async () => {
	seed([["A fact.", {}]]);
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const root = f.sm.appendMessage({ role: "user", content: "before", timestamp: 1 } as any);
	await f.prompt("one");
	f.sm.branch(root);
	await f.emit("session_tree", { newLeafId: root, oldLeafId: null });
	assert.equal(f.recalls(), 0);
	assert.ok((await f.prompt("other way")).message);
});

test("an empty recall is worked out once, and its notice given once", async () => {
	seed([["x".repeat(2000), { pinned: true }]]);
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ recall: { maxChars: 500, inlineChars: 10_000 } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.equal((await f.prompt("one")).message, undefined);
	assert.equal((await f.prompt("two")).message, undefined);
	assert.equal(f.notes.filter((n) => /do(es)? not fit the recall budget/.test(n)).length, 1);
});

test("an empty database recalls nothing", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.equal((await f.prompt("hi")).message, undefined);
});

test("the recall budget from pi-retainer.json is respected", async () => {
	seed(Array.from({ length: 60 }, (_, i) => [`Memory ${i}: ${"some words ".repeat(20)}`, {}] as [string, {}]));
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ recall: { maxChars: 1500 } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const { message } = await f.prompt("hi");
	assert.ok(message.content.length <= 1500, `${message.content.length}`);
	assert.match(message.content, /more memories not listed/);
});

test("a memory matching the first prompt is listed even when it is not recent", async () => {
	seed([["The flaky widget test needs TZ=UTC to pass.", {}], ...Array.from({ length: 40 }, (_, i) => [`Unrelated note ${i} ${"filler ".repeat(30)}`, {}] as [string, {}])]);
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ recall: { maxChars: 1200 } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.match((await f.prompt("the widget test is flaky again")).message.content, /TZ=UTC/);
});

test("prompts full of search syntax do not break recall", async () => {
	seed([["A fact about package.json scripts.", {}]]);
	for (const p of ['NEAR AND OR "x* ^col: ____ -- ((', "package.json", "src/foo.ts node-sqlite", ""]) {
		const f = await load();
		await f.emit("session_start", { reason: "startup" });
		assert.ok((await f.prompt(p)).message, JSON.stringify(p));
	}
});

test("write warns on long text; search shortens; get gives it in full", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const long = `The deploy needs three steps. ${"Detail about the deploy. ".repeat(40)}`;
	const w = await f.call("memory_write", { text: long, kind: "fact" });
	assert.equal(w.details.long, true);
	assert.match(w.content[0].text, /Note: this memory is \d+ characters/);
	const short = await f.call("memory_write", { text: "Short one about deploy.", kind: "fact" });
	assert.equal(short.details.long, false);

	const s = await f.call("memory_search", { query: "deploy" });
	assert.match(s.content[0].text, /The deploy needs three steps\. \[\d+ chars\]/);
	assert.ok(s.content[0].text.length < 600, "search does not return the long text");
	assert.deepEqual(s.details.ids.sort(), [w.details.id, short.details.id].sort());

	const g = await f.call("memory_get", { ids: [w.details.id, w.details.id, 999] });
	assert.ok(g.content[0].text.includes(long));
	assert.match(g.content[0].text, /Not found here: #999/);
	assert.ok(!/Only the first/.test(g.content[0].text), "a repeated id is not counted twice");
	assert.deepEqual(g.details.ids, [w.details.id]);
});

test("memory_get stays under its size cap and names exactly what it returned", async () => {
	const ids = seed([
		["a".repeat(9000), {}],
		["b".repeat(9000), {}],
		["small", {}],
	]);
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const g = await f.call("memory_get", { ids });
	assert.deepEqual(g.details.ids, [ids[0], ids[2]], "the one that did not fit is skipped, the small one after it kept");
	assert.match(g.content[0].text, /1 memory left out/);
});

test("another project's memories cannot be read, changed or deleted", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const other = s.write({ scope: "project:elsewhere", kind: "fact", text: "secret of another project" }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.ok(!(await f.call("memory_get", { ids: [other.id] })).content[0].text.includes("secret"));
	await assert.rejects(() => f.call("memory_update", { id: other.id, text: "changed" }), /No memory/);
	await assert.rejects(() => f.call("memory_forget", { id: other.id, reason: "x" }), /No memory/);
	const check = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(check.get(other.id)?.text, "secret of another project");
	check.close();
});

test("the tools carry hints for permission extensions", async () => {
	const f = await load();
	assert.equal(f.tools.get("memory_search").annotations.readOnlyHint, true);
	assert.equal(f.tools.get("memory_get").annotations.readOnlyHint, true);
	assert.equal(f.tools.get("memory_forget").annotations.destructiveHint, true);
	assert.equal(f.tools.get("memory_write").annotations.destructiveHint, false);
});

test("the memory tools are declared directly unless pi-retainer.json says otherwise", async () => {
	const names = ["memory_write", "memory_update", "memory_search", "memory_get", "memory_forget"];
	const f = await load();
	for (const n of names) assert.equal(f.tools.get(n).exposure, "direct", n);
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ tools: { exposure: "deferred" } }));
	const g = await load();
	for (const n of names) assert.equal(g.tools.get(n).exposure, "deferred", n);
});

test("the model may save only facts and gotchas, but search still finds older kinds", async () => {
	const f = await load();
	const kinds = (schema: any): string[] => schema.enum ?? schema.anyOf.map((s: any) => s.const);
	assert.deepEqual(kinds(f.tools.get("memory_write").parameters.properties.kind), ["fact", "gotcha"]);
	assert.deepEqual(kinds(f.tools.get("memory_update").parameters.properties.kind), ["fact", "gotcha"]);
	assert.ok(kinds(f.tools.get("memory_search").parameters.properties.kinds.items).includes("decision"));
});

test("what the tools cost in every request stays small", async () => {
	const f = await load();
	let total = 0;
	for (const t of f.tools.values()) {
		total += JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length;
		total += (t.promptSnippet?.length ?? 0) + (t.promptGuidelines ?? []).join("\n").length;
	}
	// 3227 characters for four tools before this was trimmed; five tools and a project argument now.
	assert.ok(total < 3400, `${total} characters`);
});

test("without chassis: no widget, rows queued for chassis, the recall type marked plain", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const g = globalThis as Record<symbol, any>;
	assert.equal(g[PENDING]?.length, 1);
	assert.equal(g[PENDING][0].id, "pi-retainer");
	assert.ok(g[PLAIN].has("memory-recall"));
});

test("with chassis: the sidebar follows recall, resume and branch moves", async () => {
	seed([["A fact.", {}], ["Another.", { global: true }]]);
	let spec: any;
	let refreshed = 0;
	(globalThis as Record<symbol, any>)[REGISTRY] = {
		apiVersion: 1,
		register: (_pi: unknown, s: any) => ((spec = s), { refresh: () => refreshed++, dispose() {} }),
		toolRowsVersion: 1,
		registerToolRows: () => () => {},
	};
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.equal(spec.id, "pi-retainer");
	const root = f.sm.appendMessage({ role: "user", content: "start", timestamp: 1 } as any);
	await f.prompt("hi");
	assert.match(spec.render({}).text, /^2\/2 · /);
	const w = await f.call("memory_write", { text: "Saved now.", kind: "gotcha" });
	assert.ok(w.details.id);
	assert.equal(spec.detail, undefined, "the sidebar lists no memories");

	await f.emit("session_start", { reason: "resume" });
	assert.match(spec.render({}).text, /^2\/2 · /, "recall numbers from the recall message");

	f.sm.branch(root);
	await f.emit("session_tree", { newLeafId: root, oldLeafId: null });
	assert.equal(spec.render({}).text, "none yet", "nothing recalled on that branch yet");
});

test("a malformed settings file is reported and the defaults used", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), "{nope");
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.ok(f.notes.some((n) => /ignoring .*pi-retainer\.json/.test(n)));
});

// ------------------------------------------------------------------ work done for another project

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

/** A fake pi whose session starts in `cwd` (the shared fake uses the temp dir itself). */
async function loadIn(cwd: string) {
	const mod = await import(`../extensions/retainer/index.ts?${Math.random()}`);
	const f = fakePi();
	f.ctx.cwd = cwd;
	mod.default(f.pi);
	return f;
}

function repoAt(path: string) {
	mkdirSync(path, { recursive: true });
	execFileSync("git", ["init", "-q"], { cwd: path });
}

test("from a plain folder, a memory can be filed under another project, by name or by directory", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	repoAt(join(dir, "git", "atlas"));
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: "project:atlas", kind: "fact", text: "Existing atlas fact." });
	s.close();
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });

	const byName = await f.call("memory_write", { text: "Atlas retries three times.", kind: "fact", project: "atlas" });
	assert.equal(byName.details.scope, "project:atlas");
	assert.match(byName.content[0].text, /Filed under project:atlas, not this folder's project\./);

	const byPath = await f.call("memory_write", { text: "A new project's first memory.", kind: "fact", project: join(dir, "git", "atlas") });
	assert.equal(byPath.details.scope, "project:atlas");

	const here = await f.call("memory_write", { text: "A note about the home folder.", kind: "fact" });
	assert.equal(here.details.scope, `project:${home.split("/").pop()}`);
	assert.ok(!/Filed under/.test(here.content[0].text), "no note when it went where the folder says");

	const g = await f.call("memory_write", { text: "Applies everywhere.", kind: "fact", global: true });
	assert.equal(g.details.scope, "global");
	assert.ok(!/Filed under/.test(g.content[0].text));
});

test("a typo in project is refused and nothing is written", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: "project:atlas", kind: "fact", text: "Existing atlas fact." });
	s.close();
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });
	await assert.rejects(() => f.call("memory_write", { text: "Typo.", kind: "fact", project: "atlsa" }), /no project named atlsa has memories \(known: atlas\)/);
	await assert.rejects(() => f.call("memory_write", { text: "Both.", kind: "fact", project: "atlas", global: true }), /either global or project/);
	const check = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.deepEqual(check.scopes(), ["project:atlas"], "no new scope appeared");
	check.close();
});

test("project reads, moves and deletes work across projects, and still refuse other projects' ids without it", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const k = s.write({ scope: "project:atlas", kind: "fact", text: "Atlas runs jobs in containers by default." }).row;
	const h = s.write({ scope: `project:${home.split("/").pop()}`, kind: "fact", text: "Misfiled: atlas needs a retry policy." }).row;
	s.close();
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });

	// without project: atlas's memory is out of reach
	await assert.rejects(() => f.call("memory_update", { id: k.id, text: "changed" }), /No memory/);
	assert.ok(!(await f.call("memory_search", { query: "containers" })).content[0].text.includes("containers"));
	assert.ok(!(await f.call("memory_get", { ids: [k.id] })).content[0].text.includes("containers"));

	// with project: it can be read and changed
	assert.match((await f.call("memory_search", { query: "containers", project: "atlas" })).content[0].text, /containers/);
	assert.match((await f.call("memory_get", { ids: [k.id], project: "atlas" })).content[0].text, /containers/);
	const upd = await f.call("memory_update", { id: k.id, text: "Atlas runs jobs in containers, strong isolation when policy says.", in: "atlas" });
	assert.equal(upd.details.scope, "project:atlas");
	assert.ok(!/Moved from/.test(upd.content[0].text), "editing a memory in another project does not move it");

	// the project it is in now is "in"; naming "project" is a move
	const stay = await f.call("memory_update", { id: k.id, pinned: true, in: "atlas" });
	assert.equal(stay.details.scope, "project:atlas");
	assert.ok(!/Moved from/.test(stay.content[0].text));

	// moving a memory into the project it is about
	const mv = await f.call("memory_update", { id: h.id, project: "atlas" });
	assert.equal(mv.details.scope, "project:atlas");
	assert.match(mv.content[0].text, /Moved from project:home to project:atlas\./);

	// deleting across projects is still confirmed by the user
	const del = await f.call("memory_forget", { id: k.id, reason: "test", project: "atlas" });
	assert.equal(del.details.deleted, true);
});

test("the project argument adds little to what the tools cost", async () => {
	const f = await load();
	let total = 0;
	for (const t of f.tools.values()) {
		total += JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length;
		total += (t.promptSnippet?.length ?? 0) + (t.promptGuidelines ?? []).join("\n").length;
	}
	assert.ok(total < 3400, `${total} characters`);
});

test("/memory-tidy offers to move misfiled memories, and 'all' reaches every project", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	repoAt(join(dir, "git", "atlas"));
	process.env.PI_RETAINER_REPOS = join(dir, "git");
	try {
		const s = new MemoryStore(process.env.PI_RETAINER_DB!);
		const homeScope = `project:${home.split("/").pop()}`;
		const mis = s.write({ scope: homeScope, kind: "decision", text: "The executor contract is in ~/git/atlas/docs." }).row;
		const generic = s.write({ scope: homeScope, kind: "fact", text: "Keybindings need no Shift." }).row;
		const other = s.write({ scope: "project:elsewhere", kind: "decision", text: "Another thing about atlas here." }).row;
		s.close();
		const f = await loadIn(home);
		await f.emit("session_start", { reason: "startup" });
		const prompts: Array<{ title: string; opts: string[] }> = [];
		f.ctx.ui.select = async (title: string, opts: string[]) => (prompts.push({ title, opts }), opts[0]);

		await f.commands.get("memory-tidy").handler("", f.ctx);
		assert.equal(prompts.length, 1, "only the misfiled one, nothing else to suggest");
		assert.match(prompts[0]!.title, /\(misfiled\)/);
		assert.deepEqual(prompts[0]!.opts, ["Move to project:atlas", "Make global", "Keep here", "Stop"]);
		const after = new MemoryStore(process.env.PI_RETAINER_DB!);
		assert.equal(after.get(mis.id)!.scope, "project:atlas");
		assert.equal(after.get(generic.id)!.scope, homeScope, "a memory that names no project stays");
		assert.equal(after.get(other.id)!.scope, "project:elsewhere", "other projects are not touched without 'all'");
		assert.ok(f.notes.some((n) => /moved 1/.test(n)));

		// 'all' looks at every project
		const s2 = new MemoryStore(process.env.PI_RETAINER_DB!);
		const mis2 = s2.write({ scope: "project:elsewhere", kind: "fact", text: "Run it from ~/git/atlas first." }).row;
		s2.close();
		prompts.length = 0;
		await f.commands.get("memory-tidy").handler("all", f.ctx);
		const check = new MemoryStore(process.env.PI_RETAINER_DB!);
		assert.equal(check.get(mis2.id)!.scope, "project:atlas");
		assert.ok(f.notes.some((n) => /every project/.test(n)));
		check.close();
		after.close();
	} finally {
		delete process.env.PI_RETAINER_REPOS;
	}
});

test("/memory-tidy: a memory in a real repository's scope is never called misfiled", async () => {
	repoAt(join(dir, "git", "atlas"));
	repoAt(join(dir, "git", "tools"));
	process.env.PI_RETAINER_REPOS = join(dir, "git");
	try {
		const s = new MemoryStore(process.env.PI_RETAINER_DB!);
		s.write({ scope: "project:tools", kind: "fact", text: "Compare with ~/git/atlas when changing this." });
		s.close();
		const f = await loadIn(join(dir, "git", "tools"));
		await f.emit("session_start", { reason: "startup" });
		await f.commands.get("memory-tidy").handler("", f.ctx);
		assert.ok(f.notes.some((n) => /Nothing to tidy/.test(n)));
	} finally {
		delete process.env.PI_RETAINER_REPOS;
	}
});

test("memory_update: project and global together are refused, a text edit with only 'in' never moves, a clash is reported", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	const homeScope = `project:${home.split("/").pop()}`;
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const mine = s.write({ scope: homeScope, kind: "fact", text: "Same words in two places." }).row;
	s.write({ scope: "project:atlas", kind: "fact", text: "Same words in two places." });
	const g = s.write({ scope: "global", kind: "fact", text: "A global one." }).row;
	s.close();
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });
	await assert.rejects(() => f.call("memory_update", { id: mine.id, global: true, project: "atlas" }), /either global or project/);
	// moving into a project that already holds the same text is refused and leaves the memory where it was
	await assert.rejects(() => f.call("memory_update", { id: mine.id, project: "atlas" }), /already has that text/);
	const after = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(after.get(mine.id)!.scope, homeScope);
	after.close();
	// a global memory edited with a project named for context stays global
	const edit = await f.call("memory_update", { id: g.id, pinned: true, in: "atlas" });
	assert.equal(edit.details.scope, "global");
});

test("a project named for reading still includes the folder's own project", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	const homeScope = `project:${home.split("/").pop()}`;
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const mine = s.write({ scope: homeScope, kind: "fact", text: "A memory in the home folder." }).row;
	s.write({ scope: "project:atlas", kind: "fact", text: "A atlas memory." });
	s.close();
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });
	const got = await f.call("memory_get", { ids: [mine.id], project: "atlas" });
	assert.deepEqual(got.details.ids, [mine.id]);
	const found = await f.call("memory_search", { query: "memory", project: "atlas" });
	assert.equal(found.details.count, 2);
});

test("the long flag follows the length note only, not the words in a scope name", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: "project:characters", kind: "fact", text: "Seed." });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const w = await f.call("memory_write", { text: "Short one.", kind: "fact", project: "characters" });
	assert.equal(w.details.long, false);
	assert.match(w.content[0].text, /Filed under project:characters/);
});

test("/memory-tidy looks at every row, however many there are, and numbers only what it shows", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	repoAt(join(dir, "git", "atlas"));
	process.env.PI_RETAINER_REPOS = join(dir, "git");
	try {
		const homeScope = `project:${home.split("/").pop()}`;
		const s = new MemoryStore(process.env.PI_RETAINER_DB!);
		// 250 newer global rows would have crowded a 200-row search
		const kinds = ["fact", "decision", "gotcha", "preference"] as const;
		for (let i = 0; i < 250; i++) s.write({ scope: "global", kind: kinds[i % 4]!, text: `Unique-${i.toString(36)}-${(i * 7919).toString(36)}-${(i * 104729).toString(36)}` });
		const oldest = s.write({ scope: homeScope, kind: "fact", text: "Old note: see ~/git/atlas." }).row;
		s.close();
		const f = await loadIn(home);
		await f.emit("session_start", { reason: "startup" });
		const titles: string[] = [];
		f.ctx.ui.select = async (title: string, opts: string[]) => (titles.push(title), opts[0]);
		await f.commands.get("memory-tidy").handler("", f.ctx);
		assert.equal(titles.length, 1);
		assert.match(titles[0]!, /^Memory tidy 1\/1 \(misfiled\)/);
		const after = new MemoryStore(process.env.PI_RETAINER_DB!);
		assert.equal(after.get(oldest.id)!.scope, "project:atlas");
		after.close();
	} finally {
		delete process.env.PI_RETAINER_REPOS;
	}
});

test("/memory-tidy: Stop ends the pass; without a UI it only lists", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	repoAt(join(dir, "git", "atlas"));
	process.env.PI_RETAINER_REPOS = join(dir, "git");
	try {
		const homeScope = `project:${home.split("/").pop()}`;
		const s = new MemoryStore(process.env.PI_RETAINER_DB!);
		const a = s.write({ scope: homeScope, kind: "fact", text: "First: see ~/git/atlas." }).row;
		const b = s.write({ scope: homeScope, kind: "fact", text: "Second: see ~/git/atlas too." }).row;
		s.close();
		const f = await loadIn(home);
		await f.emit("session_start", { reason: "startup" });
		let asked = 0;
		f.ctx.ui.select = async (_t: string, opts: string[]) => (asked++, opts[opts.length - 1]); // "Stop"
		await f.commands.get("memory-tidy").handler("", f.ctx);
		assert.equal(asked, 1, "stopped after the first prompt");
		const check = new MemoryStore(process.env.PI_RETAINER_DB!);
		assert.equal(check.get(a.id)!.scope, homeScope);
		assert.equal(check.get(b.id)!.scope, homeScope);
		check.close();

		const lines: string[] = [];
		const log = console.log;
		console.log = (m: string) => lines.push(String(m));
		try {
			f.ctx.hasUI = false;
			await f.commands.get("memory-tidy").handler("", f.ctx);
		} finally {
			console.log = log;
		}
		assert.match(lines.join("\n"), /2 suggestions .*2 misfiled/);
		assert.match(lines.join("\n"), new RegExp(`misfiled #${a.id}: ${homeScope} -> project:atlas`));
		const again = new MemoryStore(process.env.PI_RETAINER_DB!);
		assert.equal(again.get(a.id)!.scope, homeScope, "nothing changed without a UI");
		again.close();
	} finally {
		delete process.env.PI_RETAINER_REPOS;
	}
});

test("a relative or symlinked project path files under the repository's own name", async () => {
	const { symlinkSync } = await import("node:fs");
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	repoAt(join(dir, "git", "atlas"));
	symlinkSync(join(dir, "git", "atlas"), join(dir, "k"));
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });
	assert.equal((await f.call("memory_write", { text: "Via a symlink.", kind: "fact", project: join(dir, "k") })).details.scope, "project:atlas");
	assert.equal((await f.call("memory_write", { text: "Via a relative path.", kind: "fact", project: "../git/atlas" })).details.scope, "project:atlas");
});

test("compaction summaries are not saved by default", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	await f.emit("session_compact", { compactionEntry: { summary: "## Goal\nA long session." }, reason: "threshold" });
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(s.search({ scopes: s.scopes(), kinds: ["summary"], limit: 10 }).length, 0);
	s.close();
});

test("with summaries.save on, a compaction summary is kept as a summary memory, cut at summaries.maxChars", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ summaries: { save: true, maxChars: 300 } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	await f.emit("session_compact", { compactionEntry: { summary: `## Goal\n${"x".repeat(1000)}` }, reason: "threshold" });
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const rows = s.search({ scopes: s.scopes(), kinds: ["summary"], limit: 10 });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]!.scope, scopeOf());
	assert.equal(rows[0]!.text.length, 301, "cut, with an ellipsis");
	assert.deepEqual(rows[0]!.tags, ["compaction", "threshold"]);
	s.close();
});

// ------------------------------------------------------------------------- write-time checks

const AWS_KEY = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

test("a secret is refused before it is saved, and the refusal does not repeat it", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	await assert.rejects(
		() => f.call("memory_write", { text: `The deploy key is ${AWS_KEY} for account 1.`, kind: "fact" }),
		(err: Error) => /^Not saved: .*an AWS access key id/.test(err.message) && !err.message.includes(AWS_KEY),
	);
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(s.inScopes(s.scopes()).length, 0, "nothing was written");
	s.close();
	const ok = await f.call("memory_write", { text: "The deploy key is in the keyring under service deploy-key.", kind: "fact" });
	assert.ok(ok.details.id);
});

test("memory_update refuses a secret in new text and leaves the memory alone", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const w = await f.call("memory_write", { text: "Where the deploy key lives: the keyring.", kind: "fact" });
	await assert.rejects(() => f.call("memory_update", { id: w.details.id, text: `Key ${AWS_KEY}` }), /Not saved/);
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(s.get(w.details.id)!.text, "Where the deploy key lives: the keyring.");
	s.close();
	// editing something other than the text is fine
	assert.ok((await f.call("memory_update", { id: w.details.id, pinned: true })).details.id);
});

test("write.checkSecrets: false turns the check off", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ write: { checkSecrets: false } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	assert.ok((await f.call("memory_write", { text: `Example id ${AWS_KEY} from the docs.`, kind: "fact" })).details.id);
});

test("saving something close to an existing memory names it, and does not for an exact repeat or an unrelated one", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const first = await f.call("memory_write", { text: "The release workflow publishes to npm with trusted publishing and provenance from the version tag.", kind: "fact" });
	const second = await f.call("memory_write", { text: "Release workflow publishes to npm through trusted publishing, with provenance, from the version tag.", kind: "gotcha" });
	assert.deepEqual(second.details.similar, [first.details.id]);
	assert.match(second.content[0].text, new RegExp(`close to #${first.details.id} \\(\\d+% the same words\\)`));
	assert.match(second.content[0].text, /memory_update/);
	assert.notEqual(second.details.id, first.details.id, "both are kept: it only warns");

	const repeat = await f.call("memory_write", { text: "The release workflow publishes to npm with trusted publishing and provenance from the version tag.", kind: "fact" });
	assert.equal(repeat.details.deduplicated, true);
	assert.deepEqual(repeat.details.similar, []);

	const unrelated = await f.call("memory_write", { text: "The database file lives in the data directory beside its backups folder.", kind: "fact" });
	assert.deepEqual(unrelated.details.similar, []);
	assert.ok(!/close to/.test(unrelated.content[0].text));
});

test("write.similarity: 0 turns the near-duplicate note off and skips the comparison", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ write: { similarity: 0 } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	await f.call("memory_write", { text: "The release workflow publishes to npm with trusted publishing and provenance from the version tag.", kind: "fact" });
	const second = await f.call("memory_write", { text: "Release workflow publishes to npm through trusted publishing, with provenance, from the version tag.", kind: "fact" });
	assert.deepEqual(second.details.similar, []);
	assert.ok(!/close to/.test(second.content[0].text));
});


test("a near-duplicate in another project is not mentioned, and a stricter write.similarity ignores a looser match", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: "project:elsewhere", kind: "fact", text: "The release workflow publishes to npm with trusted publishing and provenance from the version tag." });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const here = await f.call("memory_write", { text: "Release workflow publishes to npm through trusted publishing, with provenance, from the version tag.", kind: "fact" });
	assert.deepEqual(here.details.similar, [], "the match is in another project");

	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ write: { similarity: 0.95 } }));
	const g = await load();
	await g.emit("session_start", { reason: "startup" });
	await g.call("memory_write", { text: "The build copies the output folder into the release bundle before upload.", kind: "fact" });
	const close = await g.call("memory_write", { text: "The build copies the output folder into the release bundle before the upload step.", kind: "fact" });
	assert.deepEqual(close.details.similar, [], "about 85% the same is below 0.95");
});


// -------------------------------------------------------------------- /memory-tidy and /memory-compact

const longMemory = (head: string) => `${head}: run \`tool --flag\` in ~/git/app/${head.toLowerCase()} (ticket ABC-${head.length + 100}). ${"A detailed sentence that goes on about the topic. ".repeat(20)}`;

/** A model that gives each memory a short opening and moves the rest into separate notes, keeping every identifier. */
function fakeModel(f: Awaited<ReturnType<typeof load>>, calls: string[] = []) {
	f.ctx.modelRegistry.streamSimple = (_m: unknown, c: { messages: Array<{ content: string }> }) => ({
		result: async () => {
			const text = c.messages[0]!.content.split("\n\n").slice(1).join("\n\n");
			calls.push(text.slice(0, 20));
			const ids = [...new Set(text.match(/`[^`]+`|~\/[^\s)]+|ABC-\d+/g) ?? [])];
			const cut = Math.floor(text.length * 0.2);
			const rest = text.slice(cut).trim().match(/.{1,420}/gs) ?? [];
			return { stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ text: `${text.slice(0, cut).trim()} ${ids.join(" ")}`.slice(0, 440), splits: rest.map((t) => ({ kind: "fact", text: t })) }) }] };
		},
	});
	return calls;
}

test("/memory-tidy no longer uses the model: long memories are counted and pointed at /memory-compact", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const sent: string[] = [];
	f.pi.sendUserMessage = (m: string) => sent.push(m);
	let asked = 0;
	f.ctx.ui.select = async () => (asked++, "Stop");
	await f.commands.get("memory-tidy").handler("", f.ctx);
	assert.equal(asked, 0, "a long memory is not a tidy suggestion any more");
	assert.deepEqual(sent, [], "tidy never sends a message to the model");
	assert.ok(f.notes.some((n) => /1 memory is over 600 characters: \/memory-compact shortens them with the model/.test(n)), f.notes.join(" | "));
});

test("/memory-tidy never offers to merge with the model; it deletes or keeps, and points at /memory-compact", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: scopeOf(), kind: "fact", text: "The release workflow publishes to npm with trusted publishing and provenance from the version tag in CI." });
	s.write({ scope: scopeOf(), kind: "fact", text: "The release workflow publishes to npm with trusted publishing and provenance from the version tag in CI today." });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const prompts: Array<{ title: string; opts: string[] }> = [];
	f.ctx.ui.select = async (title: string, opts: string[]) => (prompts.push({ title, opts }), "Keep both");
	f.pi.sendUserMessage = () => assert.fail("tidy must not message the model");
	await f.commands.get("memory-tidy").handler("", f.ctx);
	assert.equal(prompts.length, 1);
	assert.deepEqual(prompts[0]!.opts, ["Delete", "Keep both", "Stop"]);
	assert.match(prompts[0]!.title, /\/memory-compact can merge these/);
});

test("/memory-compact: asks once, shows the results, applies the ready ones, and leaves the conversation alone", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const a = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") }).row;
	const b = s.write({ scope: scopeOf(), kind: "decision", text: longMemory("Beta") }).row;
	s.write({ scope: scopeOf(), kind: "fact", text: "A short memory that is not touched." });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const calls = fakeModel(f);
	const asked: Array<{ title: string; message: string }> = [];
	f.ctx.ui.confirm = async (title: string, message: string) => (asked.push({ title, message }), true);
	let summary = "";
	f.ctx.ui.select = async (title: string, opts: string[]) => ((summary = title), opts[0]);
	f.pi.sendUserMessage = () => assert.fail("compact must not message the model");
	const sentCustom: unknown[] = [];
	f.pi.sendMessage = (m: unknown) => sentCustom.push(m);
	const entriesBefore = f.sm.getEntries().length;

	await f.commands.get("memory-compact").handler("", f.ctx);

	assert.equal(calls.length, 2, "one request per long memory");
	assert.match(asked[0]!.title, /Shorten 2 memories/);
	assert.match(asked[0]!.message, /sends the text of these 2 memories to test\/fake-model, in 2 separate requests/);
	assert.match(asked[0]!.message, /not part of your conversation/);
	assert.match(asked[0]!.message, /snapshot of the database is taken before anything is written/);
	assert.match(summary, /2 ready, 0 refused or failed/);
	assert.match(summary, new RegExp(`#${a.id} \\d+c -> \\d+c \\+ \\d+ new`));
	const after = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.ok(after.get(a.id)!.text.length < 450 && after.get(b.id)!.text.length < 450);
	assert.ok(after.get(a.id)!.text.includes("~/git/app/alpha"), "the identifier survives");
	assert.equal(after.get(b.id)!.kind, "decision");
	const splitKinds = after.inScopes([scopeOf()]).filter((r) => r.sessionId === f.sm.getSessionId() && r.id > b.id + 1);
	assert.ok(splitKinds.length >= 2 && splitKinds.every((r) => r.kind === "fact"));
	assert.ok(f.notes.some((n) => /Memory compact: shortened 2, added \d+/.test(n)), f.notes.join(" | "));
	assert.equal(sentCustom.length, 0);
	assert.equal(f.sm.getEntries().length, entriesBefore, "nothing was added to the session");
	after.close();
});

test("/memory-compact: cancelling at either question writes nothing", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const a = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const calls = fakeModel(f);
	f.ctx.ui.confirm = async () => false;
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.equal(calls.length, 0, "no request is made before the first confirmation");

	f.ctx.ui.confirm = async () => true;
	f.ctx.ui.select = async (_t: string, opts: string[]) => opts[opts.length - 1]; // Cancel
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.equal(calls.length, 1, "asked once, then the person cancelled");
	const check = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(check.get(a.id)!.text, longMemory("Alpha"));
	assert.equal(check.stats().reduce((n, x) => n + x.count, 0), 1);
	check.close();
});

test("/memory-compact: a rewrite that drops something is shown as refused and never applied", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const a = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") }).row;
	const b = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Beta") }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const good = fakeModel(f);
	const goodStream = f.ctx.modelRegistry.streamSimple;
	let n = 0;
	f.ctx.modelRegistry.streamSimple = (m: unknown, c: { messages: Array<{ content: string }> }) => (n++ === 0
		? { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: JSON.stringify({ text: "Alpha: a thing about the app.", splits: [] }) }] }) }
		: goodStream(m, c));
	let summary = "";
	f.ctx.ui.select = async (title: string, opts: string[]) => ((summary = title), opts[0]);
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.match(summary, /1 ready, 1 refused or failed/);
	assert.match(summary, /REFUSED, drops/);
	const after = new MemoryStore(process.env.PI_RETAINER_DB!);
	const texts = [a, b].map((r) => after.get(r.id)!.text);
	assert.equal(texts.filter((t) => t === longMemory("Alpha") || t === longMemory("Beta")).length, 1, "exactly one was left unchanged");
	after.close();
	void good;
});

test("/memory-compact takes ids, a project name or 'all'; unknown ones are reported", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const mine = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Mine") }).row;
	const other = s.write({ scope: "project:elsewhere", kind: "fact", text: longMemory("Other") }).row;
	const short = s.write({ scope: scopeOf(), kind: "fact", text: "Short but named by id, so it is still shortened." }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const titles: string[] = [];
	f.ctx.ui.confirm = async (title: string) => (titles.push(title), false);
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.match(titles.at(-1)!, /Shorten 1 memory in /);
	await f.commands.get("memory-compact").handler("elsewhere", f.ctx);
	assert.match(titles.at(-1)!, /Shorten 1 memory in project:elsewhere and global/);
	await f.commands.get("memory-compact").handler("all", f.ctx);
	assert.match(titles.at(-1)!, /Shorten 2 memories in every project/);
	await f.commands.get("memory-compact").handler(`${other.id} ${short.id} 9999`, f.ctx);
	assert.match(titles.at(-1)!, /Shorten 2 memories in #/);
	assert.ok(f.notes.some((n) => /No memory #9999/.test(n)));
	await f.commands.get("memory-compact").handler("nosuchproject", f.ctx);
	assert.ok(f.notes.some((n) => /no project named nosuchproject/.test(n)));
	void mine;
});

test("/memory-compact: nothing long, no UI and no model are each said plainly", async () => {
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.ok(f.notes.some((n) => /Nothing to shorten in .*no memory is over 600 characters/.test(n)));

	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") });
	s.close();
	f.ctx.model = undefined;
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.ok(f.notes.some((n) => /needs a model/.test(n)));
	f.ctx.model = { provider: "test", id: "fake-model" };
	f.ctx.hasUI = false;
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.ok(f.notes.some((n) => /only runs in the interactive UI/.test(n)));
});

test("/memory-compact caps a run at compact.maxPerRun and says how many are left", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ compact: { maxPerRun: 2 } }));
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	for (const h of ["Alpha", "Beta", "Gamma", "Delta"]) s.write({ scope: scopeOf(), kind: "fact", text: longMemory(h) });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	let message = "";
	f.ctx.ui.confirm = async (_t: string, m: string) => ((message = m), false);
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.match(message, /in 2 separate requests/);
	assert.match(message, /2 more are over the limit; run it again for them/);
});

test("/memory-compact reaches memories in another project from any folder, by id, with no project argument", async () => {
	const home = join(dir, "home");
	mkdirSync(home, { recursive: true });
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const other = s.write({ scope: "project:elsewhere", kind: "fact", text: longMemory("Other") }).row;
	s.close();
	const f = await loadIn(home);
	await f.emit("session_start", { reason: "startup" });
	fakeModel(f);
	f.ctx.ui.select = async (_t: string, opts: string[]) => opts[0];
	await f.commands.get("memory-compact").handler(String(other.id), f.ctx);
	const after = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.ok(after.get(other.id)!.text.length < 450, "shortened in place");
	assert.equal(after.get(other.id)!.scope, "project:elsewhere", "and still in its project");
	assert.ok(after.inScopes(["project:elsewhere"]).length > 1, "the split-off notes are in the same project");
	after.close();
});

test("with write.warnChars at 0, /memory-compact without ids does nothing; with ids it still works", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ write: { warnChars: 0 } }));
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const a = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") }).row;
	s.write({ scope: scopeOf(), kind: "fact", text: "A short memory that must not be sent to the model." });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const calls = fakeModel(f);
	const titles: string[] = [];
	f.ctx.ui.confirm = async (t: string) => (titles.push(t), false);
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.equal(titles.length, 0);
	assert.ok(f.notes.some((n) => /write\.warnChars is 0/.test(n)));
	await f.commands.get("memory-compact").handler(String(a.id), f.ctx);
	assert.match(titles[0]!, /Shorten 1 memory in #/);
	assert.equal(calls.length, 0, "declined at the question: no request was made");
});

// ------------------------------------------------------------ /memory-compact: review fixes

test("a snapshot is taken before anything is written, and the notice says how to undo", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const a = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	fakeModel(f);
	f.ctx.ui.select = async (_t: string, opts: string[]) => opts[0];
	const { readdirSync } = await import("node:fs");
	const before = readdirSync(join(dir, "backups")).filter((n) => n.startsWith("retainer-")).length;
	await f.commands.get("memory-compact").handler("", f.ctx);
	const names = readdirSync(join(dir, "backups")).filter((n) => n.startsWith("retainer-"));
	assert.equal(names.length, before + 1);
	const snap = new MemoryStore(join(dir, "backups", names.sort().at(-1)!));
	assert.equal(snap.get(a.id)!.text, longMemory("Alpha"), "the snapshot holds the text from before the change");
	snap.close();
	assert.ok(f.notes.some((n) => /Undo with \/memory-restore retainer-\d{8}-\d{6}(?:-\d+)?\.db/.test(n)), f.notes.join(" | "));
});

test("a failed request says why, instead of 'no answer'", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	f.ctx.modelRegistry.streamSimple = () => ({ result: async () => ({ stopReason: "error", errorMessage: "429 rate limit exceeded", content: [] }) });
	let shown = "";
	f.ctx.ui.select = async (t: string, opts: string[]) => ((shown = t), opts[0]);
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.match(shown, /nothing can be applied/);
	assert.match(shown, /429 rate limit exceeded/);
});

test("Esc during a run cancels it; what finished is still shown and nothing is written without a confirmation", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	for (const h of ["Alpha", "Beta", "Gamma", "Delta"]) s.write({ scope: scopeOf(), kind: "fact", text: longMemory(h) });
	s.close();
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ compact: { concurrency: 1 } }));
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	let listener: ((d: string) => unknown) | undefined;
	f.ctx.ui.onTerminalInput = (fn: (d: string) => unknown) => ((listener = fn), () => (listener = undefined));
	const good = fakeModel(f);
	const stream = f.ctx.modelRegistry.streamSimple;
	let n = 0;
	f.ctx.modelRegistry.streamSimple = (m: unknown, c: any) => (++n === 2 ? (listener?.("\u001b"), stream(m, c)) : stream(m, c));
	let shown = "";
	f.ctx.ui.select = async (t: string, opts: string[]) => ((shown = t), opts[opts.length - 1]); // Cancel
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.ok(good.length < 4, `${good.length} requests: it stopped early`);
	assert.ok(f.notes.some((n) => /cancelled after \d of 4/.test(n)), f.notes.join(" | "));
	assert.equal(listener, undefined, "the key listener is removed");
	const check = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(check.inScopes([scopeOf()]).filter((r) => r.text.length > 800).length, 4, "nothing was changed");
	check.close();
});

test("every ready proposal can be read before applying, one by one", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	for (const h of ["Alpha", "Beta", "Gamma"]) s.write({ scope: scopeOf(), kind: "fact", text: longMemory(h) });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	fakeModel(f);
	const seen: string[] = [];
	f.ctx.ui.select = async (t: string, opts: string[]) => {
		seen.push(t);
		if (opts.includes("Read each one first")) return "Read each one first";
		if (opts[0]?.startsWith("Next")) return opts[0];
		return "Cancel"; // after reading the last one
	};
	await f.commands.get("memory-compact").handler("", f.ctx);
	const details = seen.filter((t) => /BEFORE \(/.test(t));
	assert.equal(details.length, 3, "all three proposals were shown, not just the first");
	assert.ok(details.every((t, i) => t.includes(`(${i + 1}/3)`) && /AFTER \(/.test(t) && /NEW \(/.test(t)));
	const check = new MemoryStore(process.env.PI_RETAINER_DB!);
	assert.equal(check.inScopes([scopeOf()]).filter((r) => r.text.length > 800).length, 3, "cancelling after reading writes nothing");
	check.close();
});

test("memories that hold a secret are never sent to the model, and summaries are not shortened", async () => {
	const key = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const clean = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Clean") }).row;
	const leaky = s.write({ scope: scopeOf(), kind: "fact", text: `${longMemory("Leaky")} The key is ${key}.` }).row;
	const summary = s.write({ scope: scopeOf(), kind: "summary", text: longMemory("Summary") }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const sent: string[] = [];
	f.ctx.modelRegistry.streamSimple = (_m: unknown, c: any) => ({ result: async () => (sent.push(c.messages[0].content), { stopReason: "stop", content: [{ type: "text", text: "{}" }] }) });
	f.ctx.ui.confirm = async () => true;
	f.ctx.ui.select = async (_t: string, opts: string[]) => opts[opts.length - 1];
	await f.commands.get("memory-compact").handler(`${clean.id} ${leaky.id} ${summary.id}`, f.ctx);
	assert.equal(sent.length, 1, "only the clean memory was sent");
	assert.ok(!sent.some((m) => m.includes(key)), "the secret never reached the model");
	assert.ok(f.notes.some((n) => new RegExp(`Not sent to the model.*#${leaky.id}`).test(n)));
	assert.ok(f.notes.some((n) => new RegExp(`Summaries are not shortened: #${summary.id}`).test(n)));
});

test("running it again reaches the memories it has not tried, not the same refused ones", async () => {
	writeFileSync(join(dir, "pi-retainer.json"), JSON.stringify({ compact: { maxPerRun: 2 } }));
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const rows = ["Alpha", "Beta", "Gamma", "Delta"].map((h, i) => s.write({ scope: scopeOf(), kind: "fact", text: longMemory(h).padEnd(1200 + i * 100, "x") }).row);
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const asked: string[][] = [];
	f.ctx.modelRegistry.streamSimple = (_m: unknown, c: any) => ({ result: async () => (asked.at(-1)!.push(c.messages[0].content.split("\n\n")[1].slice(0, 6)), { stopReason: "stop", content: [{ type: "text", text: '{"text":"Nope.","splits":[]}' }] }) });
	f.ctx.ui.confirm = async () => (asked.push([]), true);
	f.ctx.ui.select = async (_t: string, opts: string[]) => opts[opts.length - 1];
	await f.commands.get("memory-compact").handler("", f.ctx);
	await f.commands.get("memory-compact").handler("", f.ctx);
	const first = new Set(asked[0]);
	const second = new Set(asked[1]);
	assert.equal(first.size + second.size, 4, "the second run took the other two");
	for (const x of second) assert.ok(!first.has(x));
	void rows;
});

test("the request goes to the model the person agreed to, even if another is selected meanwhile", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") });
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	const used: string[] = [];
	f.ctx.modelRegistry.streamSimple = (m: any) => ({ result: async () => (used.push(m.id), { stopReason: "stop", content: [{ type: "text", text: "{}" }] }) });
	f.ctx.ui.confirm = async () => ((f.ctx.model = { provider: "other", id: "different-model" }), true);
	f.ctx.ui.select = async (_t: string, opts: string[]) => opts[opts.length - 1];
	await f.commands.get("memory-compact").handler("", f.ctx);
	assert.deepEqual(used, ["fake-model"]);
});

test("ids given with other words: the words are ignored and the person is told", async () => {
	const s = new MemoryStore(process.env.PI_RETAINER_DB!);
	const a = s.write({ scope: scopeOf(), kind: "fact", text: longMemory("Alpha") }).row;
	s.close();
	const f = await load();
	await f.emit("session_start", { reason: "startup" });
	f.ctx.ui.confirm = async () => false;
	await f.commands.get("memory-compact").handler(`all ${a.id} extra`, f.ctx);
	assert.ok(f.notes.some((n) => /ignoring "all extra" because ids were given/.test(n)), f.notes.join(" | "));
});
