# Codemini Desktop

The desktop app is an Electron window around the same local Web UI as `codemini web`. It does not replace the npm CLI. Closing the window stops the local server.

Builds are unsigned unless the signing secrets below are configured. `forceCodeSigning` is false, so a machine without certificates still produces installers.

## Local run

```bash
npm install
npm run build:web
npm run desktop:start
```

`npm run desktop:dir` packs an unpacked app for the current OS into `desktop-dist/`.

Pass a project directory when launching the packaged app or `electron .`:

```bash
npm run desktop:start -- --project .
```

The window signs in with the one-time local token created by the Web UI. That token is not the model API key. Server logs are appended to the Electron `userData` directory as `desktop.log`.

## Release artifacts

Pushing a tag `vX.Y.Z` that matches `package.json` runs `.github/workflows/desktop-release.yml`. Each architecture is built on a runner of that architecture. Windows artifacts are NSIS Setup installers, not portable executables. macOS artifacts are DMG images.

| Runner | Script | Release asset for 0.10.0 |
| --- | --- | --- |
| `windows-latest` (x64) | `desktop:dist:win` | `Codemini-Setup-0.10.0-win-x64.exe` |
| `windows-11-arm` | `desktop:dist:win:arm64` | `Codemini-Setup-0.10.0-win-arm64.exe` |
| `macos-latest` (Apple Silicon) | `desktop:dist:mac` | `Codemini-0.10.0-mac-arm64.dmg` |
| `macos-15-intel` | `desktop:dist:mac:x64` | `Codemini-0.10.0-mac-x64.dmg` |

The release job attaches those four files to the GitHub Release for that tag. Download links follow:

```text
https://github.com/havingautism/Codemini-CLI/releases/download/v<version>/<asset>
```

`workflow_dispatch` builds the same artifacts onto the Actions run without creating a Release. Use that to confirm packaging before tagging.

After this branch is merged, tag the `main` commit. Do not force-push `main`. The first tag for this line is `v0.10.0`.

```bash
git checkout main
git pull origin main
git tag v0.10.0
git push origin v0.10.0
```

Later releases: bump `package.json` on a branch, merge that bump, then tag `v` plus the version that landed on `main`.

`windows-11-arm` and `macos-15-intel` are standard GitHub-hosted runners for this public repository (4 vCPU; 16 GB on Windows ARM, 14 GB on Intel Mac). They are not larger runners. `windows-latest` is x64 only, and `macos-latest` is Apple Silicon only, so those two labels cannot produce the other installers. `macos-26-intel` is an alternate Intel image if `macos-15-intel` is retired. Native modules (`sharp`, `node-pty`, `@ast-grep/napi`) are rebuilt on the runner that produces each artifact.

## macOS without a certificate

The workflow sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. With no `CSC_LINK`, electron-builder prints a signing warning and still writes the DMG.

Gatekeeper will block the unsigned app the first time it is opened. A local user can open it with the system prompt (right-click the app, then Open) or clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Codemini.app
```

## What to add for signing and notarization

Repository secrets, not committed files:

| Secret | Use |
| --- | --- |
| `CSC_LINK` | Base64-encoded Apple Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password for that `.p12` |
| `APPLE_ID` | Apple ID that can notarize |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `WIN_CSC_LINK` | Base64-encoded Windows Authenticode `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Password for that `.pfx` |

`CSC_LINK` is used even while keychain auto-discovery stays off. After `CSC_LINK` and the Apple notarization secrets exist, the next macOS release job signs and notarizes. Notarization uses electron-builder's default path; do not set `mac.sign` to `null` or `forceCodeSigning` to `true` until those secrets are in place. `forceCodeSigning: true` fails the build when notarization credentials are missing.

Apple's notarization alternatives are `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` (App Store Connect API key). Use that set or the Apple ID set, not a mixture you have not tested.

Windows signing starts when `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` are set. Until then the `.exe` is unsigned and SmartScreen will warn.

Create the `.p12` / `.pfx` base64 value locally and paste it into the secret. Do not put the certificate in the repository.

```bash
base64 -i developer-id.p12 | pbcopy
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("codesign.pfx")) | Set-Clipboard
```

## npm package

Electron and electron-builder are devDependencies. `npm install -g codemini-cli` does not install the desktop shell. Desktop binaries come from GitHub Releases. Publishing the CLI to npm is a separate step in [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).
