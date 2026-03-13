# Houston Client Manager Release Runbook

This guide is for anyone who needs to run a release without prior project knowledge.

## 1. What This Flow Does

`scripts/release/orchestrate-release.sh` can do all of this:

1. Build Linux artifacts locally.
2. Build/sign/notarize macOS artifacts through the ARM Mac -> Intel signer flow.
3. Build Windows unsigned installer on remote host, pause for manual signing, then finalize.
4. Generate update metadata files:
   - `windows/latest.yml`
   - `mac/latest-mac.yml`
   - `linux/latest-linux.yml`
5. Create/upload/publish a GitHub release draft.
6. Ensure the Git tag exists remotely before GitHub release create/upload.

Release output location is version-scoped:
- `builds/release/<version>/...`

## 2. Prerequisites

Run from repo root:

```bash
cd /path/to/houston-client-manager
```

Required local commands:

```bash
node --version
yarn --version
ssh -V
scp -V
rsync --version
git --version
gh --version
```

If any command is missing, install it first.

`gh` must be authenticated:

```bash
gh auth status
```

## 3. Configure the Orchestrator Env

Main config file:

`scripts/release/.env.orchestrator`

Validate these first:

1. Remote hosts/users/paths for Mac and Windows are correct.
2. `MAC_BUILD_KIND=both` (or your target architecture choice).
3. `RELEASE_STAGING_DIR=./builds/release/__VERSION__`
4. `RELEASE_BUILDS_DIR=./builds/release/__VERSION__`
5. GitHub section:
   - `GH_REPO=45Drives/houston-client-manager`
   - `GH_TITLE="45Drives Storage Wizard v__VERSION__"`
   - `GH_ENSURE_TAG=1`
   - `GH_TAG_REMOTE=origin`
   - `GH_TAG_REF=HEAD`
   - `GH_TAG_MESSAGE=v__VERSION__`

Do not commit secrets in this file.

## 4. Standard Release Flow (Recommended)

First, update version in package.json and then push change to Git Repo.

### Step A: Build Linux + Mac + Windows Stage

This performs Linux and Mac builds and runs Windows in `stage` mode (stops for manual signing):

```bash
GH_CREATE_DRAFT=0 GH_UPLOAD_RELEASE=0 GH_PUBLISH_RELEASE=0 \
bash scripts/release/orchestrate-release.sh scripts/release/.env.orchestrator
```

Expected Windows stage output includes:
- unsigned exe path
- message to manually sign and rerun with `WIN_PHASE=finalize`

### Step B: Manually Sign Windows EXE

On the Windows signing host:

1. Open the unsigned EXE copied into `WIN_SIGN_WIN_DIR`.
2. Sign it using your code-signing process.
3. Leave signed EXE in the same signing directory.

### Step C: Finalize Windows + Upload Release Assets

```bash
RUN_LINUX_BUILD=0 RUN_MAC_BUILD=0 RUN_WINDOWS_BUILD=1 \
WIN_PHASE=finalize \
GH_CREATE_DRAFT=1 GH_UPLOAD_RELEASE=1 GH_PUBLISH_RELEASE=0 \
bash scripts/release/orchestrate-release.sh scripts/release/.env.orchestrator
```

This step:
1. Fetches signed Windows artifacts.
2. Regenerates metadata files.
3. Ensures Git tag exists/pushed.
4. Creates draft release if needed.
5. Uploads all artifacts from `builds/release/<version>/...`.

### Step D: Publish Draft (Optional)

```bash
RUN_LINUX_BUILD=0 RUN_MAC_BUILD=0 RUN_WINDOWS_BUILD=0 \
GH_CREATE_DRAFT=0 GH_UPLOAD_RELEASE=0 GH_PUBLISH_RELEASE=1 \
bash scripts/release/orchestrate-release.sh scripts/release/.env.orchestrator
```

## 5. Useful One-Off Commands

