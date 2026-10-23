# Changelog

All notable changes to pi-retainer (published under an earlier name before 0.4.0) are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

## [0.8.0] - 2026-10-23

### Removed

- **Breaking:** the database location, settings file, environment variables and snapshot names of the package's earlier name are no longer read or migrated, so data that was never moved is not found. Move it to the current location first: the database to `$XDG_DATA_HOME/pi-retainer/retainer.db` (else `~/.local/share/pi-retainer/retainer.db`), settings to `pi-retainer.json` in pi's agent directory, snapshots to `backups/` beside the database as `retainer-YYYYMMDD-HHMMSS.db`, and use `PI_RETAINER_DB` and `PI_RETAINER_REPOS`. The compatibility package for the old name is no longer published.

### Changed

- **Breaking:** the pairing with pi-chassis now goes through renamed globals: `Symbol.for('pi-chassis/registry')`, `Symbol.for('pi-chassis/pendingToolRows')` and `Symbol.for('pi-chassis/plainMessageTypes')`. It needs a pi-chassis release that uses them; older pi-chassis versions no longer pair.

## [0.7.0]

### Added

- A `tools.exposure` setting in `pi-retainer.json` (`direct`, `codemode` or `deferred`) sets how the model reaches the memory tools, for example to keep them out of every request when codemode or `tool_search` can find them. The default, `direct`, is unchanged. A change needs a restart: `/reload` keeps tools that were active declared.

### Changed

- **Behaviour change:** `memory_write` guidance no longer invites saving decisions. It asks for gotchas with their cause and says project decisions go in the project's docs, proposed as an edit, the same way standing rules go in the user's instruction file. The `memory_search` hint now says it finds gotchas and facts. The tool text stays under the existing size ceiling.
- **Breaking:** the `memory_write` and `memory_update` schemas offer only the `fact` and `gotcha` kinds, no longer `decision` or `preference`. Existing memories of those kinds are unchanged: they still load in recall and `memory_search` can still filter by them. `/memory-compact` now writes only facts and gotchas: notes split from an older `decision` or `preference` memory become facts, while that memory keeps its kind.

## [0.6.1]

### Changed

- `memory_write` guidance is stricter, to stop over-saving. The tool now tells the model to save only what no file or command would reveal (a gotcha with its cause, a decision with its reason), not progress, versions or things readable from code; to propose an edit to the user's instruction file (such as AGENTS.md) for standing rules instead of saving them; and to search first and use `memory_update` rather than add near-duplicates. The `preference` and `fact` kinds are no longer named in the tool text, though both are still accepted. The tool text stays under the existing size ceiling.
- **Behaviour change:** the pi-chassis sidebar section shows only the recall summary (`17/32 · 3.8K/4.0K`). It no longer lists the memories saved or changed in the session, and clicking no longer opens one.

## [0.6.0]

### Added

