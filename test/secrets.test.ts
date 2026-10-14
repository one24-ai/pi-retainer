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

test("variable names with a prefix are caught: the secret is in the value, not the bare name", () => {
	const j = (...p: string[]) => p.join("");
	for (const t of [
		j("DB_PASS", "WORD=hunter2hunter2x9"),
		j("STRIPE_API", "_KEY=", "sk8Rj2kQ9xLm4Nv7Pz"),
		j("AWS_SECRET", "_ACCESS_KEY=", "wJalrXUtnFEMI7MDENGbPxRfiCY2EXAMPLE"),
		j("MY_SEC", "RET: Zk3mP9qR2vX8nL5t"),
		j("OPENAI_API", "_KEY=", "abcDEF123ghiJKL456"),
		j("client", "_secret=", "Zk3mP9qR2vX8nL5t"),
		j("authorization: bea", "rer ", "abcdefghijklmnopqrstuvwxyz0123456789"),
	]) assert.ok(kinds(t).length > 0, "should be caught");
});

test("more provider keys and shapes are recognised", () => {
	const j = (...p: string[]) => p.join("");
	assert.deepEqual(kinds(j("sk-", "ant-", "api03-abcdefghijklmnopqrstu")), ["an API key"]);
	assert.deepEqual(kinds(j("sk-", "a".repeat(40))), ["an API key"]);
	assert.deepEqual(kinds(j("AI", "zaSyA", "-1234567890abcdefghijklmnopqrstuv")), ["an API key"]);
	assert.deepEqual(kinds(j("npm", "_", "a".repeat(36))), ["an API key"]);
	assert.deepEqual(kinds(j("postgres://app:", "s3cretPass9", "@db.example.com:5432/x")), ["a password in a URL"]);
	assert.deepEqual(kinds(j("-----BEGIN PGP ", "PRIVATE KEY BLOCK", "-----")), ["a private key"]);
});

test("notes about where a secret lives are not flagged: paths, references and file names", () => {
	for (const t of [
		"password: /run/secrets/db1",
		"secret: ~/.config/app/secret1.json",
		"api_key: see-keyring-service-v2",
		"client_secret=azure-keyvault-ref1",
		"secret: process.env.SECRET_2",
		"Bearer token-authentication-flow-v2-details",
		"Bearer /path/to/long/file/name/here1",
		"AWS_ACCESS_KEY_ID=AKIA-is-the-id-1234567",
		"token: ${GITHUB_TOKEN}",
		"password = $DB_PASSWORD1",
		"credentials: see docs/credentials-setup2.md",
		"TOKEN_TTL=3600seconds-ok-now1",
		"postgres://localhost:5432/appdb",
		"https://user@example.com/path",
		"ssh://git@github.com/org/repo.git",
		"PI_RETAINER_DB=/tmp/test-retainer-db1.db",
	]) assert.deepEqual(kinds(t), [], t);
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
