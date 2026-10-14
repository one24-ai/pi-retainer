import assert from "node:assert/strict";
import { test } from "node:test";
import { findSecrets, secretRefusal } from "../extensions/retainer/secrets.ts";

const kinds = (t: string) => findSecrets(t).map((f) => f.kind);

// The samples are built from pieces so this file does not itself look like it holds a secret.
const AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const GH = ["ghp", "_", "a".repeat(36)].join("");
const SLACK = ["xoxb", "-", "1234567890", "-", "abcdefghij"].join("");
const PEM = ["-----BEGIN ", "RSA PRIVATE KEY", "-----"].join("");
const JWT = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dBjftJeZ4CVPmB92K27uhbUJU1p1r"].join(".");

test("unmistakable secrets are recognised, by kind", () => {
	assert.deepEqual(kinds(`The key is ${AWS} for the build account.`), ["an AWS access key id"]);
	assert.deepEqual(kinds(`token ${GH}`), ["a GitHub token"]);
	assert.deepEqual(kinds(`use ${SLACK} to post`), ["a Slack token"]);
	assert.deepEqual(kinds(`${PEM}\nMIIE...`), ["a private key"]);
	assert.deepEqual(kinds(`session ${JWT} expired`), ["a JSON web token"]);
	assert.deepEqual(kinds("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"), ["a bearer token"]);
	assert.deepEqual(kinds("The db password: hunter2hunter2x9 stays"), ["a password or key assignment"]);
	assert.deepEqual(kinds('export API_KEY="sk8Rj2kQ9xLm4Nv7Pz"'), ["a password or key assignment"]);
	assert.deepEqual(kinds(`aws ${AWS} and ${GH}`), ["an AWS access key id", "a GitHub token"]);
});

test("things that merely look technical are not flagged", () => {
	for (const text of [
		"Commit 9ad7a11404000852072607bb61a5ca30e3885c7c fixed it.",
		"Signing key fingerprint A99C71F2B3D4E5F60718293A4B5C6D7E8F901234, expires 2027-01-15.",
		"The token lives in the GNOME keyring under service artifacts.riotgames.com.",
		"Bearer ${ARTIFACTORY_TOKEN} is filled per command by the wrappers.",
		"Use `Authorization: Bearer <token>` against the API.",
		"password: <your password here>",
		"password = ${DB_PASSWORD}",
		"Set API_KEY=%API_KEY% in the batch file.",
		"secret: ***",
		"Paths like ~/git/riot/starforger/docs/very-long-file-name-for-research-utilization.md are fine.",
		"URL https://registry.rcluster.io/artifactory/api/npm/npm-platform is not a secret.",
		"The secret is stored by `secret-token cloudflare`.",
		"password: short1",
		"access_token expires after 1 hour",
		"",
	]) assert.deepEqual(kinds(text), [], text);
});

test("the refusal names the kind, tells the writer what to do, and never repeats the text", () => {
	const msg = secretRefusal(findSecrets(`key ${AWS} and ${GH}`));
	assert.match(msg, /^Not saved: .*an AWS access key id and a GitHub token/);
	assert.match(msg, /keyring/);
	assert.match(msg, /write\.checkSecrets/);
	assert.ok(!msg.includes(AWS) && !msg.includes(GH));
});

test("matching is fast on long text", () => {
	const t0 = Date.now();
	findSecrets("a".repeat(200_000) + " password: " + "b".repeat(100_000));
	findSecrets(("Bearer " + "x".repeat(30) + " ").repeat(5000));
	assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});