- `/memory-compact [ids | project | all]` shortens long memories with the model, in one-off requests outside your conversation (the text goes to your model's provider, not into your session). It states the number of requests, the model, a token estimate and the projects involved, and asks first; `Esc` cancels a run. It checks every answer: the short note and the notes split off must hold every URL, path, command, ticket key, version, date, hash, flag, `#id`, UPPER_CASE and code name, email, port, number with a unit and quoted phrase of the original, each as a whole token, and the answer must be shorter, within the length limit, split into a sensible number of notes, free of secrets and not much longer in total. An answer that fails is refused and left unchanged. It shows one line per memory, lets you read every proposal before and after, takes a snapshot of the database before writing and names it so `/memory-restore` can undo the run, and skips a memory that was edited, moved or deleted while the model worked. A memory and its new notes are saved together or not at all; a note that repeats an existing memory is not written and that memory is not touched. Memories that look like they hold a secret and summaries are never sent. `compact.maxPerRun` and `compact.concurrency` set its limits.

### Changed

- **Behaviour change:** `/memory-tidy` no longer uses the model. It does local cleanup only (move misfiled memories, delete superseded ones, old summaries and near-duplicates), counts memories over `write.warnChars` instead of offering to shorten them, and points at `/memory-compact`. The "Ask agent to merge" and "Ask agent to shorten" choices and the message they sent to the conversation are gone.

## [0.5.0]

### Added

- `memory_write` and `memory_update` refuse text that looks like it holds a secret: a provider key (AWS, GitHub, Slack, OpenAI, Anthropic, Google, npm, Stripe, GitLab), a private key block, a JSON web token, a password in a URL, a bearer value, or an assignment such as `DB_PASSWORD=...`. A value that is a path, a file name or a reference (`password: /run/secrets/db1`) is not refused. The refusal names the kind and does not repeat the text. This is on by default, so a save that used to succeed can now fail; turn it off with `write.checkSecrets: false`.
- `memory_write` names an existing memory in the same project that shares at least half its words, and suggests revising it instead of keeping both. `write.similarity` sets the share; 0 turns it off.

### Fixed

- The request `/memory-tidy` sends to the model now says which project memories are in when it is not the folder's, with the `project` or `in` to pass, so shortening and merging work from any folder.

## [0.4.1]

### Changed

- Published through GitHub Actions with npm trusted publishing and provenance (0.4.0 of pi-retainer was published by hand). No code changes since 0.4.0.

## [0.4.0]

### Changed

- Renamed the package, the repository, the extension folder, the database (`pi-retainer/retainer.db` in the data directory), the settings file (`pi-retainer.json`), snapshot names (`retainer-YYYYMMDD-HHMMSS.db`) and the environment variables (`PI_RETAINER_DB`, `PI_RETAINER_REPOS`).
- Requires pi 1.2. Recall still comes with the first user prompt only: runs another extension starts with a custom message, which pi 1.2 now passes through `before_agent_start`, get no recall. Breaking for pi 1.1 users.

## [0.3.0]

### Changed

- Compaction summaries are no longer saved as memories by default (`summaries.save` now defaults to `false`). A stored summary was a cut-down snapshot of one moment that went stale, and pi already keeps every summary in the session file. Set `summaries.save` to `true` in the settings file to keep the old behaviour. Summaries already saved stay, and `/memory-tidy` still offers to delete old ones. Breaking for anyone relying on the default.

## [0.2.0]

### Added

- An optional `project` argument on `memory_write`, `memory_update`, `memory_search`, `memory_get` and `memory_forget`, for work done from a folder that is not the project (a home folder, a scratch folder). It takes the name of a project that has memories, or a directory; a name that matches nothing is refused with the known projects listed. `memory_update` moves a memory with `project` (or `global`) and reaches one in another project with `in`, never moving it by accident; replies say when a memory was filed outside the folder's project.
- `/memory-tidy` offers to move memories filed under a folder that name exactly one existing project (and no removed or renamed one), or to make them global. `/memory-tidy all` covers every project, and the command starts with a count of what it found and ends with what it did.
- An environment variable (now `PI_RETAINER_REPOS`) sets where `/memory-tidy` looks for repositories (default `~/git`).

### Changed

- The tool definitions grew from about 2,750 to 3,300 characters for the `project` argument.

## [0.1.1]

### Changed

- Published through GitHub Actions with npm trusted publishing and provenance. No code changes since 0.1.0.

## [0.1.0]

First public release.

### Added

- Tools for the model: `memory_write`, `memory_update`, `memory_search`, `memory_get` and `memory_forget` (each deletion confirmed by the user), with read-only and destructive hints for permission extensions.
- Recall: a budgeted index of memories (pinned, related to the first prompt, then recent) sent with the first prompt of a conversation, never repeated by a reload, resume or fork, and sent again after compaction.
- Long memories are shown by their first sentence and length in recall and search; `memory_get` returns them in full.
- Saving text over 600 characters returns a note; `/memory-tidy` suggests shortening long memories.
- Compaction summaries kept as searchable `summary` memories.
- Commands: `/memory`, `/memory-pin`, `/memory-forget`, `/memory-tidy`, `/memory-backup`, `/memory-restore`.
- Daily snapshots at session start, checked before they count.
- Settings in the settings file.
- Optional pi-chassis pairing: tool rows, a plain recall row and a sidebar section, through its globals only.

[Unreleased]: https://github.com/one24-ai/pi-retainer/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/one24-ai/pi-retainer/releases/tag/v0.8.0
