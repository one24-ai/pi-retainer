/**
 * The /memory-compact flow, apart from pi: choose the memories, ask for each, check the answer,
 * and apply what passes. The model, the questions to the person and the store are passed in, so
 * the whole flow runs in tests with a fake model.
 *
 * Free of pi imports so it can be tested on its own.
 */

import { judge, type Proposal } from "./compact.ts";
import { type Ask, propose } from "./shorten.ts";
import type { MemoryKind, MemoryRow } from "./store.ts";

export interface CompactStore {
	get(id: number): MemoryRow | undefined;
	update(id: number, patch: { text?: string }): MemoryRow | undefined;
	write(input: { scope: string; kind: MemoryKind; text: string; tags?: string[]; sessionId?: string | null }): { row: MemoryRow; deduplicated: boolean };
}

export interface Candidate {
	row: MemoryRow;
	/** Characters of the memory. */
	size: number;
}

/** The longest memories first, over `minChars`, never summaries. */
export function pickLong(rows: MemoryRow[], minChars: number, limit: number): Candidate[] {
	return rows
		.filter((r) => r.kind !== "summary" && r.text.length > minChars)
		.sort((a, b) => b.text.length - a.text.length || a.id - b.id)
		.slice(0, limit)
		.map((row) => ({ row, size: row.text.length }));
}

/** Rough input size for an estimate, at about four characters a token, plus the prompt's own cost. */
export function estimate(candidates: Candidate[]): { requests: number; inputTokens: number; outputTokens: number } {
	const chars = candidates.reduce((n, c) => n + c.size, 0);
	return { requests: candidates.length, inputTokens: Math.round(chars / 4) + candidates.length * 260, outputTokens: Math.round(chars / 4) };
}

export interface Outcome {
	row: MemoryRow;
	proposal?: Proposal;
	/** Why there is no usable proposal, or why the check refused it. */
	problems: string[];
}

export interface CompactOptions {
	target: number;
	hardCap: number;
	/** Requests run this many at a time. */
	concurrency: number;
	signal?: AbortSignal;
	onProgress?: (done: number, total: number) => void;
}

/** Ask for every candidate and check each answer. Nothing is written. */
export async function proposeAll(ask: Ask, candidates: Candidate[], opts: CompactOptions): Promise<Outcome[]> {
	const results: Outcome[] = new Array(candidates.length);
	let next = 0;
	let done = 0;
	const worker = async () => {
		for (;;) {
			const i = next++;
			if (i >= candidates.length || opts.signal?.aborted) return;
			const { row } = candidates[i]!;
			const r = await propose(ask, row.text, opts.target, opts.hardCap);
			if ("error" in r) results[i] = { row, problems: [r.error] };
			else {
				const v = judge(row.text, r.proposal, opts.hardCap);
				results[i] = v.ok ? { row, proposal: r.proposal, problems: [] } : { row, proposal: r.proposal, problems: v.reasons };
			}
			opts.onProgress?.(++done, candidates.length);
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, candidates.length)) }, worker));
	return results.filter(Boolean);
}

export interface Applied {
	updated: number;
	added: number;
	skipped: { id: number; why: string }[];
}

/**
 * Write the proposals that passed. A memory that changed since it was read is left alone, so a
 * rewrite never overwrites an edit made while the model was working.
 */
export function apply(store: CompactStore, outcomes: Outcome[], sessionId: string | null): Applied {
	const out: Applied = { updated: 0, added: 0, skipped: [] };
	for (const o of outcomes) {
		if (!o.proposal || o.problems.length > 0) continue;
		const now = store.get(o.row.id);
		if (!now) { out.skipped.push({ id: o.row.id, why: "it was deleted meanwhile" }); continue; }
		if (now.text !== o.row.text) { out.skipped.push({ id: o.row.id, why: "it changed meanwhile" }); continue; }
		try {
			store.update(o.row.id, { text: o.proposal.text });
			out.updated++;
		} catch (err) {
			out.skipped.push({ id: o.row.id, why: (err as Error).message });
			continue;
		}
		for (const sp of o.proposal.splits) {
			// A kind the model names must be one that memories may have and that recall lists; "summary"
			// is not (summaries are never recalled), so it becomes a fact. No kind: the source's kind.
			const named = sp.kind as string | undefined;
			const kind: MemoryKind = named === undefined ? (o.row.kind === "summary" ? "fact" : o.row.kind) : named === "decision" || named === "preference" || named === "gotcha" ? named : "fact";
			const w = store.write({ scope: o.row.scope, kind, text: sp.text, tags: o.row.tags, sessionId });
			if (!w.deduplicated) out.added++;
		}
	}
	return out;
}

/** One line for the confirmation: the id, the sizes, and how many separate notes were split off. */
export function line(o: Outcome): string {
	const was = o.row.text.length;
	if (!o.proposal) return `#${o.row.id} ${was}c: no result (${o.problems[0]})`;
	const parts = o.proposal.splits.length;
	const now = o.proposal.text.length;
	const head = `#${o.row.id} ${was}c -> ${now}c${parts ? ` + ${parts} new` : ""}`;
	return o.problems.length ? `${head}: REFUSED, ${o.problems.join("; ")}` : head;
}
