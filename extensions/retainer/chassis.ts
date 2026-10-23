/**
 * pi-retainer's side of the optional pairing with pi-chassis. Nothing here imports chassis: chassis, when it
 * is loaded, leaves a registry on globalThis, and pi-retainer offers it three things through it.
 *
 *  - Tool rows: chassis-styled one-line rows for the memory tools, registered with an owner id so a
 *    /reload replaces them instead of adding more. If chassis has not loaded yet they wait in chassis's
 *    pending queue; chassis takes them when it loads.
 *  - The recall row: "memory-recall" goes into chassis's shared set of message types that draw their
 *    own plain row, so chassis adds no panel around it.
 *  - A sidebar section, registered at session start only when chassis is there: how much was
 *    recalled against the budget.
 *
 * Without chassis none of this runs and pi-retainer draws its own rows.
 *
 * The protocol (pi-chassis's docs/widgets.md, "Adding a widget without depending on pi-chassis", and
 * docs/tool-rows.md, "Tool rows for your extension's tools"):
 *   globalThis[Symbol.for("pi-chassis/registry")]: { apiVersion, register(pi, spec, ctx?),
 *     toolRowsVersion, registerToolRows(specs, { id }) }
 *   globalThis[Symbol.for("pi-chassis/pendingToolRows")]: [{ specs, id, attach(remove) }]
 *   globalThis[Symbol.for("pi-chassis/plainMessageTypes")]: Set<string>
 */

/** nf-md-brain, with a plain twin for terminals without a Nerd Font. */
export const MEMORY_ICON = { nerd: "\u{F09D1}", plain: "#" };

const REGISTRY = Symbol.for("pi-chassis/registry");
const PENDING_TOOL_ROWS = Symbol.for("pi-chassis/pendingToolRows");
const PLAIN_TYPES = Symbol.for("pi-chassis/plainMessageTypes");
const OWNER = "pi-retainer";

type Theme = { fg(color: string, text: string): string };
type Result = { content?: Array<{ type: string; text?: string }>; details?: any };
type G = Record<symbol, unknown>;

interface ChassisRegistry {
	apiVersion?: number;
	register?: (pi: unknown, spec: unknown, ctx?: unknown) => { refresh(): void; dispose(): void };
	toolRowsVersion?: number;
	registerToolRows?: (specs: Record<string, unknown>, options?: { id?: string }) => () => void;
}

function registry(g: object): ChassisRegistry | undefined {
	return (g as G)[REGISTRY] as ChassisRegistry | undefined;
}

/** True when pi-chassis has installed its registry (checked when needed, so load order does not matter). */
export function chassisLoaded(g: object = globalThis): boolean {
	return typeof registry(g)?.register === "function";
}

const oneLine = (s: unknown, n: number) => {
	const t = String(s ?? "").replace(/\s+/g, " ").trim();
	return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const textOf = (r: Result) => (r.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : "")).join("\n");
const firstLine = (r: Result) => oneLine(textOf(r).split("\n")[0], 120);
const expandText = (r: Result, t: Theme) => textOf(r).replace(/\s+$/, "").split("\n").map((l) => t.fg("toolOutput", l));
const errorLine = (r: Result, t: Theme) => t.fg("error", firstLine(r) || "failed");
const idList = (ids: unknown) => (Array.isArray(ids) ? ids.map((i) => `#${Number(i)}`).join(" ") : "");

