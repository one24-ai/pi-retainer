import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, estimate, line, pickLong, proposeAll } from "../extensions/retainer/compactor.ts";
import { MemoryStore, type MemoryRow } from "../extensions/retainer/store.ts";

const long = (head: string, n = 900) => `${head} Run \`tool --flag\` in ~/git/app/${head.toLowerCase()} (ticket ABC-${head.length}). ${"Filler detail about the thing. ".repeat(Math.ceil(n / 31))}`.slice(0, n);

function seed() {
	const s = new MemoryStore(":memory:");
	const rows: MemoryRow[] = [];
	for (const [h, n] of [["Alpha", 1500], ["Beta", 900], ["Gamma", 700], ["Delta", 300]] as const) rows.push(s.write({ scope: "project:p", kind: "fact", text: long(h, n) }).row);
	s.write({ scope: "project:p", kind: "summary", text: "S".repeat(3000) });
	return { s, rows };
}

test("pickLong chooses the longest non-summary memories over the limit, up to the cap", () => {
	const { s, rows } = seed();
	const all = s.inScopes(["project:p"]);
	assert.deepEqual(pickLong(all, 600, 10).map((c) => c.row.id), [rows[0]!.id, rows[1]!.id, rows[2]!.id]);
	assert.deepEqual(pickLong(all, 600, 2).map((c) => c.row.id), [rows[0]!.id, rows[1]!.id]);
	assert.deepEqual(pickLong(all, 0, 10).length, 4, "summaries are never picked, even when named");
	s.close();
});

test("estimate counts requests and grows with the text", () => {
	const { s } = seed();
	const c = pickLong(s.inScopes(["project:p"]), 600, 10);
	const e = estimate(c);
	assert.equal(e.requests, 3);
	assert.ok(e.inputTokens > e.outputTokens && e.outputTokens > 0);
	s.close();
});

/**
 * A model that shortens the way a good one does: the opening kept short, the rest moved into
 * separate notes of their own so that nothing is dropped.
 */
