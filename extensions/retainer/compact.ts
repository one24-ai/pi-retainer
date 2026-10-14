/**
 * The check that makes shortening safe: nothing a later session could need may disappear.
 *
 * A rewrite of a memory (and the new memories split out of it) must still hold every identifier
 * the original had: URLs, paths, `commands in backticks`, ticket keys, versions, dates, commit
 * hashes, flags, #ids, environment-style names and numbers with units. Those are the facts that
 * cannot be reconstructed from the gist, and the ones a model drops when it is asked to be short.
 * The check is mechanical and deliberately strict; a rewrite that fails it is shown to the person
 * and left unchanged, never applied.
 *
 * Free of pi imports so it can be tested on its own.
 */

/** Things that must survive, as the exact strings that must still appear. */
export function identifiers(text: string): string[] {
	const found = new Set<string>();
	const add = (value: string | undefined) => {
		const v = (value ?? "").trim().replace(/[.,;:)\]}'"]+$/, "").replace(/^[(\[{'"]+/, "");
		if (v.length >= 3) found.add(v);
	};
	for (const m of text.matchAll(/https?:\/\/[^\s)`'",;]+/g)) add(m[0]);
	// A path has a slash between two name characters, but "and/or" and "TCP/IP" are words. So it
	// must start with ~, a dot or a slash, or have two slashes, or end in a file extension, or be a
	// two-part name (feat/poc-scaffold, org/repo) where a part has a hyphen, digit or dot.
	for (const m of text.matchAll(/(?<![\w\/.-])(?:~|\.{1,2})?\/?[\w@.-]+(?:\/[\w@.-]+)+\/?/g)) {
		const v = m[0];
		const slashes = (v.match(/\//g) ?? []).length;
		const looksLikeName = slashes === 1 && v.split("/").every((p) => /^[A-Za-z0-9@._-]+$/.test(p) && p.length >= 2) && /[-\d.]/.test(v.replace(/\/$/, ""));
		if (/^(?:~|\.|\/)/.test(v) || slashes >= 2 || /\.\w{1,6}$/.test(v) || looksLikeName) add(v);
	}
	for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) add(m[1]);
	for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g)) add(m[0]);
	for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(m[0]);
	for (const m of text.matchAll(/\bv?\d+\.\d+(?:\.\d+)+(?:-[\w.]+)?\b/g)) add(m[0]);
	for (const m of text.matchAll(/(?<![\w-])--?[a-z][\w-]{1,}/g)) if (m[0].startsWith("--")) add(m[0]);
	for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) if (/[a-f]/.test(m[0]) && /\d/.test(m[0])) add(m[0]);
	for (const m of text.matchAll(/(?<![\w])#\d+\b/g)) add(m[0]);
	for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) add(m[0]);
	for (const m of text.matchAll(/\b\d+(?:\.\d+)?\s?(?:ms|s|min|h|hours?|days?|KB|MB|GB|%|chars?|characters|tok\/s|k)\b/g)) add(m[0].replace(/\s+/, " "));
	// A quoted phrase is something said word for word. The opening quote must follow a space or an
	// opening bracket and the closing one must be followed by one of those or punctuation, so the
	// gap between two quoted strings ("a", then ", and "b") is never read as a phrase.
	for (const m of text.matchAll(/(?<![\w"])"([A-Za-z][^"\n`]{10,160}[A-Za-z0-9.!?])"(?![\w"])/g)) add(m[1]);
	return [...found];
}

const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

export interface LossReport {
	/** Identifiers of the original that appear nowhere in the rewrite or its splits. */
	missing: string[];
	/** How many identifiers the original had. */
	checked: number;
}

/** Which identifiers of `original` are absent from `rewrite` and `splits` together. */
export function lost(original: string, rewrite: string, splits: string[] = []): LossReport {
	const all = flat([rewrite, ...splits].join(" \n "));
	const ids = identifiers(original);
	return { missing: ids.filter((i) => !all.includes(flat(i))), checked: ids.length };
}

/** A rewrite that "shortens" by deleting most of the text is a deletion, whatever the identifiers say. */
export function keptEnough(original: string, rewrite: string, splits: string[] = [], minShare = 0.45): boolean {
	if (original.length < 500) return true;
	const kept = rewrite.length + splits.reduce((n, s) => n + s.length, 0);
	return kept >= original.length * minShare;
}

export interface Proposal {
	/** The new text for the memory. */
	text: string;
	/** New memories for the points that did not fit. */
	splits: { kind?: string; text: string }[];
}

export type Verdict = { ok: true } | { ok: false; reasons: string[] };

/** Everything that must hold before a proposal may be applied. `maxChars` caps rewrite and each split. */
export function judge(original: string, p: Proposal, maxChars: number): Verdict {
	const reasons: string[] = [];
	const splits = p.splits.map((s) => s.text);
	if (!p.text.trim()) reasons.push("the rewrite is empty");
	const tooLong = [p.text, ...splits].filter((t) => t.length > maxChars).length;
	if (tooLong > 0) reasons.push(`${tooLong} part${tooLong === 1 ? " is" : "s are"} over ${maxChars} characters`);
	if (p.text.length >= original.length && splits.length === 0) reasons.push("it is not shorter");
	const l = lost(original, p.text, splits);
	if (l.missing.length > 0) reasons.push(`drops ${l.missing.slice(0, 4).map((m) => JSON.stringify(m.length > 40 ? `${m.slice(0, 39)}…` : m)).join(", ")}${l.missing.length > 4 ? ` and ${l.missing.length - 4} more` : ""}`);
	if (!keptEnough(original, p.text, splits)) reasons.push("it keeps less than 45% of the text");
	if (/[\u2014\u2013]/.test([p.text, ...splits].join(""))) reasons.push("it uses a long dash");
	return reasons.length ? { ok: false, reasons } : { ok: true };
}
