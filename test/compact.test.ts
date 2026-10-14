import assert from "node:assert/strict";
import { test } from "node:test";
import { identifiers, judge, keptEnough, lost } from "../extensions/retainer/compact.ts";
import { parseProposal, propose, SYSTEM_PROMPT } from "../extensions/retainer/shorten.ts";

const orig = [
	"Deploys run from ~/git/riot/starforger on branch feat/poc-scaffold (commit e5386aa, 2026-10-02) with `uv run starforger migrate`,",
	"pinned psycopg 3.3.6 and ruff 0.16.10, the ticket is LOITIL-90650, --no-lockfile is required, KC_TTL is 1 hour,",
	'tokens last 4 hours, see https://example.com/docs/design-v2.md, and Zach said "without a status from keyconjurer, this seems complicated".',
].join(" ");

test("the identifiers that must survive are found: paths, commands, versions, keys, dates, hashes, flags, names, quotes", () => {
	const ids = identifiers(orig);
	for (const want of ["~/git/riot/starforger", "feat/poc-scaffold", "e5386aa", "2026-10-02", "uv run starforger migrate", "3.3.6", "0.16.10", "LOITIL-90650", "--no-lockfile", "KC_TTL", "4 hours", "https://example.com/docs/design-v2.md", "without a status from keyconjurer, this seems complicated"]) {
		assert.ok(ids.includes(want), `missing from the list: ${want}\n${ids.join(" | ")}`);
	}
});

test("ordinary words with a slash or a capital are not identifiers", () => {
	const ids = identifiers("Use and/or TCP/IP, the Client and Server. Version 2. It took a while. OK.");
	assert.deepEqual(ids, []);
});

test("a rewrite that keeps every identifier passes, split notes count", () => {
	const short = "Deploys run from ~/git/riot/starforger on branch feat/poc-scaffold (commit e5386aa, 2026-10-02) with `uv run starforger migrate`; ticket LOITIL-90650.";
	const splits = ["Pinned: psycopg 3.3.6 and ruff 0.16.10; --no-lockfile is required; KC_TTL is 1 hour; tokens last 4 hours.", 'Design: https://example.com/docs/design-v2.md. Zach said "without a status from keyconjurer, this seems complicated".'];
	assert.deepEqual(lost(orig, short, splits).missing, []);
	assert.deepEqual(judge(orig, { text: short, splits: splits.map((text) => ({ text })) }, 450), { ok: true });
});

test("dropping any identifier is refused, and the reason names it", () => {
	const v = judge(orig, { text: "Deploys run from the starforger repo; ticket LOITIL-90650.", splits: [] }, 450);
	assert.equal(v.ok, false);
	if (!v.ok) assert.match(v.reasons.join(" "), /drops .*~\/git\/riot\/starforger/);
	const noQuote = judge(orig, { text: orig.replace(/, and Zach said.*$/, "."), splits: [{ text: "x".repeat(40) }] }, 450);
	assert.equal(noQuote.ok, false);
});

test("matching ignores case and spacing, so reflowing a memory is not a loss", () => {
	assert.deepEqual(lost("Run `uv  run   x` in ~/GIT/App", "run `uv run x` in ~/git/app").missing, []);
});

test("the other rules: not shorter, too long, empty, long dashes, and deletion disguised as shortening", () => {
	const reasons = (text: string, splits: string[] = [], original = orig) => {
		const v = judge(original, { text, splits: splits.map((t) => ({ text: t })) }, 450);
		return v.ok ? [] : v.reasons;
	};
	assert.match(reasons(orig).join(), /not shorter/);
	assert.match(reasons("").join(), /empty/);
	assert.match(reasons("x ".repeat(300), [], "y".repeat(2000)).join(), /over 450/);
	assert.match(reasons(`${orig.slice(0, 50)} \u2014 more`.padEnd(30)).join(), /long dash/);
	const big = `${"Detail sentence number one is here. ".repeat(40)}`;
	assert.equal(keptEnough(big, "Short.", []), false);
	assert.equal(keptEnough("short original", "s", []), true, "short originals are not held to it");
	assert.match(reasons("Short.", [], big).join(), /less than 45%/);
});

test("parsing the model's answer: plain JSON, fenced, inside a sentence; and what it rejects", () => {
	const ok = { text: "Short.", splits: [{ kind: "gotcha", text: "Other." }] };
	assert.deepEqual(parseProposal(JSON.stringify(ok)), { text: "Short.", splits: [{ kind: "gotcha", text: "Other." }] });
	assert.deepEqual(parseProposal("```json\n" + JSON.stringify(ok) + "\n```"), parseProposal(JSON.stringify(ok)));
	assert.deepEqual(parseProposal("Here you go: " + JSON.stringify(ok) + " Hope it helps."), parseProposal(JSON.stringify(ok)));
	assert.deepEqual(parseProposal('{"text":"A"}'), { text: "A", splits: [] });
	assert.equal(parseProposal('{"text":"A","splits":[{"kind":"weird","text":"B"}]}')?.splits[0]?.kind, undefined, "an unknown kind is dropped, not trusted");
	for (const bad of ["", "no json", "{", '{"text":""}', '{"text":3}', '{"text":"A","splits":[{"kind":"fact"}]}', "[1,2]"]) assert.equal(parseProposal(bad), undefined, bad);
});

test("propose: asks with the rules, reports a failed or malformed answer instead of throwing", async () => {
	let seen: { system: string; user: string } | undefined;
	const good = await propose(async (system, user) => ((seen = { system, user }), '{"text":"Short.","splits":[]}'), "A long original.", 300, 450);
	assert.deepEqual(good, { proposal: { text: "Short.", splits: [] } });
	assert.equal(seen!.system, SYSTEM_PROMPT);
	assert.match(seen!.user, /about 300 characters \(never more than 450\)/);
	assert.match(seen!.user, /A long original\./);
	assert.deepEqual(await propose(async () => undefined, "x", 300, 450), { error: "the model gave no answer" });
	assert.deepEqual(await propose(async () => "nonsense", "x", 300, 450), { error: "the answer was not the expected JSON" });
	const thrown = await propose(async () => { throw new Error("boom"); }, "x", 300, 450);
	assert.deepEqual(thrown, { error: "the request failed: boom" });
});

test("the prompt tells the model the rules that the check enforces", () => {
	for (const word of ["Never drop a fact", "identifier", "quotation marks", "JSON", "long dashes"]) assert.ok(SYSTEM_PROMPT.includes(word), word);
});
