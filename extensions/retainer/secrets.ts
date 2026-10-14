/**
 * Looking for secrets in text about to be saved as a memory.
 *
 * Memories are stored in plain text and sent to the model, so a key or token saved by mistake
 * would go to both. This recognises a few kinds that are unmistakable (a provider's key format,
 * a private key block, a JSON web token, a bearer value, a password assignment) and nothing vague:
 * a long hex string or a path is not flagged, because those are far more often a commit hash or
 * a fingerprint than a secret. The text of a match is never returned, only its kind.
 *
 * Free of pi imports so it can be tested on its own.
 */

export interface SecretFinding {
	/** What it looks like, such as "an AWS access key id". */
	kind: string;
}

interface Detector {
	kind: string;
	test: (text: string) => boolean;
}

const re = (pattern: RegExp) => (text: string) => pattern.test(text);

/** Values that are placeholders or references, not secrets: ${VAR}, <token>, {{x}}, %VAR%, ***. */
const PLACEHOLDER = /^[$<{%*\[]/;

/** A value that could be a secret: long, no spaces, and a mix of letters and digits. */
function looksLikeValue(v: string): boolean {
	return v.length >= 12 && !PLACEHOLDER.test(v) && /[A-Za-z]/.test(v) && /\d/.test(v);
}

const ASSIGNMENT = /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']?([^\s"',;)]+)/gi;

const DETECTORS: Detector[] = [
	{ kind: "an AWS access key id", test: re(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/) },
	{ kind: "a GitHub token", test: re(/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/) },
	{ kind: "a Slack token", test: re(/\bxox[abprs]-[A-Za-z0-9-]{10,}/) },
	{ kind: "a private key", test: re(/-----BEGIN [A-Z ]*PRIVATE KEY-----/) },
	{ kind: "a JSON web token", test: re(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/) },
	{ kind: "a bearer token", test: re(/\bBearer\s+(?![$<{%*\[])[A-Za-z0-9._~+\/-]{24,}=*/) },
	{
		kind: "a password or key assignment",
		test: (text) => {
			for (const m of text.matchAll(ASSIGNMENT)) if (looksLikeValue(m[1]!)) return true;
			return false;
		},
	},
];

/** The kinds of secret the text appears to contain, in a fixed order; empty when it looks clean. */
export function findSecrets(text: string): SecretFinding[] {
	return DETECTORS.filter((d) => d.test(text)).map((d) => ({ kind: d.kind }));
}

/** The message for a refused save: what was found, and what to do instead. Never repeats the text. */
export function secretRefusal(findings: SecretFinding[]): string {
	const what = findings.map((f) => f.kind).join(" and ");
	return (
		`Not saved: the text looks like it contains ${what}. Memories are stored in plain text and sent to the model, so keep secrets out of them. ` +
		`Say where the secret lives instead (for example "the token is in the keyring under service X") and save that. ` +
		`If this is a false alarm, the user can turn the check off with write.checkSecrets in pi-retainer.json.`
	);
}