/** chassis row specs for the memory tools. chassis sanitizes everything these return. */
export function toolRowSpecs(): Record<string, unknown> {
	return {
		memory_write: {
			icon: MEMORY_ICON,
			title: "Remember",
			describe: (a: any, _cwd: string, t: Theme) => `${t.fg("muted", oneLine(a?.kind ?? "memory", 20))}${a?.global ? t.fg("dim", " global") : ""} ${t.fg("text", oneLine(a?.text, 70))}`,
			summarize: (r: Result, _a: any, t: Theme, err: boolean) => {
				if (err) return errorLine(r, t);
				const id = r.details?.id;
				const warn = r.details?.long ? t.fg("warning", " long") : "";
				return id === undefined ? t.fg("success", "saved") : `${t.fg("success", `#${Number(id)}`)}${t.fg("dim", r.details?.deduplicated ? " refreshed" : " saved")}${warn}`;
			},
			expand: expandText,
		},
		memory_update: {
			icon: MEMORY_ICON,
			title: "Revise",
			describe: (a: any, _cwd: string, t: Theme) => `${t.fg("muted", a?.id !== undefined ? `#${Number(a.id)}` : "memory")}${a?.text ? ` ${t.fg("text", oneLine(a.text, 70))}` : ""}`,
			summarize: (r: Result, _a: any, t: Theme, err: boolean) => (err ? errorLine(r, t) : `${t.fg("success", "updated")}${r.details?.long ? t.fg("warning", " long") : ""}`),
			expand: expandText,
		},
		memory_forget: {
			icon: MEMORY_ICON,
			title: "Forget",
			describe: (a: any, _cwd: string, t: Theme) => `${t.fg("muted", a?.id !== undefined ? `#${Number(a.id)}` : "memory")}${a?.reason ? ` ${t.fg("text", oneLine(a.reason, 70))}` : ""}`,
			summarize: (r: Result, _a: any, t: Theme, err: boolean) => (err ? errorLine(r, t) : r.details?.deleted ? t.fg("success", "deleted") : t.fg("warning", "kept")),
			expand: expandText,
		},
		memory_search: {
			icon: MEMORY_ICON,
			title: "Recall",
			describe: (a: any, _cwd: string, t: Theme) => {
				const q = a?.query ? t.fg("text", JSON.stringify(oneLine(a.query, 50))) : t.fg("muted", "recent");
				const kinds = Array.isArray(a?.kinds) && a.kinds.length ? t.fg("dim", ` ${oneLine(a.kinds.join(", "), 40)}`) : "";
				return q + kinds;
			},
			summarize: (r: Result, _a: any, t: Theme, err: boolean) => {
				if (err) return errorLine(r, t);
				const n = Number(r.details?.count ?? 0);
				return t.fg("dim", `${n} ${n === 1 ? "memory" : "memories"}`);
			},
			expand: expandText,
		},
		memory_get: {
			icon: MEMORY_ICON,
			title: "Read memory",
			describe: (a: any, _cwd: string, t: Theme) => t.fg("muted", oneLine(idList(a?.ids), 60) || "memory"),
			summarize: (r: Result, _a: any, t: Theme, err: boolean) => {
				if (err) return errorLine(r, t);
				const n = Number(r.details?.count ?? 0);
				return t.fg("dim", `${n} ${n === 1 ? "memory" : "memories"}`);
			},
			expand: expandText,
		},
	};
}

/**
 * Offer the tool rows to chassis: straight away if it is loaded, otherwise through its pending queue.
 * Returns a remover. Safe to call again (on every load): the owner id makes chassis replace the
 * previous group.
 */
export function offerToolRows(g: object = globalThis): () => void {
	const specs = toolRowSpecs();
	const reg = registry(g);
	if (typeof reg?.registerToolRows === "function" && (reg.toolRowsVersion ?? 0) >= 1) {
		return reg.registerToolRows(specs, { id: OWNER });
	}
	const any = g as G;
	const queue = (any[PENDING_TOOL_ROWS] ??= []) as Array<{ specs: unknown; id?: string; attach(remove: () => void): void }>;
	// Replace an entry queued by an earlier load of this extension.
	for (let i = queue.length - 1; i >= 0; i--) if (queue[i]?.id === OWNER) queue.splice(i, 1);
	let remove: (() => void) | undefined;
	let removed = false;
	const entry = {
		specs,
		id: OWNER,
		attach(r: () => void) {
			remove = r;
			if (removed) r();
		},
	};
	queue.push(entry);
	return () => {
		removed = true;
		const i = queue.indexOf(entry);
		if (i >= 0) queue.splice(i, 1);
		remove?.();
	};
}

/** Ask chassis to draw "memory-recall" as a plain row (no panel). Creates the shared set if chassis has not. */
export function markPlainMessage(type: string, g: object = globalThis): void {
	const any = g as G;
	if (!(any[PLAIN_TYPES] instanceof Set)) any[PLAIN_TYPES] = new Set<string>();
	(any[PLAIN_TYPES] as Set<string>).add(type);
}

/** What the sidebar section shows. Kept by index.ts and read on each draw. */
export interface SidebarState {
	recalled: number;
	total: number;
	chars: number;
	budget: number;
}

/**
 * Register the sidebar section with chassis, if it is loaded. Call from session_start with its ctx.
 * Returns the handle (refresh after a change), or undefined without chassis.
 */
export function registerSidebar(
	pi: unknown,
	ctx: unknown,
	state: () => SidebarState,
	g: object = globalThis,
): { refresh(): void; dispose(): void } | undefined {
	const reg = registry(g);
	if (typeof reg?.register !== "function" || (reg.apiVersion ?? 0) < 1) return undefined;
	const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));
	return reg.register(
		pi,
		{
			id: "pi-retainer",
			title: "Memory",
			icon: MEMORY_ICON,
			slots: ["sidebar"],
			sidebar: "section",
			order: 60,
			cacheKey: () => {
				const s = state();
				return `${s.recalled}|${s.total}|${s.chars}|${s.budget}`;
			},
			render: () => {
				const s = state();
				if (s.total === 0) return { text: "none yet", color: "muted" };
				return { text: `${s.recalled}/${s.total} · ${k(s.chars)}/${k(s.budget)}`, color: "muted" };
			},
		},
		ctx,
	);
}
