/**
 * Asking a model to shorten memories, outside the conversation.
 *
 * One request per memory, so a failure costs one memory and each answer can be checked against its
 * own original. The request goes through a function the caller supplies, so the prompt and the
 * parsing here are testable without a model.
 *
 * Free of pi imports so it can be tested on its own.
 */

import type { Proposal } from "./compact.ts";

export const SYSTEM_PROMPT = [
	"You shorten notes in a memory store for a coding agent. You are given one note.",
	"Rules:",
	"1. Put the key point first, in one self-contained sentence or two, readable without context.",
	"2. Never drop a fact. Anything that does not fit the short note goes into its own separate note.",
	"3. Keep every identifier exactly as written: file paths, URLs, commands, flags, ticket keys, version numbers, dates, commit hashes, environment variable names, numbers with units, and any text in quotation marks.",
	"4. Do not invent anything and do not add commentary.",
	"5. Plain text. Do not use long dashes.",
	'Answer with only JSON, in this shape: {"text": "the short note", "splits": [{"kind": "fact", "text": "one separate point"}]}.',
	'"kind" is fact or gotcha. Use "splits": [] when everything fits in the short note.',
].join("\n");

export function userPrompt(text: string, target: number, hardCap: number): string {
	return `Shorten this note to about ${target} characters (never more than ${hardCap}); each separate note must also be at most ${hardCap}.\n\n${text}`;
}

const KINDS = new Set(["fact", "gotcha"]);

/** The JSON object in a model's answer, which may be wrapped in a code fence or a sentence. */
export function parseProposal(answer: string): Proposal | undefined {
	const start = answer.indexOf("{");
	const end = answer.lastIndexOf("}");
	if (start < 0 || end <= start) return undefined;
	let data: unknown;
	try {
		data = JSON.parse(answer.slice(start, end + 1));
	} catch {
		return undefined;
	}
	if (!data || typeof data !== "object") return undefined;
	const { text, splits } = data as { text?: unknown; splits?: unknown };
	if (typeof text !== "string" || !text.trim()) return undefined;
	const list = Array.isArray(splits) ? splits : [];
	const out: Proposal["splits"] = [];
	for (const s of list) {
		if (!s || typeof s !== "object" || typeof (s as { text?: unknown }).text !== "string") return undefined;
		const t = (s as { text: string }).text.trim();
		const k = (s as { kind?: unknown }).kind;
		if (t) out.push({ kind: typeof k === "string" && KINDS.has(k) ? k : undefined, text: t });
	}
	return { text: text.trim(), splits: out };
}

export type Ask = (system: string, user: string) => Promise<string | undefined>;

/** One memory's proposal, or the reason there is none. */
export async function propose(ask: Ask, original: string, target: number, hardCap: number): Promise<{ proposal: Proposal } | { error: string }> {
	let answer: string | undefined;
	try {
		answer = await ask(SYSTEM_PROMPT, userPrompt(original, target, hardCap));
	} catch (err) {
		return { error: `the request failed: ${(err as Error).message}` };
	}
	if (!answer) return { error: "the model gave no answer" };
	const proposal = parseProposal(answer);
	return proposal ? { proposal } : { error: "the answer was not the expected JSON" };
}
