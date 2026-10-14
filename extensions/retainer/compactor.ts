/**
 * The /memory-compact flow, apart from pi: choose the memories, ask for each, check the answer,
 * and apply what passes. The model, the questions to the person and the store are passed in, so
 * the whole flow runs in tests with a fake model.
 *
 * Free of pi imports so it can be tested on its own.
 */

import { judge, maxSplits, type Proposal } from "./compact.ts";
import { type Ask, propose } from "./shorten.ts";
import type { MemoryKind, MemoryRow } from "./store.ts";

export interface CompactStore {
	get(id: number): MemoryRow | undefined;
	update(id: number, patch: { text?: string }): MemoryRow | undefined;
	write(input: { scope: string; kind: MemoryKind; text: string; tags?: string[]; pinned?: boolean; sessionId?: string | null }): { row: MemoryRow; deduplicated: boolean };
	findSame(scope: string, text: string): MemoryRow | undefined;
	transaction<T>(fn: () => T): T;
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
 * Write the proposals that passed, each as one unit: the shorter text and its split-off notes are
 * saved together or not at all, so a failure part way never leaves a memory shortened with its
 * detail missing. A memory that changed since it was read (its text, scope, kind, pin or tags) is
 * left alone, so a rewrite never overwrites an edit made while the model was working. A split that
 * says what some memory already says is not written, and that memory is not touched.
 */
export function apply(store: CompactStore, outcomes: Outcome[], sessionId: string | null): Applied {
	const out: Applied = { updated: 0, added: 0, skipped: [] };
	for (const o of outcomes) {
		if (!o.proposal || o.problems.length > 0) continue;
		const now = store.get(o.row.id);
		if (!now) { out.skipped.push({ id: o.row.id, why: "it was deleted meanwhile" }); continue; }
		const moved = now.text !== o.row.text || now.scope !== o.row.scope || now.kind !== o.row.kind || now.pinned !== o.row.pinned || now.tags.join("\u0000") !== o.row.tags.join("\u0000");
		if (moved) { out.skipped.push({ id: o.row.id, why: "it changed meanwhile" }); continue; }
		// The check already refuses too many notes; if one gets here, skip it rather than drop notes.
		const splits = o.proposal.splits;
		if (splits.length > maxSplits(o.row.text.length)) { out.skipped.push({ id: o.row.id, why: `it has ${splits.length} notes, too many` }); continue; }
		try {
			let added = 0;
			store.transaction(() => {
				store.update(o.row.id, { text: o.proposal!.text });
				for (const sp of splits) {
					// A kind the model names must be one that memories may have and that recall lists; "summary"
					// is not (summaries are never recalled), so it becomes a fact. No kind: the source's kind.
					const named = sp.kind as string | undefined;
					const kind: MemoryKind = named === undefined ? (now.kind === "summary" ? "fact" : now.kind) : named === "decision" || named === "preference" || named === "gotcha" ? named : "fact";
					if (store.findSame(now.scope, sp.text)) continue; // said already: leave that memory as it is
					// A shortened pinned memory keeps its detail in recall: its notes are pinned too.
					store.write({ scope: now.scope, kind, text: sp.text, tags: now.tags, pinned: now.pinned, sessionId });
					added++;
				}
			});
			out.updated++;
			out.added += added;
		} catch (err) {
			out.skipped.push({ id: o.row.id, why: (err as Error).message });
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
