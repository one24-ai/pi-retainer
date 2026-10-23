/**
 * Looking for secrets in text about to be saved as a memory.
 *
 * Memories are stored in plain text and sent to the model, so a key or token saved by mistake
 * would go to both. This recognises kinds that are unmistakable (a provider's key format, a
 * private key block, a JSON web token, a password in a URL, a bearer value, a password or key
 * assignment such as DB_PASSWORD=...) and nothing vague: a long hex string or a path is not
 * flagged, because those are far more often a commit hash or a fingerprint than a secret, and an
 * assignment whose value is a path, a file name or a reference ("password: /run/secrets/db1") is
 * a note about where a secret lives. The text of a match is never returned, only its kind.
 *
 * It is a safety net, not a guarantee: a secret in an unusual shape will pass, and the text has
 * already reached the tool call by the time it is checked.
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

/**
 * A value that could be a secret rather than a note about one: long, with a letter and a digit,
 * and not a path, a file name, a reference to an environment variable or a hyphenated phrase.
 * A real password or key almost never looks like `/run/secrets/db1`, `process.env.SECRET_2` or
 * `see-keyring-service-v2`, and notes about where a secret lives often do.
 */
function looksLikeValue(v: string): boolean {
	if (v.length < 12 || PLACEHOLDER.test(v)) return false;
	if (!/[A-Za-z]/.test(v) || !/\d/.test(v)) return false;
	if (/^[~.\/\\]|[\/\\]/.test(v)) return false; // a path
	if (/\.[A-Za-z]/.test(v)) return false; // process.env.X, config.yaml, host.example.com
	if (/^[a-z0-9]+(?:[-_][a-z0-9]+){2,}$/.test(v)) return false; // all lower case words joined by - or _
	return true;
}

/** Names that hold a secret. A prefix (DB_, STRIPE_, AWS_) and a suffix (_ID is excluded below) are allowed. */
const SECRET_NAME = "(?:[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|access[_-]?token|auth[_-]?token|token|credentials?)(?:[_-][A-Za-z0-9]+)*";
const ASSIGNMENT = new RegExp(`(?<![A-Za-z0-9])(${SECRET_NAME})["']?\\s*[:=]\\s*["']?([^\\s"',;)]+)`, "gi");
/** A name that ends in one of these only identifies a key (AWS_ACCESS_KEY_ID), it does not hold it. */
const NOT_A_SECRET_NAME = /[_-](?:id|name|url|uri|path|file|dir|ttl|expiry|expires|type|length|count|prefix|endpoint|host|region|user|username|label)$/i;

const BEARER = /\bBearer\s+([A-Za-z0-9._~+\/-]{24,}=*)/gi;

const DETECTORS: Detector[] = [
	{ kind: "an AWS access key id", test: re(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/) },
	{ kind: "a GitHub token", test: re(/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/) },
	{ kind: "a Slack token", test: re(/\bxox[abprs]-[A-Za-z0-9-]{10,}/) },
	{ kind: "an API key", test: re(/\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{36}|glpat-[A-Za-z0-9_-]{20,})/) },
	{ kind: "a private key", test: re(/-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/) },
	{ kind: "a JSON web token", test: re(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/) },
	{ kind: "a password in a URL", test: re(/\b[a-z][a-z0-9+.-]*:\/\/[^\s:@\/]+:(?![$<{%*\[])[^\s:@\/]{6,}@[^\s\/]+/i) },
	{
		kind: "a bearer token",
		test: (text) => {
			for (const m of text.matchAll(BEARER)) if (!PLACEHOLDER.test(m[1]!) && looksLikeValue(m[1]!)) return true;
			return false;
		},
	},
	{
		kind: "a password or key assignment",
		test: (text) => {
			for (const m of text.matchAll(ASSIGNMENT)) {
				if (NOT_A_SECRET_NAME.test(m[1]!)) continue;
				if (looksLikeValue(m[2]!)) return true;
			}
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
