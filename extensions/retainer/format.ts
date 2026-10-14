/**
 * How memories are written out for the model and for people. Free of pi imports.
 */

import { firstSentence } from "./digest.ts";
import type { MemoryRow } from "./store.ts";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** A memory in full: "#12 [fact] [pinned] text (tag, tag)". */
export function formatRow(row: MemoryRow): string {
	const pin = row.pinned ? " [pinned]" : "";
	const tags = row.tags.length > 0 ? ` (${row.tags.join(", ")})` : "";
	return `#${row.id} [${row.kind}]${pin} ${row.text}${tags}`;
}

/** A memory for a search result: whole when short, else its first sentence and its length. */
export function formatSearchRow(row: MemoryRow, inlineChars: number): { text: string; shortened: boolean } {
	const flat = oneLine(row.text);
	const pin = row.pinned ? " [pinned]" : "";
	const tags = row.tags.length > 0 ? ` (${row.tags.join(", ")})` : "";
	if (flat.length <= inlineChars) return { text: `#${row.id} [${row.kind}]${pin} ${flat}${tags}`, shortened: false };
	const head = firstSentence(flat, Math.max(40, Math.floor(inlineChars * 0.6)));
	return { text: `#${row.id} [${row.kind}]${pin} ${head} [${flat.length} chars]${tags}`, shortened: true };
}

/** A note for memory_write / memory_update when the text is long. Empty when it is not. */
export function lengthNote(text: string, warnChars: number, inlineChars: number): string {
	if (warnChars <= 0 || text.length <= warnChars) return "";
	return (
		`\nNote: this memory is ${text.length} characters. Recall lists memories over ${inlineChars} by their first sentence only, ` +
		`so put the key point first, and split unrelated points into separate memories (memory_update can shorten this one).`
	);
}

/**
 * A note for memory_write when it saved something close to a memory that already exists: names
 * them so the model can revise one instead of keeping two. Empty when there are none.
 */
export function similarNote(similar: { row: MemoryRow; score: number }[]): string {
	if (similar.length === 0) return "";
	const list = similar.map(({ row, score }) => `#${row.id} (${Math.round(score * 100)}% the same words)`).join(", ");
	return `\nNote: this is close to ${list}. If it says the same thing, revise that one with memory_update and forget the new one with memory_forget instead of keeping both.`;
}

/** "1 memory", "3 memories". */
export const memories = (n: number) => `${n} ${n === 1 ? "memory" : "memories"}`;

/** 3812 -> "3.8K", 950 -> "950". */
export function compactChars(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : String(n);
}