const goodModel = async (_sys: string, user: string) => {
	const text = user.split("\n\n").slice(1).join("\n\n");
	const cut = Math.floor(text.length * 0.25);
	const ids = [...new Set(text.match(/`[^`]+`|~\/[^\s)]+|ABC-\d+/g) ?? [])];
	const rest = text.slice(cut).trim().match(/.{1,420}/gs) ?? [];
	return JSON.stringify({ text: `${text.slice(0, cut).trim()} ${ids.join(" ")}`.slice(0, 440), splits: rest.map((t) => ({ kind: "fact", text: t })) });
};

test("proposeAll asks once per memory, checks every answer, and writes nothing", async () => {
	const { s, rows } = seed();
	const progress: number[] = [];
	const out = await proposeAll(goodModel, pickLong(s.inScopes(["project:p"]), 600, 10), { target: 300, hardCap: 450, concurrency: 2, onProgress: (d) => progress.push(d) });
	assert.equal(out.length, 3);
	assert.ok(out.every((o) => o.problems.length === 0 && o.proposal), JSON.stringify(out.map((o) => o.problems)));
	assert.deepEqual(progress.sort(), [1, 2, 3]);
	assert.equal(s.get(rows[0]!.id)!.text.length, 1500, "nothing was written");
	assert.equal(s.stats().reduce((n, x) => n + x.count, 0), 5);
	s.close();
});

test("a model that drops an identifier, answers badly or throws leaves that memory unchanged and the rest going", async () => {
	const { s, rows } = seed();
	let call = 0;
	const flaky = async (sys: string, user: string) => {
		call++;
		if (call === 1) return JSON.stringify({ text: "Alpha is a thing.", splits: [] }); // drops the identifiers
		if (call === 2) return "I cannot help with that.";
		return goodModel(sys, user);
	};
	const out = await proposeAll(flaky, pickLong(s.inScopes(["project:p"]), 600, 10), { target: 300, hardCap: 450, concurrency: 1 });
	assert.equal(out.length, 3);
	assert.match(out[0]!.problems.join(), /drops/);
	assert.deepEqual(out[1]!.problems, ["the answer was not the expected JSON"]);
	assert.deepEqual(out[2]!.problems, []);
	const r = apply(s, out, "sess");
	assert.equal(r.updated, 1);
	assert.equal(s.get(rows[0]!.id)!.text.length, 1500, "the refused one is untouched");
	assert.equal(s.get(rows[1]!.id)!.text.length, 900, "the unparsed one is untouched");
	assert.ok(s.get(rows[2]!.id)!.text.length < 700);
	s.close();
});

test("apply rewrites, adds the splits in the same project with the same tags, and skips what changed or vanished", async () => {
	const { s, rows } = seed();
	const out = await proposeAll(goodModel, pickLong(s.inScopes(["project:p"]), 600, 10), { target: 300, hardCap: 450, concurrency: 3 });
	s.update(rows[1]!.id, { text: "Edited by someone while the model was working." });
	s.forget(rows[2]!.id);
	const before = s.stats().reduce((n, x) => n + x.count, 0);
	const r = apply(s, out, "sess");
	assert.equal(r.updated, 1);
	assert.ok(r.added >= 1);
	assert.deepEqual(r.skipped.map((k) => k.id).sort(), [rows[1]!.id, rows[2]!.id].sort());
	assert.deepEqual(r.skipped.map((k) => k.why).sort(), ["it changed meanwhile", "it was deleted meanwhile"].sort());
	assert.equal(s.get(rows[1]!.id)!.text, "Edited by someone while the model was working.", "an edit made meanwhile is not overwritten");
	assert.equal(s.stats().reduce((n, x) => n + x.count, 0), before + r.added);
	const newest = s.inScopes(["project:p"]).filter((x) => x.sessionId === "sess");
	assert.equal(newest.length, r.added);
	assert.ok(newest.every((x) => x.scope === "project:p" && x.kind === "fact"));
	s.close();
});

test("a split of an unknown or summary kind becomes a fact, and an identical split is not added twice", () => {
	const s = new MemoryStore(":memory:");
	const row = s.write({ scope: "project:p", kind: "gotcha", text: "Original text of the memory." }).row;
	const proposal = { text: "Short.", splits: [{ kind: "summary", text: "Split one." }, { kind: "fact", text: "Split one." }] };
	const r = apply(s, [{ row, proposal, problems: [] }], null);
	assert.equal(r.added, 1, "the same text twice is one new memory");
	const split = s.inScopes(["project:p"]).find((x) => x.text === "Split one.")!;
	assert.equal(split.kind, "fact", "a summary kind from the model becomes a fact");
	const row2 = s.write({ scope: "project:p", kind: "gotcha", text: "Another original text of a memory." }).row;
	apply(s, [{ row: row2, proposal: { text: "Short2.", splits: [{ text: "Split two." }] }, problems: [] }], null);
	assert.equal(s.inScopes(["project:p"]).find((x) => x.text === "Split two.")!.kind, "gotcha", "no kind: the source memory's kind");
	s.close();
});

test("the one-line summary shows sizes, new notes, and why a refusal was refused", () => {
	const row = { id: 7, text: "x".repeat(900) } as MemoryRow;
	assert.equal(line({ row, proposal: { text: "y".repeat(280), splits: [{ text: "a" }, { text: "b" }] }, problems: [] }), "#7 900c -> 280c + 2 new");
	assert.match(line({ row, proposal: { text: "y", splits: [] }, problems: ["drops \"X\""] }), /^#7 900c -> 1c: REFUSED, drops "X"$/);
	assert.equal(line({ row, problems: ["the model gave no answer"] }), "#7 900c: no result (the model gave no answer)");
});

test("an aborted run stops asking", async () => {
	const { s } = seed();
	const c = new AbortController();
	let asked = 0;
	const out = await proposeAll(async (sys, user) => { asked++; c.abort(); return goodModel(sys, user); }, pickLong(s.inScopes(["project:p"]), 600, 10), { target: 300, hardCap: 450, concurrency: 1, signal: c.signal });
	assert.equal(asked, 1);
	assert.equal(out.length, 1);
	s.close();
});

// ---------------------------------------------------------------- data safety (review of /memory-compact)

import { maxSplits, judge } from "../extensions/retainer/compact.ts";

const fail = (s: MemoryStore, what: "write" | "update", nth = 1) => {
	const real = s[what].bind(s);
	let n = 0;
	(s as any)[what] = (...a: any[]) => { if (++n === nth) throw new Error(`simulated ${what} failure`); return (real as any)(...a); };
};

test("a failure while writing a split leaves the memory exactly as it was: the update and its notes go together or not at all", () => {
	const s = new MemoryStore(":memory:");
	const row = s.write({ scope: "project:p", kind: "fact", text: "Original text with ~/git/app and `tool --flag` kept in full." }).row;
	fail(s, "write");
	const r = apply(s, [{ row, proposal: { text: "Short.", splits: [{ text: "Note one." }, { text: "Note two." }] }, problems: [] }], null);
	assert.equal(r.updated, 0);
	assert.equal(r.skipped.length, 1);
	assert.match(r.skipped[0]!.why, /simulated write failure/);
	assert.equal(s.get(row.id)!.text, "Original text with ~/git/app and `tool --flag` kept in full.", "rolled back");
	assert.equal(s.stats().reduce((n, x) => n + x.count, 0), 1, "no half-written notes");
	s.close();
});

test("one memory failing does not stop the others", () => {
	const s = new MemoryStore(":memory:");
	const a = s.write({ scope: "project:p", kind: "fact", text: "First original memory text." }).row;
	const b = s.write({ scope: "project:p", kind: "fact", text: "Second original memory text." }).row;
	fail(s, "update", 1);
	const r = apply(s, [a, b].map((row, i) => ({ row, proposal: { text: `Short ${i}.`, splits: [] }, problems: [] })), null);
	assert.equal(r.updated, 1);
	assert.equal(s.get(a.id)!.text, "First original memory text.");
	assert.equal(s.get(b.id)!.text, "Short 1.");
	s.close();
});

test("a split that repeats an existing memory is not written, and that memory is left exactly as it is", () => {
	const s = new MemoryStore(":memory:");
	const other = s.write({ scope: "project:p", kind: "gotcha", text: "Already said elsewhere.", tags: ["keep-me"], pinned: true }).row;
	const row = s.write({ scope: "project:p", kind: "fact", text: "Original with a note that repeats another memory." }).row;
	const before = JSON.stringify(s.get(other.id));
	const r = apply(s, [{ row, proposal: { text: "Short.", splits: [{ kind: "fact", text: "already said ELSEWHERE." }] }, problems: [] }], "sess");
	assert.equal(r.added, 0);
	assert.equal(JSON.stringify(s.get(other.id)), before, "kind, tags, pin, time and session of the other memory are untouched");
	// a split equal to the rewritten text of the source itself
	const row2 = s.write({ scope: "project:p", kind: "decision", text: "Second original memory, long enough to be shortened." }).row;
	apply(s, [{ row: row2, proposal: { text: "Same words.", splits: [{ text: "same words." }] }, problems: [] }], null);
	assert.equal(s.get(row2.id)!.kind, "decision", "the source keeps its kind");
	s.close();
});

test("splits take the scope and tags the memory has when applied, and a move, kind, pin or tag change in between skips it", () => {
	const s = new MemoryStore(":memory:");
	const row = s.write({ scope: "project:p", kind: "fact", text: "Original text that will be shortened soon.", tags: ["a"] }).row;
	const outcome = { row, proposal: { text: "Short.", splits: [{ text: "Detail." }] }, problems: [] };
	s.update(row.id, { scope: "project:q" });
	assert.deepEqual(apply(s, [outcome], null).skipped.map((k) => k.why), ["it changed meanwhile"], "moved to another project");
	s.update(row.id, { scope: "project:p" });
	s.update(row.id, { tags: ["a", "b"] });
	assert.equal(apply(s, [outcome], null).skipped.length, 1, "tags changed");
	s.update(row.id, { tags: ["a"], pinned: true });
	assert.equal(apply(s, [outcome], null).skipped.length, 1, "pinned");
	s.update(row.id, { pinned: false, kind: "gotcha" });
	assert.equal(apply(s, [outcome], null).skipped.length, 1, "kind");
	s.close();
});

test("a pinned memory's notes are pinned too, so shortening does not push its detail out of recall", () => {
	const s = new MemoryStore(":memory:");
	const row = s.write({ scope: "project:p", kind: "fact", text: "A pinned original memory with plenty of detail in it.", pinned: true, tags: ["t"] }).row;
	apply(s, [{ row, proposal: { text: "Short.", splits: [{ text: "Detail one." }] }, problems: [] }], null);
	const note = s.inScopes(["project:p"]).find((x) => x.text === "Detail one.")!;
	assert.equal(note.pinned, true);
	assert.deepEqual(note.tags, ["t"]);
	s.close();
});

test("too many notes are refused by the check and, if one still reaches apply, skipped whole", () => {
	assert.equal(maxSplits(500), 6);
	assert.equal(maxSplits(3900), 13);
	const original = "Original text. ".repeat(60);
	const many = { text: "Short.", splits: Array.from({ length: 8 }, (_, i) => ({ text: `Note number ${i}.` })) };
	const v = judge(original, many, 450);
	assert.equal(v.ok, false);
	if (!v.ok) assert.match(v.reasons.join(), /splits into 8 notes \(at most 6\)/);
	const s = new MemoryStore(":memory:");
	const row = s.write({ scope: "project:p", kind: "fact", text: "Short original, so the cap is six notes." }).row;
	const r = apply(s, [{ row, proposal: many, problems: [] }], null);
	assert.match(r.skipped[0]!.why, /too many/);
	assert.equal(s.get(row.id)!.text, "Short original, so the cap is six notes.");
	s.close();
});

test("the check refuses an output that contains a secret, is not shorter, or is much longer in total", () => {
	const original = "Where the deploy key lives: the keyring under service deploy-key, set up on 2026-10-02. ".repeat(4);
	const withSecret = judge(original, { text: "Key is in the keyring (2026-10-02); " + ["AKIA", "IOSFODNN7EXAMPLE"].join(""), splits: [] }, 450);
	assert.equal(withSecret.ok, false);
	if (!withSecret.ok) assert.match(withSecret.reasons.join(), /an AWS access key id/);
	const notShorter = judge("Tiny original, 2026-10-02.", { text: "A rewrite that is longer than the original, 2026-10-02.", splits: [{ text: "Extra." }] }, 450);
	assert.equal(notShorter.ok, false);
	if (!notShorter.ok) assert.match(notShorter.reasons.join(), /not shorter/);
	const bloated = judge("Original, 2026-10-02.", { text: "Short 2026-10-02.", splits: Array.from({ length: 4 }, () => ({ text: "Invented padding text that was not in the original at all. ".repeat(3) })) }, 450);
	assert.equal(bloated.ok, false);
	if (!bloated.ok) assert.match(bloated.reasons.join(), /much longer/);
});
