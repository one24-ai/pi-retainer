import assert from "node:assert/strict";
import { test } from "node:test";
import { identifiers, judge, keptEnough, lost } from "../extensions/retainer/compact.ts";
import { parseProposal, propose, SYSTEM_PROMPT } from "../extensions/retainer/shorten.ts";

const orig = [
	"Deploys run from ~/git/acme/orchard on branch feat/add-widgets (commit a1b2c3d, 2026-10-02) with `uv run orchard migrate`,",
	"pinned requests 2.31.0 and black 24.1.0, the ticket is PROJ-90650, --frozen is required, CACHE_TTL is 1 hour,",
	'sessions last 4 hours, see https://example.com/docs/design-v2.md, and Alex said "the cache needs a version check first, or this gets messy".',
].join(" ");

test("the identifiers that must survive are found: paths, commands, versions, keys, dates, hashes, flags, names, quotes", () => {
	const ids = identifiers(orig);
	for (const want of ["~/git/acme/orchard", "feat/add-widgets", "a1b2c3d", "2026-10-02", "uv run orchard migrate", "2.31.0", "24.1.0", "PROJ-90650", "--frozen", "CACHE_TTL", "4 hours", "https://example.com/docs/design-v2.md", "the cache needs a version check first, or this gets messy"]) {
		assert.ok(ids.includes(want), `missing from the list: ${want}\n${ids.join(" | ")}`);
	}
});

test("ordinary words with a slash or a capital are not identifiers", () => {
	const ids = identifiers("Use and/or TCP/IP, the Client and Server. Version 2. It took a while. OK.");
	assert.deepEqual(ids, []);
});

test("a rewrite that keeps every identifier passes, split notes count", () => {
	const short = "Deploys run from ~/git/acme/orchard on branch feat/add-widgets (commit a1b2c3d, 2026-10-02) with `uv run orchard migrate`; ticket PROJ-90650.";
	const splits = ["Pinned: requests 2.31.0 and black 24.1.0; --frozen is required; CACHE_TTL is 1 hour; sessions last 4 hours.", 'Design: https://example.com/docs/design-v2.md. Alex said "the cache needs a version check first, or this gets messy".'];
	assert.deepEqual(lost(orig, short, splits).missing, []);
	assert.deepEqual(judge(orig, { text: short, splits: splits.map((text) => ({ text })) }, 450), { ok: true });
});

test("dropping any identifier is refused, and the reason names it", () => {
	const v = judge(orig, { text: "Deploys run from the orchard repo; ticket PROJ-90650.", splits: [] }, 450);
	assert.equal(v.ok, false);
	if (!v.ok) assert.match(v.reasons.join(" "), /drops .*~\/git\/acme\/orchard/);
	const noQuote = judge(orig, { text: orig.replace(/, and Alex said.*$/, "."), splits: [{ text: "x".repeat(40) }] }, 450);
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

test("identifiers are matched as whole tokens: a longer number, id, version or path does not stand in for a shorter one", () => {
	const miss = (a: string, b: string) => lost(a, b).missing;
	assert.deepEqual(miss("see #12", "see #123"), ["#12"]);
	assert.deepEqual(miss("took 100 ms", "took 1100 ms"), ["100 ms"]);
	assert.deepEqual(miss("took 5 ms", "took 50 ms"), ["5 ms"]);
	assert.deepEqual(miss("at v1.2.3", "at v1.2.30"), ["v1.2.3"]);
	assert.deepEqual(miss("version 1.2", "version 1.2.3"), ["1.2"]);
	// but the same token with punctuation round it, or a space in a unit, is the same token
	assert.deepEqual(miss("see #12", "(see #12), and more"), []);
	assert.deepEqual(miss("at v1.2.3", "ends at v1.2.3."), []);
	assert.deepEqual(miss("took 30 min", "took 30min"), []);
	assert.deepEqual(miss("backs off 1/2/4/8/10 min", "backs off 1/2/4/8/10 min"), []);
});

test("short identifiers and more shapes are found: #1, 5%, two-part versions, ports, flags, emails, Windows paths, code names", () => {
	const ids = identifiers("Issue #1 got 5% faster on version 1.2, port 5433, use -f or --force, mail alex@example.com, file C:\\Users\\alex\\x.txt, call getUser and userConfig.displayName and appState.themeId.");
	for (const want of ["#1", "5%", "1.2", "5433", "-f", "--force", "alex@example.com", "C:\\Users\\alex\\x.txt", "getUser", "userConfig.displayName", "appState.themeId"]) assert.ok(ids.includes(want), `${want} in ${ids.join(" | ")}`);
	assert.deepEqual(identifiers("Use and/or TCP/IP. It works.Then no. e.g. fine, read/write, yes/no."), []);
});

test("matching a long text is fast", () => {
	const t0 = Date.now();
	const big = ("Run `tool --flag` in ~/git/app/x.ts, see https://example.com/a/b/c and #12 on 2026-10-02 v1.2.3 getUser() " + "word ".repeat(40)).repeat(150);
	lost(big, big.slice(0, 5000));
	assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});
