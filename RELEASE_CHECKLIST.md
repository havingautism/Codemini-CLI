# Release Checklist

Use the root `package.json` as the single source of truth for the CLI version.

## Bump Version

```bash
npm run bump:patch
```

For larger releases:

```bash
npm run bump:minor
npm run bump:major
```

These commands update both `package.json` and `package-lock.json` without creating a git tag. Runtime version displays are read from `src/core/version.js`, so source files should not need manual version edits.

## Verify

```bash
node bin/coder.js --version
npm test
npm pack --dry-run
```

## Publish

```bash
npm publish
```
