# Release Workflow (GitHub Releases + Electron Auto-Update)

This repo has Electron auto-update wired in the main process:

- `src/main/updates.ts` — standalone auto-updater module
- `src/main/main.ts` — imports and initializes auto-updates

The key release requirement is: publish correct update metadata (`latest*.yml`) that matches the final signed artifacts.

## One-time setup

1. Keep GitHub publish config in `electron-builder.json`:
   - `publish.provider=github`
   - `owner=45Drives`
   - `repo=houston-client-manager`
2. Ensure every release build uses the same `package.json` version on all machines.
3. Install GitHub CLI (`gh`) on your Linux control machine and authenticate:
   - `gh auth login`
4. Use a single release tag format for all platforms:
   - `v<package.version>` (example: `v1.2.0`)
5. Copy orchestrator env template and fill values:
   - `cp scripts/release/.env.orchestrator.example scripts/release/.env.orchestrator`

## Important metadata rules

1. Windows updater uses `latest.yml`.
2. macOS updater uses `latest-mac.yml`.
3. Linux updater uses `latest-linux.yml`.
4. If you sign/notarize after packaging, regenerate YAML after signing.
5. YAML `sha512` and `size` must match the exact uploaded artifact bytes.
6. `url` values in YAML must match the uploaded asset file names exactly.

## Per-release procedure

### 1. Prepare version and draft release

1. Update `package.json` version (example `1.2.1`).
2. Commit the version bump.
3. From Linux control machine, create a draft GitHub release:
   - `gh release create v1.2.1 --draft --title "v1.2.1" --notes ""`

Keep it draft until all platform assets and metadata are uploaded.

### 2. Build Linux artifacts (control machine)

1. Run Linux packaging:
   - `yarn build:linux`
2. Collect from `dist/`:
   - Linux packages (`.deb`, `.rpm`)
   - `latest-linux.yml`

If Linux artifacts are not post-signed, the generated `latest-linux.yml` is usually already correct.

### 3. Build + sign Windows artifacts (Windows path)

1. Build Windows installer on Windows build machine (`yarn build:win`).
2. Sign final `.exe` with your external signing tool.
3. Regenerate `latest.yml` from the final signed `.exe` using this repo helper:
   - `yarn release:gen-yml --version 1.2.1 --output /path/to/latest.yml --file /path/to/45Drives-Setup-Wizard-1.2.1-win-x64.exe`
4. Copy signed `.exe` and `latest.yml` back to Linux control machine.

### 4. Build + sign macOS artifacts (ARM build -> Intel sign path)

1. Trigger ARM build and Intel signing flow (your existing scripts):
   - `scripts/release-mac-build.sh`
2. On Intel signer output folder, gather:
   - Signed/notarized `.zip` (required for updater)
   - Signed/notarized `.dmg` (optional for updater, useful for manual downloads)
3. Generate `latest-mac.yml` from final signed outputs:
   - `yarn release:gen-yml --version 1.2.1 --output /path/to/latest-mac.yml --path 45Drives-Setup-Wizard-1.2.1-mac.zip --file /path/to/45Drives-Setup-Wizard-1.2.1-mac.zip --file /path/to/45Drives-Setup-Wizard-1.2.1-mac.dmg`
4. Copy `.zip`, `.dmg`, and `latest-mac.yml` back to Linux control machine.

### 5. Upload all release assets to the same draft

From Linux control machine:

1. Upload Windows assets:
   - Signed `.exe`
   - `latest.yml`
2. Upload macOS assets:
   - `.zip`
   - `.dmg`
   - `latest-mac.yml`
3. Upload Linux assets:
   - `.deb`, `.rpm`
   - `latest-linux.yml`

Example:

```bash
gh release upload v1.2.1 \
  ./release-assets/v1.2.1/* \
  --clobber
```

### 6. Publish release

1. Verify release contains:
   - `latest.yml`
   - `latest-mac.yml`
   - `latest-linux.yml`
   - Matching platform binaries
2. Publish draft:
   - `gh release edit v1.2.1 --draft=false`

## One-command orchestration

The repo now includes:

- `scripts/release/orchestrate-release.sh`
- `scripts/release/.env.orchestrator.example`
- `yarn release:orchestrate`
- `yarn release:win:stage`
- `yarn release:win:finalize`

Run:

```bash
yarn release:orchestrate
```

Or with a custom env path:

```bash
yarn release:orchestrate -- /absolute/path/to/.env.orchestrator
```

For the Windows two-host flow in env:

1. Build host variables: `WIN_BUILD_HOST`, `WIN_BUILD_USER`, `WIN_BUILD_GIT_PULL_CMD`, `WIN_BUILD_CMD`, `WIN_BUILD_DIST_DIR`.
2. To prevent build-host signing attempts, keep `WIN_BUILD_DISABLE_SIGN=1`.
3. Sign host variables: `WIN_SIGN_WIN_DIR`.
4. Use `WIN_PHASE=stage` to stop after uploading unsigned EXE for manual GUI signing.
5. After manual signing, rerun with `WIN_PHASE=finalize` to fetch signed EXE and generate `latest.yml`.

Convenience wrappers (no env editing required during stage/finalize):

```bash
yarn release:win:stage
# sign manually on Windows sign host (GUI PIN prompt)
yarn release:win:finalize
```

The orchestrator can:

1. Build Linux locally.
2. SSH into Windows build host, run `git pull` + build, pull unsigned EXE.
3. Push unsigned EXE to Windows sign host folder, pause for manual signing, then fetch signed EXE.
4. SSH into ARM Mac, trigger `scripts/release-mac-build.sh`, pull final signed mac artifacts from Intel signer host.
5. Regenerate `latest.yml` and `latest-mac.yml` from final signed files.
6. Optionally create/upload/publish GitHub Releases via `gh`.

## Recommended automation structure (controller model)

Use Linux machine as release orchestrator:

1. Build Linux locally.
2. SSH to Windows VM to build/sign, then rsync back signed `.exe`.
3. SSH to ARM Mac to build; ARM script SSHes Intel signer; rsync signed artifacts back.
4. Regenerate Windows/mac YAML on Linux with `yarn release:gen-yml`.
5. Upload everything with `gh release upload`.
6. Publish draft only when complete.

This avoids partial live releases and keeps one source of truth for uploaded assets.

## Validation checklist before publishing

1. Installed app version < release version.
2. App checks update successfully on each platform.
3. Windows download + install works from `latest.yml`.
4. macOS download + install works from `latest-mac.yml` (zip path).
5. Linux update behavior validated on target distros for your package format.

## Fast path: publish from prebuilt signed artifacts

If all final signed artifacts are already in one folder (example `/builds/release`), use:

```bash
RELEASE_DIR=/builds/release \
RELEASE_VERSION=1.2.1 \
RELEASE_TAG=v1.2.1 \
GH_REPO=45Drives/houston-client-manager \
GH_CREATE_DRAFT=1 \
GH_UPLOAD_RELEASE=1 \
GH_PUBLISH_RELEASE=0 \
yarn release:publish-from-builds
```

You can also pass an env file:

```bash
yarn release:publish-from-builds -- /absolute/path/to/.env.release-publish
```

The script also supports selecting platforms:

- `PUBLISH_WINDOWS=1|0`
- `PUBLISH_MAC=1|0`
- `PUBLISH_LINUX=1|0`
