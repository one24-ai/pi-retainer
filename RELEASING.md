# Releasing pi-retainer

Every release is a commit on `main` with a `vX.Y.Z` tag, built and published by CI from that tag. Nothing is published from a laptop.

## Once

On npmjs.com, add a trusted publisher for `pi-retainer`: repository `one24-ai/pi-retainer`, workflow `release.yml`, environment `npm`. In the GitHub repository, create the `npm` environment (Settings, Environments). No npm token is stored anywhere.

The first version has to exist before a trusted publisher can be added, so publish the first version once by hand from a clean checkout of the tag (`npm publish`, signed in with `npm login`), then add the trusted publisher and use CI from the next release on.

## Each release

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under a new `## [X.Y.Z]` heading and update the links at the bottom.
2. Set `version` in `package.json` to `X.Y.Z`.
3. `pnpm check`, commit ("Release X.Y.Z"), tag `vX.Y.Z`, push the commit and the tag.
4. CI checks that the tag matches `package.json`, runs `pnpm check`, publishes pi-retainer and the pi-domain bridge to npm with provenance and creates the GitHub release from the changelog section.

## The rename from pi-domain (one time)

pi-retainer was published as pi-domain up to 0.3.0. The first pi-retainer release needs these steps once, in this order:

1. Rename the repository on GitHub from `one24-ai/pi-domain` to `one24-ai/pi-retainer` (Settings, General). GitHub redirects the old URLs.
2. Cut the release as usual (steps 1 to 3 above, version `0.4.0`), but do not push the tag yet.
3. Publish pi-retainer by hand from the release commit, because npm only lets a trusted publisher be added to a package that already exists: `pnpm install --frozen-lockfile && npm publish`.
4. On npmjs.com, add the trusted publisher to `pi-retainer` (repository `one24-ai/pi-retainer`, workflow `release.yml`, environment `npm`), and change the repository on `pi-domain`'s trusted publisher to `one24-ai/pi-retainer`.
5. Push the tag. The workflow sees pi-retainer is already published, skips it, and publishes the `pi-domain` bridge of the same version (see `compat/pi-domain` and `scripts/build-domain-bridge.mjs`).
6. Mark the old name: `npm deprecate pi-domain "pi-domain is now pi-retainer: pi install npm:pi-retainer"`.

From then on every release publishes both pi-retainer and the pi-domain bridge. To stop updating the bridge, delete the "Publish the pi-domain bridge" step from `release.yml`.