### Upload only (no builds)

```bash
RUN_LINUX_BUILD=0 RUN_MAC_BUILD=0 RUN_WINDOWS_BUILD=0 \
GH_CREATE_DRAFT=0 GH_UPLOAD_RELEASE=1 GH_PUBLISH_RELEASE=0 \
bash scripts/release/orchestrate-release.sh scripts/release/.env.orchestrator
```

### Mac only

```bash
RUN_LINUX_BUILD=0 RUN_MAC_BUILD=1 RUN_WINDOWS_BUILD=0 \
MAC_BUILD_KIND=both \
GH_CREATE_DRAFT=0 GH_UPLOAD_RELEASE=0 GH_PUBLISH_RELEASE=0 \
bash scripts/release/orchestrate-release.sh scripts/release/.env.orchestrator
```

### Linux only

```bash
RUN_LINUX_BUILD=1 RUN_MAC_BUILD=0 RUN_WINDOWS_BUILD=0 \
GH_CREATE_DRAFT=0 GH_UPLOAD_RELEASE=0 GH_PUBLISH_RELEASE=0 \
bash scripts/release/orchestrate-release.sh scripts/release/.env.orchestrator
```

## 6. CLI Flags (Script Arguments)

Supported by `orchestrate-release.sh`:

1. `-e, --env-file <path>`: use a specific env file.
2. `-m, --git-tag-message "<msg>"`: runtime override for `GH_TAG_MESSAGE`.
3. `-n, --release-notes "<notes>"`: runtime override for `GH_NOTES`.
4. `-t, --release-title "<title>"`: runtime override for `GH_TITLE`.
5. `-h, --help`: print usage.

Example:

```bash
bash scripts/release/orchestrate-release.sh \
  --env-file scripts/release/.env.orchestrator \
  --release-title "45Drives Storage Wizard v1.2.0" \
  --git-tag-message "v1.2.0" \
  --release-notes "Bug fixes and release pipeline updates"
```

## 7. Runtime Environment Variable Overrides

You can prefix these before the command to override env file values:

- `RUN_LINUX_BUILD`
- `RUN_MAC_BUILD`
- `RUN_WINDOWS_BUILD`
- `WIN_PHASE`
- `MAC_BUILD_KIND`
- `RELEASE_VERSION` (validated; package.json version still governs release version)
- `RELEASE_TAG`
- `RELEASE_STAGING_DIR`
- `RELEASE_BUILDS_DIR`
- `GH_CREATE_DRAFT`
- `GH_UPLOAD_RELEASE`
- `GH_PUBLISH_RELEASE`
- `GH_TITLE`
- `GH_TAG_MESSAGE`
- `GH_NOTES`

## 8. Troubleshooting

### `gh` network timeout

Error like:
`Post "https://api.github.com/...": dial tcp ... i/o timeout`

Action:
1. Verify network/VPN.
2. Retry upload-only command.

### Windows finalize fetch issues

Ensure signed EXE exists in `WIN_SIGN_WIN_DIR` on Windows host and rerun finalize command.

### Missing assets on release

Assets are uploaded from `builds/release/<version>/...`. Confirm files exist there before upload:

```bash
find "builds/release/$(node -p "require('./package.json').version")" -maxdepth 4 -type f | sort
```

### Wrong release title/notes/tag message

Override with flags:
- `--release-title`
- `--release-notes`
- `--git-tag-message`

## 9. Quick "Do This" Checklist

1. Verify `.env.orchestrator`.
2. Run stage build command (Step A).
3. Manually sign Windows EXE.
4. Run finalize + upload command (Step C).
5. Verify draft assets on GitHub.
6. Publish draft when ready (Step D).

## 10. Optional PDF Conversion

If you have `pandoc` installed on your machine:

```bash
pandoc scripts/release/RELEASE_RUNBOOK.md -o scripts/release/RELEASE_RUNBOOK.pdf
```
