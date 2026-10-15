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

import { findSecrets } from "./secrets.ts";

/**
 * Most notes a rewrite may split into: six, or one per 300 characters of a longer original (a
 * 3,900 character memory needs about nine notes of 450). Beyond that the model is inventing.
 */
export function maxSplits(originalLength: number): number {
	return Math.max(6, Math.ceil(originalLength / 300));
}

/** Things that must survive, as the exact strings that must still appear. */
export function identifiers(text: string): string[] {
	const found = new Set<string>();
	const add = (value: string | undefined) => {
		const v = (value ?? "").trim().replace(/[.,;:)\]}'"]+$/, "").replace(/^[(\[{'"]+/, "");
		if (v.length >= 2) found.add(v);
	};
	for (const m of text.matchAll(/https?:\/\/[^\s)`'",;]+/g)) add(m[0]);
	// A path has a slash between two name characters, but "and/or" and "TCP/IP" are words. So it
	// must start with ~, a dot or a slash, or have two slashes, or end in a file extension, or be a
	// two-part name (feat/poc-scaffold, org/repo) where a part has a hyphen, digit or dot.
	for (const m of text.matchAll(/(?<![\w\/.-])(?:~|\.{1,2})?\/?[\w@.-]+(?:\/[\w@.-]+)+\/?/g)) {
		const v = m[0].replace(/[.,;:!?)\]]+$/, ""); // the full stop that ends a sentence is not part of the path
		const slashes = (v.match(/\//g) ?? []).length;
		const looksLikeName = slashes === 1 && v.split("/").every((p) => /^[A-Za-z0-9@._-]+$/.test(p) && p.length >= 2) && /[-\d.]/.test(v.replace(/\/$/, ""));
		if (/^(?:~|\.|\/)/.test(v) || slashes >= 2 || /\.\w{1,6}$/.test(v) || looksLikeName) add(v);
	}
	for (const m of text.matchAll(/`([^`\n]{2,120})`/g)) add(m[1]);
	for (const m of text.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g)) add(m[0]);
	for (const m of text.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g)) add(m[0]);
	for (const m of text.matchAll(/\bv?\d+\.\d+(?:\.\d+)*(?:-[\w.]+)?\b/g)) add(m[0]);
	for (const m of text.matchAll(/(?<![\w-])--[a-z][\w-]+|(?<=\s)-[a-zA-Z](?=[\s=`)]|$)/g)) add(m[0]);
	for (const m of text.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)) add(m[0]);
	for (const m of text.matchAll(/[A-Za-z]:\\[^\s"'`)]+/g)) add(m[0]);
	// Code names: camelCase (footerSegments), dotted (agentConfig.modelSetId, process.env.X), taken
	// whole, so the dotted form is what must survive, not each half.
	for (const m of text.matchAll(/(?<![\w.\/-])[a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+(?:\.[A-Za-z][\w]*)*(?![\w])|(?<![\w.\/-])[a-z][a-z0-9]+(?:\.[a-z][A-Za-z0-9_]+){1,3}(?![\w\/])/g)) {
		const v = m[0].replace(/\.$/, "");
		// A dotted word that ends like a file name (config.yaml) is a path, and a sentence end (it.Then) is not a name.
		if (/[A-Z]/.test(v) || (v.split(".").length >= 3 && !/\.(?:md|ts|js|json|yaml|yml|txt|db|sh|py|toml|lock)$/.test(v))) add(v);
	}
	for (const m of text.matchAll(/(?<=port |ports |:)\d{2,5}\b/gi)) add(m[0]);
	for (const m of text.matchAll(/'([A-Za-z][^'\n]{10,160}[A-Za-z0-9.!?])'(?![\w'])(?<=[\s(]'[^']*')/g)) add(m[1]);
	for (const m of text.matchAll(/\b[0-9a-f]{7,40}\b/g)) if (/[a-f]/.test(m[0]) && /\d/.test(m[0])) add(m[0]);
	for (const m of text.matchAll(/(?<![\w])#\d+\b/g)) add(m[0]);
	for (const m of text.matchAll(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g)) add(m[0]);
	for (const m of text.matchAll(/(?<![\w.])\d+(?:\.\d+)?\s?(?:(?:ms|s|min|h|hours?|days?|KB|MB|GB|chars?|characters|tok\/s|k)(?![\w])|%)/g)) add(m[0].replace(/\s+/, " "));
	// A quoted phrase is something said word for word. The opening quote must follow a space or an
	// opening bracket and the closing one must be followed by one of those or punctuation, so the
	// gap between two quoted strings ("a", then ", and "b") is never read as a phrase.
	for (const m of text.matchAll(/(?<![\w"])"([A-Za-z][^"\n`]{10,160}[A-Za-z0-9.!?])"(?![\w"])/g)) add(m[1]);
	return [...found];
}

/** Case and spacing ignored; a number and its unit are the same with or without a space ("30 min", "30min"). */
const UNIT = "ms|s|min|h|hours?|days?|kb|mb|gb|chars?|characters|tok\\/s|k";
const flat = (s: string) =>
	s
		.toLowerCase()
		.replace(/\s+/g, " ")
		.replace(new RegExp(`(\\d) (?=(?:${UNIT}|%)(?![\\w]))`, "g"), "$1");

/**
 * True when `needle` is in `hay` as a whole token: not the start or end of something longer.
 * "#12" is not satisfied by "#123", "100 ms" not by "1100 ms", "v1.2.3" not by "v1.2.30" or "1.2.3.4".
 */
function contains(hay: string, needle: string): boolean {
	const n = flat(needle);
	if (!n) return true;
	const isWord = (c: string | undefined) => c !== undefined && /\w/.test(c);
	const startsWord = isWord(n[0]);
	const endsWord = isWord(n[n.length - 1]);
	for (let i = hay.indexOf(n); i >= 0; i = hay.indexOf(n, i + 1)) {
		const before = hay[i - 1];
		const after = hay[i + n.length];
		// Something word-like directly before, or a longer token directly after, means this is only part of it.
		const startsInside = startsWord && isWord(before);
		// A unit written after the number ("10 min" flattened to "10min") is the same token, not more of it.
		const unitAfter = new RegExp(`^(?:${UNIT}|%)(?![\\w])`).test(hay.slice(i + n.length));
		const endsInside = endsWord && !unitAfter && (isWord(after) || (after === "." && isWord(hay[i + n.length + 1])));
		if (!startsInside && !endsInside) return true;
	}
	return false;
}

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
	return { missing: ids.filter((i) => !contains(all, i)), checked: ids.length };
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
	if (p.text.length >= original.length) reasons.push("it is not shorter");
	if (p.splits.length > maxSplits(original.length)) reasons.push(`it splits into ${p.splits.length} notes (at most ${maxSplits(original.length)})`);
	const total = p.text.length + splits.reduce((n, t) => n + t.length, 0);
	if (total > original.length * 1.5) reasons.push("it is much longer than the original in total");
	const secrets = findSecrets([p.text, ...splits].join("\n"));
	if (secrets.length > 0) reasons.push(`it contains ${secrets.map((x) => x.kind).join(" and ")}`);
	const l = lost(original, p.text, splits);
	if (l.missing.length > 0) reasons.push(`drops ${l.missing.slice(0, 4).map((m) => JSON.stringify(m.length > 40 ? `${m.slice(0, 39)}…` : m)).join(", ")}${l.missing.length > 4 ? ` and ${l.missing.length - 4} more` : ""}`);
	if (!keptEnough(original, p.text, splits)) reasons.push("it keeps less than 45% of the text");
	if (/[\u2014\u2013]/.test([p.text, ...splits].join(""))) reasons.push("it uses a long dash");
	return reasons.length ? { ok: false, reasons } : { ok: true };
}
