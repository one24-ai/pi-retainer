# Changelog

All notable changes to pi-retainer (called pi-domain until 0.4.0) are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org).

## [Unreleased]

### Changed

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

- Renamed from pi-domain to pi-retainer: the npm package, the repository (one24-ai/pi-retainer), the extension folder (`extensions/retainer`), the database (`pi-retainer/retainer.db` in the data directory), the settings file (`pi-retainer.json`), snapshot names (`retainer-YYYYMMDD-HHMMSS.db`) and the environment variables (`PI_RETAINER_DB`, `PI_RETAINER_REPOS`). Breaking in name only: everything below keeps working. See "Moving from pi-domain" in the README.
- pi-halo is now pi-chassis; the docs and comments use the new name. The pairing still goes through the same globals.
- Requires pi 1.2. Recall still comes with the first user prompt only: runs another extension starts with a custom message, which pi 1.2 now passes through `before_agent_start`, get no recall. Breaking for pi 1.1 users.

### Deprecated

- The pi-domain names. An existing `pi-domain/domain.db` is used where it is until a `pi-retainer/retainer.db` exists (never moved or copied), `pi-domain.json` is copied to `pi-retainer.json` once, `domain-*.db` snapshots are listed, restored and pruned with the new ones, and `PI_DOMAIN_DB` and `PI_DOMAIN_REPOS` still work.
- The `pi-domain` npm package. Each release also publishes it as a bridge that bundles the same version of pi-retainer and loads its extension, so `pi install npm:pi-domain` keeps working. It will be marked deprecated on npm.

## [0.3.0]

### Changed

- Compaction summaries are no longer saved as memories by default (`summaries.save` now defaults to `false`). A stored summary was a cut-down snapshot of one moment that went stale, and pi already keeps every summary in the session file. Set `summaries.save` to `true` in `pi-domain.json` to keep the old behaviour. Summaries already saved stay, and `/memory-tidy` still offers to delete old ones. Breaking for anyone relying on the default.

## [0.2.0]

### Added

- An optional `project` argument on `memory_write`, `memory_update`, `memory_search`, `memory_get` and `memory_forget`, for work done from a folder that is not the project (a home folder, a scratch folder). It takes the name of a project that has memories, or a directory; a name that matches nothing is refused with the known projects listed. `memory_update` moves a memory with `project` (or `global`) and reaches one in another project with `in`, never moving it by accident; replies say when a memory was filed outside the folder's project.
- `/memory-tidy` offers to move memories filed under a folder that name exactly one existing project (and no removed or renamed one), or to make them global. `/memory-tidy all` covers every project, and the command starts with a count of what it found and ends with what it did.
- `PI_DOMAIN_REPOS` sets where `/memory-tidy` looks for repositories (default `~/git`).

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
- Settings in `pi-domain.json`.
- Optional pi-halo pairing: halo tool rows, a plain recall row and a sidebar section, through halo's globals only.

[Unreleased]: https://github.com/one24-ai/pi-retainer/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/one24-ai/pi-retainer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/one24-ai/pi-retainer/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/one24-ai/pi-retainer/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/one24-ai/pi-retainer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/one24-ai/pi-retainer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/one24-ai/pi-retainer/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/one24-ai/pi-retainer/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/one24-ai/pi-retainer/releases/tag/v0.1.0
