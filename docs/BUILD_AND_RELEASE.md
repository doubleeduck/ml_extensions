# Build, verification and release

This directory is the root of the intended standalone official-source repository.
Its `.github/workflows` become active only when this directory is published as
that repository; they do not publish anything from the current app workspace.
The code/package is **All rights reserved**. Do not substitute an open-source
license without the owner's explicit decision.

## Local development

Use Node 22+, the committed npm lockfile and `npm ci`. Run `npm test` and
`npm run build:host`. In this standalone source repository the SDK output is
only a local development/test artifact. Synchronization into the application
must be explicit and separately reviewed. It is
not bundled in `.mlsource`, and Flutter builds do not invoke npm.

Generate a local Ed25519 key with `tools/pack.mjs --generate-key PATH --key-id ID`.
Keep the private output in `.keys` or another ignored private directory. Build
with `--key PATH --key-id ID --version SEMVER`; output defaults to `dist`.
This local/development key is not an official app trust root. Never upload it.
The same key/payload/version produces byte-identical archives.

The packer verifies ZIP entries, hashes, canonical manifest and Ed25519 signature.
The app must independently verify the archive and publisher ownership. A public
key file beside a download is useful for fingerprint comparison, **not trust**.
The source package contains no Dart/native implementation or runtime Node import.

## Native/app acceptance (required before a release)

The Node fixtures and offline factory probe do not prove live source parity.
In the app repository, run all source fixture/native differential tests, the
full app test/analyzer suite and Android/Windows release builds. Confirm all
29 source IDs, existing library/history/download IDs, private sessions, login/
logout, filters, recommendations, pages, pinned media/downloads/OCR, background
updates, installation/update/rollback/disable/remove and simultaneous search.
Check physical arm64/release and Windows release behavior without clearing or
reinstalling a user's application. Obtain separate device permission when needed.
Record the exact source-repository commit accepted by these checks.

The 2026-10-19 integration passes strict analysis, 1066 Flutter tests (one opt-in
live skip), 104 Node tests. Native Windows tests use the Release LPAC sandbox
and fresh 1.0.0-dev.6 local package. The latest UI changes were not built into
new APK/EXE files; Windows/Android arm64 Release builds cover the earlier engine
integration. A separate live MangaDex RU/EN check covers filters, popular/latest,
details, recommendations, chapter metadata and page URL declarations without
downloading images or using user credentials.
Physical-device and full 29-source live/auth/media acceptance remain outstanding.
Do not treat fixture results as permission to publish a production release.

For manual packaging/publication, follow the Russian step-by-step
[build-package.ps1 release guide](GITHUB_RELEASE_WITH_BUILD_PACKAGE.md).

## Protected GitHub publication

Configure branch protection and the `official-source-release` environment.
Human reviewers are an optional additional gate: when configured, automatic
tag releases wait for approval; the accepted-commit check is always required.
Set its variables `MLSOURCE_PUBLISHER_KEY_ID` and
`ACCEPTED_APP_COMMIT` (the exact accepted 40-character source commit), and secret
`MLSOURCE_SIGNING_KEY_BASE64` (base64 PKCS#8 Ed25519 PEM). Keep the signing key
separate from the repo; back it up under the owner's control. The app needs the
corresponding public trust/ownership record before distributing a release.

Create and push the SemVer Git tag `vVERSION` at that same commit to start the
release automatically. Alternatively dispatch the release workflow on the
accepted ref, supplying `VERSION` without `v`. It reruns the
fixtures, requires the acceptance variable and tag to match `GITHUB_SHA`, then
signs in a private runner temp file. The key is not printed/passed to the child
environment and its temporary file is removed. Only `.mlsource`, public record,
SHA-256 checksum, `extensions-index.json` and its raw 64-byte Ed25519 detached
signature `extensions-index.ed25519` are uploaded with `gh release create --verify-tag`.
Branch pushes and PRs only build development artifacts and never publish a
release. PR workflows never receive the key. See the exact environment variable
setup in [the Russian GitHub Actions guide](GITHUB_ACTIONS_SETUP_RU.md).

Actions are pinned to public official-repository commits verified 2026-10-19:
[checkout](https://github.com/actions/checkout),
[setup-node](https://github.com/actions/setup-node),
[upload-artifact](https://github.com/actions/upload-artifact).
Review/pin updates deliberately. Public release discovery uses the current
[Releases API](https://docs.github.com/en/rest/releases/releases) and
[asset API](https://docs.github.com/en/rest/releases/assets), with the
`2026-03-10` API-version header. GitHub is not a source-auth session store.

## Key rotation, revocation and rollback

Do not replace an existing publisher ID with a different public key. Rotation
requires explicit app-approved ownership/key transition, not a new key supplied
by the package itself. A revoked key must invalidate its packages even if a
version/hash/signature still matches. Never make rollback bypass revocation.
Retain immutable earlier release assets. Fixes increment package SemVer: the
whole pool is an atomic update, while each source retains its separate settings
and sessions. New keys are imported/approved independently; a package publisher
transition requires an additional explicit package review. Revoke the old key
after the transition. If it was already revoked, remove the blocked registration
(not user data), then install the independently verified replacement. Rollback
to a revoked key always fails.

## Repository index v1

`sdk/repository-index.schema.json` fixes the format. Sign canonical JSON with
`MangaLaunch source repository v1\n` as a separate domain; the binary signature
is not JSON/base64. The index includes a single channel, package version/tag/asset
name/size/SHA-256, API/ABI/minimum app version and all source IDs. The app compares
these fields with the independently verified archive before package approval.

Use `tools/sign_repository_index.mjs --repo owner/repo --serial N --tag vVERSION
--package dist/official.mangalaunch.sources.mlsource --key PRIVATE.pem` (one shell
line). Protected CI derives serial from `GITHUB_RUN_NUMBER * 100 + GITHUB_RUN_ATTEMPT`.
It is monotonic per repository; never restart the sequence when moving workflows.
An existing serial cannot designate different bytes. Timestamps are UTC seconds,
validity is 30 days (host maximum 31); publish fresh metadata before expiry.
Already installed packages work offline after index expiry.

The client pins the approved index publisher and serial/digest in host storage.
A new approved key still requires a visible repo key-transition confirmation.
Forgetting a repository does not erase these pins. Missing/invalid signature,
expired metadata or serial rollback is not silently treated as an unsigned repo.
Repositories that have never used a signed index can use manual signed-asset
selection with explicit publisher/grant approval. Local package import remains
an explicit independent path, including the installer's dedicated rollback action.
