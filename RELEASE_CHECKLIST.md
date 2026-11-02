# Release Checklist

`package.json` `version` is the CLI version. Runtime displays read it through `src/core/version.js`.

The line merged from `dev-20261031` is **0.10.0**. npm already has `codemini-cli@0.9.5`, so this release cannot be published as 0.9.5 again. 0.10.0 is a minor bump for the feature delta since `main` plus the desktop installer channel.

## Bump Version

```bash
npm run bump:patch
```

For larger releases:

```bash
npm run bump:minor
npm run bump:major
```

These commands update `package.json` and `package-lock.json` and do not create a git tag.

## Verify the CLI package

```bash
node bin/coder.js --version
npm test
node scripts/check-pack-imports.mjs
npm pack --dry-run
```

Before publishing, confirm the dry-run tarball includes:

- `codemini-web/shared/**`
- `codemini-web/client/src/lib/plan-ui-state.js`
- `codemini-web/dist/index.html`

## Publish to npm

This repo does not contain `NPM_TOKEN`. Do not invent one, and do not put a token in git or on a command line that lands in a log.

### Local publish

From the release commit, after the checks above:

```bash
npm whoami
npm publish --access public
```

Token in the environment, without writing it into `package.json`:

```bash
npm config set //registry.npmjs.org/:_authToken "${NPM_TOKEN}"
npm publish --access public
npm config delete //registry.npmjs.org/:_authToken
```

PowerShell:

```powershell
npm config set "//registry.npmjs.org/:_authToken" "$env:NPM_TOKEN"
npm publish --access public
npm config delete "//registry.npmjs.org/:_authToken"
```

The npm user or automation token needs publish access to `codemini-cli`. The package `publishConfig.access` is already `public`.

### GitHub Actions

`.github/workflows/npm-publish.yml` is `workflow_dispatch` only. A desktop tag does not publish to npm.

1. Create an npm Automation token that can publish `codemini-cli`.
2. Add it as the repository secret `NPM_TOKEN`.
3. Run the **Publish npm** workflow on the release commit.

If `NPM_TOKEN` is missing, the workflow stops with that message and does not call the registry.

## Desktop GitHub Release

See [DESKTOP.md](./DESKTOP.md).

1. Merge the release commit to `main`. Do not force-push `main`.
2. Tag that commit `v` plus the `package.json` version, for example `v0.10.0`.
3. `git push origin v0.10.0`.

`.github/workflows/desktop-release.yml` builds four installers and attaches them to the GitHub Release: Windows NSIS Setup x64, Windows NSIS Setup ARM64, macOS DMG Apple Silicon, and macOS DMG Intel x64. The workflow refuses a tag that does not match `package.json`. Asset names are listed in [DESKTOP.md](./DESKTOP.md).

Mac and Windows builds are unsigned until the signing secrets in `DESKTOP.md` are added.
