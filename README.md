# pi-retainer

Persistent memory for [pi](https://pi.dev). The model saves decisions, preferences, facts and gotchas as it works; the next session starts with a short index of them, and anything else is a search away. Everything stays in one SQLite file on your machine.

Named after a retainer, the clip that keeps a part in place: it keeps what your sessions learn. pi-retainer was called pi-domain until 0.4.0 (see [Moving from pi-domain](#moving-from-pi-domain)).

Requires pi 1.2 and Node.js 22.19 or later (for `node:sqlite`).

```bash
pi install npm:pi-retainer@0.6.0                        # from npm, pinned
pi install git:github.com/one24-ai/pi-retainer@v0.6.0   # from git, pinned to a tag
pi install /path/to/pi-retainer                         # a local checkout
```

## How it works

**Saving.** The model has five tools:

| Tool | What it does |
|---|---|
| `memory_write` | Save a memory: `decision`, `preference`, `fact`, `gotcha`. Project scope by default, `global` for facts that hold everywhere, `project` for another project's (see below), `pinned` to always recall it. Saving the same text again refreshes it instead of adding a copy. Text over 600 characters gets a note asking for the key point first. |
| `memory_update` | Change a memory by id: text, kind, tags, pin, or move it (`global`, or `project`; `in` reaches a memory in another project). Used instead of piling up corrections. |
| `memory_search` | Full-text search of this project's and global memories. Long ones come back as their first sentence and length. |
| `memory_get` | The full text of memories by id. |
| `memory_forget` | Delete a memory by id. You confirm every deletion; without an interactive UI nothing is deleted. |

**Recall.** With the first prompt of a session, the model gets an index of memories:

```
Memories from earlier sessions (project:my-app and global). Lines ending in [N chars] are shortened: memory_get gives the full text. memory_search finds memories not listed here.

#12 decision, pinned: Use pnpm, never npm or yarn.
#31 gotcha: The integration tests need TZ=UTC; they fail in other time zones.
#40 fact: The deploy has three steps, run in order from the repo root. [1830 chars]

14 more memories not listed; use memory_search.
```

- It fits a character budget (4,000 by default, about 1,000 tokens), lists at most 20 memories, and says how many it left out.
- Order: pinned memories, then memories that share distinctive words with your first prompt, then the most recent.
- A memory up to 300 characters is shown whole. A longer one is shown by its first sentence and its length, so the model can fetch it when it matters.
- Global memories may use half the budget at first, then whatever the project left unused, so a long global list never crowds out the project.
- It is sent once per conversation. Reloading, resuming or forking a session does not add it again. After compaction has summarised it away, the next prompt brings a fresh one.
- Compaction summaries are not saved unless you turn on `summaries.save`, and are never recalled. pi already keeps every summary in the session file (`/resume` brings it back); durable points belong in `memory_write`.

**Scopes.** A memory belongs to the git repository it was saved in (`project:<repo name>`, the directory name outside a repository) or to `global`. A session sees its project and global, nothing else.

**Work for another project.** A session started in a folder that is not the project, such as your home directory, would file everything under that folder. Every tool that reads or writes takes an optional `project`, so the model can say where a memory belongs:

- `project: "kiln"` names a project that already has memories (case does not matter, and `project:kiln` works too).
- `project: "~/git/kiln"` names a directory, which is how a project with no memories yet gets its first one. The scope is that repository's name, exactly as if the session had started inside it. Only the name form is protected against typos: any existing directory can start a scope, and a directory that is not a git repository files under its folder name.
- A name that matches nothing is refused, with the known projects listed, so a typo cannot start a new scope. `global: true` and `project` together are refused too.
- `memory_search` and `memory_get` read from that project, and `memory_update` and `memory_forget` can reach its memories. Without `project`, another project's memories stay out of reach.
- `memory_update` moves a memory only when you say so: `project` is the destination (and `global: true` the other one), and `in` names the project the memory is in now, to reach it from another folder. The reply says where it came from.
- When a memory lands somewhere other than the folder's project, the tool's reply says so.

**Snapshots.** At session start, a snapshot of the database is taken when the newest one is a day old. `/memory-backup` takes one now and `/memory-restore` puts one back (after saving the current state, so a restore can be undone). The newest 20 are kept.

## Commands

| Command | |
|---|---|
| `/memory [words]` | List or search memories, with counts per scope and the size of this session's recall |
| `/memory-pin <id>` | Pin or unpin a memory |
| `/memory-forget <id>` | Delete a memory, after you confirm |
| `/memory-tidy [all]` | Local cleanup, never the model. Steps through a count first, then each suggestion: memories filed under a folder that name a project (move them there, or make them global), memories that say they supersede others, near-duplicates, "Extends #N" notes, and old compaction summaries. You choose for each: move, delete or keep. It covers this project and global; `all` covers every project. Long memories are only counted, with a pointer to `/memory-compact` |
| `/memory-compact [ids \| project \| all]` | Shorten long memories with the model, checked so nothing is lost (see below) |
| `/memory-backup` | Save a checked snapshot now |
| `/memory-restore [name]` | Replace all memories with a snapshot, after you confirm |

## Settings

Optional. Put any of these in `~/.pi/agent/pi-retainer.json` (or `$PI_CODING_AGENT_DIR/pi-retainer.json`). Values are read at session start, checked and clamped; a missing or malformed file means the defaults, with a warning for a malformed one.

```json
{
  "recall": { "maxChars": 4000, "maxItems": 20, "globalShare": 0.5, "inlineChars": 300 },
  "write": { "warnChars": 600, "checkSecrets": true, "similarity": 0.5 },
  "summaries": { "save": false, "maxChars": 4000, "keep": 3 },
  "compact": { "maxPerRun": 25, "concurrency": 3 },
  "backup": { "everyHours": 24, "keep": 20 }
}
```

| Key | Default | |
|---|---|---|
| `recall.maxChars` | 4000 | Size of the recall index, in characters. 0 turns recall off |
| `recall.maxItems` | 20 | Memories listed at most |
| `recall.globalShare` | 0.5 | Share of the budget global memories get before the project has had its turn |
| `recall.inlineChars` | 300 | Memories up to this long are shown whole, in recall and in search results |
| `write.warnChars` | 600 | Saving longer text gets a note, and `/memory-compact` shortens memories over this length. 0 turns the note off, and `/memory-compact` then needs ids |
| `write.checkSecrets` | true | Refuse to save (or revise) text that looks like it holds a secret |
| `write.similarity` | 0.5 | `memory_write` names an existing memory in the same project that shares at least this share of its words. 0 turns it off |
| `summaries.save` | false | Keep compaction summaries as searchable `summary` memories |
| `summaries.maxChars` | 4000 | Longer summaries are cut |
| `summaries.keep` | 3 | `/memory-tidy` suggests deleting older summaries beyond this many per project |
| `compact.maxPerRun` | 25 | Memories `/memory-compact` shortens in one run; it says how many are left |
| `compact.concurrency` | 3 | Requests to the model that run at once |
| `backup.everyHours` | 24 | Hours between automatic snapshots. 0 turns them off |
| `backup.keep` | 20 | Snapshots kept |

The database is `$XDG_DATA_HOME/pi-retainer/retainer.db`, else `~/.local/share/pi-retainer/retainer.db`, with snapshots in `backups/` beside it. `PI_RETAINER_DB=/path/to/file.db` uses another file (its snapshots go beside it too). `/memory-tidy` finds repositories to move memories into under `~/git` (one and two levels down); `PI_RETAINER_REPOS=/path/a:/path/b` looks there instead.

## What it costs

The tools add about 3,300 characters (roughly 800 tokens) to every request: their names, descriptions and parameters (`node --experimental-strip-types scripts/measure-tools.mjs` prints the figure). Recall adds up to `recall.maxChars` once per conversation. Search results are capped at 30 memories and shortened; `memory_get` returns at most 16,000 characters per call.

## Shortening memories

`/memory-compact` shortens memories over `write.warnChars` characters. With no argument it takes the longest ones in this folder's project and global; give ids (`/memory-compact 12 40`), a project name, or `all` to choose. Summaries are never shortened, and a memory that looks like it holds a secret is never sent to the model.

1. **It asks first.** It says how many memories, which model, roughly how many tokens and from which projects, and waits. Nothing has been sent before that. `Esc` stops a run that has started.
2. **Where the text goes.** One request per memory to the model you agreed to, made outside your conversation: nothing is added to your session. The memory text is sent to that model's provider like any request, so `all` or a project name sends memories from those projects to it.
3. **It checks every answer** against its original. The short note and the separate notes the model splits off must together still hold the identifiers of the original: URLs, paths, `commands`, ticket keys, versions, dates, commit hashes, flags, `#ids`, UPPER_CASE and code names, emails, ports, numbers with a unit and quoted phrases. Each must appear as a whole token (`#12` is not satisfied by `#123`). The answer must also be shorter, hold at most six notes (more for a very long memory), stay within the length limit, keep at least 45% of a long text, be no more than 1.5 times the original in total, contain no secret and no long dash. An answer that fails is **refused and left unchanged**.
4. **What the check does not cover.** It checks identifiers and size. It cannot tell whether the meaning survived, whether a name in plain prose was dropped, or whether the model made something up. That is why you can read each proposal (before and after) before anything is written.
5. **Then you decide.** One line per memory (`#12 900c -> 280c + 2 new`, or why one was refused), and the choice to apply all the ready ones, read them one by one first, or cancel. A snapshot of the database is taken before the first write; the notice names it, and `/memory-restore <name>` puts everything back. A memory edited, moved or deleted while the model worked is skipped, not overwritten. Each memory and its new notes are saved together or not at all, and the new notes go in the same project, with the same tags and pin as the memory.

`compact.maxPerRun` (25) caps a run; running it again takes the ones it has not tried yet. `compact.concurrency` (3) is how many requests run at once. If the check refuses an answer you think is fine, shorten that one by hand with `memory_update`; the check has no switch, because silently losing a path is the failure it exists to prevent.

## Checks when saving

`memory_write` and `memory_update` look at the text before it is stored:

- **Secrets.** Text that holds a provider key (AWS, GitHub, Slack, OpenAI, Anthropic, Google, npm, Stripe, GitLab), a private key block, a JSON web token, a password in a URL, a bearer value, or an assignment such as `DB_PASSWORD=...` is refused. The reply names the kind of secret, does not repeat it, and suggests saving where the secret lives instead ("the token is in the keyring under service X"). Placeholders (`${VAR}`, `<token>`), commit hashes, fingerprints, and assignment values that are paths, file names or references (`password: /run/secrets/db1`) are not flagged. It is a safety net, not a guarantee: a secret in an unusual shape passes, and the text has already reached the tool call when it is checked, so a secret that was typed into the chat is still in the session. `write.checkSecrets: false` turns the check off.
- **Near-duplicates.** If a new memory shares at least half its words with one in the same project, any kind, the reply names it and suggests revising that one with `memory_update` and forgetting the new one. Both are kept; it only warns. Exact repeats are still refreshed, not added.

## Privacy

pi-retainer makes no network requests. Memories are stored in the SQLite file above and are sent only to the model you use, as part of the conversation, like anything else in it. Do not ask it to remember secrets. To remove everything, delete the `pi-retainer` data directory (and `pi-domain`, if you used pi-retainer under its old name).

## With pi-chassis

pi-retainer works the same with or without [pi-chassis](https://github.com/one24-ai/pi-chassis), and neither package depends on the other. When pi-chassis is loaded:

- the memory tools are drawn as pi-chassis's one-line rows (`󰧑 Remember fact Use pnpm…   #12 saved`),
- the recall message is one plain row (`󰧑 Recall session memories   17 of 32 memories`), expanding to the index,
- a Memory section in the sidebar shows the recall size (`17/32 · 3.8K/4.0K`: memories listed of those that could be, characters used of the budget) and the memories saved or changed in this session; click one to read it.

Without pi-chassis, pi-retainer draws its own compact tool rows and a boxed recall message, and shows no sidebar. The pairing goes through the documented globals pi-chassis leaves on `globalThis` (see `extensions/retainer/chassis.ts`), so the two can be installed, updated and removed separately.

## Moving from pi-domain

pi-domain is now pi-retainer. Swap the package and nothing else needs to change:

```bash
pi remove npm:pi-domain
pi install npm:pi-retainer
```

- **Your memories stay where they are.** If `pi-domain/domain.db` exists in the data directory and `pi-retainer/retainer.db` does not, pi-retainer keeps using the old file. It is never moved or copied.
- **Settings.** `pi-domain.json` is copied to `pi-retainer.json` once, the first time pi-retainer starts without one. Edit `pi-retainer.json` from then on.
- **Snapshots.** pi-domain's `domain-*.db` snapshots are listed, restored and pruned alongside the new `retainer-*.db` ones.
- **Environment variables.** `PI_DOMAIN_DB` and `PI_DOMAIN_REPOS` still work; `PI_RETAINER_DB` and `PI_RETAINER_REPOS` win when both are set.
- **The old package.** Each release also publishes `pi-domain`, which bundles the same pi-retainer and loads it, so an existing `pi install npm:pi-domain` keeps working. It is deprecated; install one or the other, not both, or the memory tools are registered twice.

## Development

```bash
pnpm install
pnpm check      # tests and type check, against the pi installed on your PATH
```

The tests link the installed pi's packages into `node_modules` (`scripts/link-pi.mjs`) instead of downloading them. Changes go in [CHANGELOG.md](CHANGELOG.md) under `[Unreleased]`; releases are described in [RELEASING.md](RELEASING.md).

## Versioning

[Semantic Versioning](https://semver.org). The public API is the tool names and parameters, the commands, the settings file, the environment variable and the database schema (a schema change comes with a migration). Before 1.0.0, a breaking change bumps the minor version.

## License

MIT
