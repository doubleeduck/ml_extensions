# Official MangaLaunch source bundle

The complete pool is one separately installed, signed `.mlsource` package with
all 29 persistent source IDs. The app is wired to the dynamic JS registry only:
there is no built-in Dart source fallback. Strict analysis, 1054 app tests
(one opt-in live skip), 100 Node tests and Windows/Android arm64 Release builds
pass as of 2026-10-19. Physical-device and full live-source acceptance remain
separate release gates; offline fixtures are not a 29-source live certification.

Sources are handwritten ES modules; Dart is never compiled into this package.
The app imports `manga_sources/source_contract.dart` (DTOs/interfaces only).
Original Dart parsers remain in the repository behind `legacy_sources.dart`
as test-only parity oracles, outside the production dependency graph.
Shared engines/helpers are included once; source instances never share sessions.

Current parser fixture tests: `node --test tests/*.test.mjs` (Node 22+).
`node:` imports are test-tool dependencies only and must not enter package payload.

Handwritten modules now cover **all 29 existing source IDs**, through shared
LibGroup, GroupLe, MangaDex, Senkuro and Chan engines plus site-specific modules.
The full signed archive independently verifies in the Dart app and all 29 offline
factories probe in the native Windows LPAC sandbox. New HTML/GraphQL ports also
have real host-parser/native fixture parity tests against the preserved Dart
parsers. This is not full live-network/media/auth/migration acceptance.
MyAnimeList still needs the app host's
endpoint-scoped client-ID configuration; no secret/client ID is embedded in JS.
Build the host SDK for native fixture tests with `node tools/build_host_sdk.mjs`.
It supplies the app runtime web primitives, not site parsers, and has no external
runtime imports. See core-js/esbuild upstream documentation linked in the SDK.

The app bundles a generated, trusted copy of the SDK. After SDK changes run
`npm run sync:host`; `npm run check:host` verifies that the checked-in app asset
is reproducible. Flutter builds do not run npm or download a JavaScript engine.

See `../../docs/JS_SOURCE_EXTENSIONS_PROGRESS.md` for integration status and
`../../docs/JS_SOURCE_AUTHORING_TZ.md` for the authoring contract.
For first installation and migration, see
`../../docs/JS_SOURCE_EXTENSIONS_HANDOFF.md`. An empty installed registry is
intentional: source code is not hidden inside the APK/executable. Import the
publisher public record and official package in Settings → Extensions, review
the fingerprint and grants. Library/history/progress/download IDs are unchanged.
The concrete SDK guide is [docs/AUTHORING.md](docs/AUTHORING.md), with
[TypeScript types](sdk/source-api.d.ts), [manifest schema](sdk/manifest.schema.json),
an executable [JSON/API template](templates/json-api/src/index.mjs), and the
generic `tools/pack_extension.mjs` CLI for a separate source project.

## Reproducible local package

```powershell
npm ci
npm test
npm run check:host
node tools/pack.mjs --generate-key .keys/local-development.pem --key-id local-development
node tools/pack.mjs --key .keys/local-development.pem --key-id local-development --version 1.0.0-dev.1
```

The packer collects only the handwritten runtime graph and `LICENSE`; no Dart,
Node dependencies, SDK build tools, private key or tests enter the package.
`src/definitions.mjs` is build-time metadata; `src/index.mjs` is the runtime
dispatcher. The archive uses sorted entries, fixed ZIP timestamps, canonical
manifest JSON, SHA-256 file hashes and deterministic Ed25519 signatures. It is
verified before the `.mlsource`, public-key record and checksum are written.
Repeat the same command/key/version to obtain byte-identical output.

For package-only preparation (no npm install/tests/Flutter build), use
`./build-package.ps1 -KeyPath PRIVATE.pem -KeyId ID -Version SEMVER`.
The step-by-step Russian publisher guide is
[GitHub Release via build-package.ps1](docs/GITHUB_RELEASE_WITH_BUILD_PACKAGE.md).
Optional `-Repository owner/repo -IndexSerial NUMBER` writes a detached signed
release index too. Publish the package, public record, checksum,
`extensions-index.json` and `extensions-index.ed25519` as release assets.
The repository format is [sdk/repository-index.schema.json](sdk/repository-index.schema.json).

The generated local key is **not a release trust root**. Keep it outside Git;
use an owner-controlled protected signing key for publication. The application
must pin/approve a publisher separately: a key distributed beside an archive
does not establish trust. Do not silently trust a package's own public key.

## License

**All rights reserved**, as selected by the owner. See `LICENSE`.
Publishing a repository/release does not grant a license to reuse this code.
The app's QuickJS-NG and host SDK dependencies retain their own licenses and
are not distributed as site code inside this source package.
