/**
 * Where pi-retainer keeps its database and snapshots.
 *
 * PI_RETAINER_DB names the database file. Otherwise it lives in the XDG data directory:
 * $XDG_DATA_HOME/pi-retainer/retainer.db, else ~/.local/share/pi-retainer/retainer.db.
 *
 * Kept from pi-domain, the old name: PI_DOMAIN_DB still works, and a database pi-domain left at
 * pi-domain/domain.db is used where it is (never moved or copied) until a pi-retainer one exists.
 *
 * Free of pi imports so it can be tested on its own.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export type DbSource = "env" | "default";

export interface DbLocation {
	path: string;
	source: DbSource;
}

type Env = Record<string, string | undefined>;

function dataRoot(env: Env, home: string): string {
	const xdg = env.XDG_DATA_HOME;
	return xdg && isAbsolute(xdg) ? xdg : join(home, ".local", "share");
}

/** The directory holding the database and its backups. */
export function dataDir(env: Env = process.env, home: string = homedir()): string {
	return join(dataRoot(env, home), "pi-retainer");
}

export function defaultDbPath(env: Env = process.env, home: string = homedir()): string {
	return join(dataDir(env, home), "retainer.db");
}

/** Where pi-domain, this package's old name, kept its database. */
export function legacyDbPath(env: Env = process.env, home: string = homedir()): string {
	return join(dataRoot(env, home), "pi-domain", "domain.db");
}

export function resolveDb(env: Env = process.env, home: string = homedir(), exists: (path: string) => boolean = existsSync): DbLocation {
	const override = env.PI_RETAINER_DB || env.PI_DOMAIN_DB;
	if (override) return { path: override, source: "env" };
	const path = defaultDbPath(env, home);
	const legacy = legacyDbPath(env, home);
	if (!exists(path) && exists(legacy)) return { path: legacy, source: "default" };
	return { path, source: "default" };
}

/**
 * Where snapshots of this database go: a `backups` folder beside it. For an overridden database
 * that keeps a test or a second database from writing into, or pruning, the real backups.
 */
export function backupDirFor(loc: DbLocation): string {
	return join(dirname(loc.path), "backups");
}
