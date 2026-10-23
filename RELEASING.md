# Releasing pi-retainer

Every release is a commit on `main` with a `vX.Y.Z` tag, built and published by CI from that tag. Nothing is published from a laptop.

## Once

On npmjs.com, add a trusted publisher for `pi-retainer`: repository `one24-ai/pi-retainer`, workflow `release.yml`, environment `npm`. In the GitHub repository, create the `npm` environment (Settings, Environments). No npm token is stored anywhere.

If the GitHub repository is ever recreated, save the trusted publisher again on npmjs.com before the next release, or the publish step fails with `ENEEDAUTH`.

## Each release

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z]` heading and update the links at the bottom.
2. Set `version` in `package.json` to `X.Y.Z`.
3. `pnpm check`, commit ("Release X.Y.Z"), tag `vX.Y.Z`, push the commit and the tag.
4. CI checks that the tag matches `package.json`, runs `pnpm check`, publishes pi-retainer to npm with provenance and creates the GitHub release from the changelog section.
