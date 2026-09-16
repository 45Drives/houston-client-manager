# Development Environment Setup

How to get `houston-client-manager` (45Drives Storage Wizard) running from a clean machine.

---

## 1. Prerequisites

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | 20.x or 22.x LTS | Electron 32 targets Node 20+. Use `nvm` if you juggle versions. |
| **Yarn** | 4.6.0 | Pinned via `packageManager` in `package.json`. Enable with Corepack — do **not** `npm i -g yarn`. |
| **Git** | 2.30+ | Needs submodule support. |
| **Python 3** + build toolchain | — | Only needed if a native module has to compile (`ssh2` ships prebuilds, so usually not). |

Enable Corepack so the pinned Yarn version is used:

```bash
corepack enable
corepack prepare yarn@4.6.0 --activate
yarn --version   # should print 4.6.0
```

### Linux extras

Electron needs a few shared libs that most desktop distros already have. On a headless/minimal box:

```bash
# Debian / Ubuntu
sudo apt install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgtk-3-0 libgbm1 libasound2

# Rocky / RHEL / Fedora
sudo dnf install -y nss atk at-spi2-atk cups-libs gtk3 mesa-libgbm alsa-lib
```

### macOS extras

Xcode Command Line Tools: `xcode-select --install`.

### Windows extras

Use PowerShell (not Git Bash) for `yarn dev`. Install Node via the official MSI or `winget install OpenJS.NodeJS.LTS`.

---

## 2. Clone the repo and the `houston-common` submodule

The app depends on `@45drives/houston-common-lib`, `-ui`, and `-css`, which live in the [`houston-common`](https://github.com/45Drives/houston-common) submodule and are consumed as Yarn workspaces. **The build will fail without it.**

```bash
git clone git@github.com:45Drives/houston-client-manager.git
cd houston-client-manager

git submodule update --init --recursive
```

The submodule URL is SSH (`git@github.com:45Drives/houston-common.git`), so you need a GitHub SSH key configured. If you only have HTTPS access:

```bash
git config --global url."https://github.com/".insteadOf git@github.com:
git submodule update --init --recursive
```

The submodule is checked out at a pinned commit (detached HEAD). To track `main` for active development:

```bash
git -C houston-common checkout main
git -C houston-common pull --ff-only
```

> `houston-common` is shared across `cockpit-super-simple-setup`, `cockpit-scheduler`, and this repo. Edit it in **one** place and push/pull to sync the others.

---

## 3. Install dependencies

```bash
yarn install
```

Notes:

- `yarn.lock` is **gitignored** in this repo, so a fresh clone resolves dependencies from scratch. Expect a slow first install.
- The root `package.json` declares `workspaces: ["houston-common/houston-common-*"]`, so the three common packages are symlinked into the root `node_modules` automatically. Never `yarn install` inside `houston-common` separately.
- `nodeLinker: node-modules` is set in `.yarnrc.yml` — this is a classic `node_modules` layout, not PnP.

If dependency state gets wedged, there is a nuke-and-pave script:

```bash
bash rebuild.sh
```

---

## 4. Run the app

```bash
yarn dev
```

That chains three steps:

1. `yarn build:common` — builds `houston-common-css`, `-lib`, and `-ui` into their `dist/` folders.
2. `yarn build:easysetup` — esbuild-bundles the EasySetup CLI into `src/main/static/easysetup-bundle.js` (uploaded to servers over SSH at runtime).
3. `node scripts/dev-server.js` — starts the Vite renderer dev server, compiles `src/main` with `tsc`, and launches Electron with file watching.

Useful details:

- Dev user data lives in `.electron-dev-userdata/` (gitignored), so dev state is isolated from your installed production app. Logs land in `.electron-dev-userdata/logs`.
- The main process listens on `--inspect=9230` — attach the VS Code Node debugger there.
- Vite picks a free port automatically (it starts at 8080) and passes it via `ELECTRON_RENDERER_PORT`.
- Edits under `src/main` restart Electron; renderer edits hot-reload.
- After changing anything in `houston-common`, re-run `yarn build:common` (or restart `yarn dev`) — the app consumes the built `dist/`, not the source.

### macOS only: backup daemon

Local scheduled backups on macOS go through a privileged helper daemon. Install it once before developing that area:

```bash
yarn dev:mac            # installs the daemon (sudo prompt), then runs dev
yarn dev:mac:daemon:status   # check daemon health
```

---

## 5. Tests

```bash
yarn test        # vitest, unit tests
yarn test:int    # integration tests (*.int.test.ts)
```

The platform build scripts (`build:win`, `build:mac`, `build:linux`) run `yarn test` automatically and will abort the build on failure.

---

## 6. Local packaging (no signing)

To produce an installer for your own platform:

```bash
yarn build:linux     # .deb / .rpm / .pacman
yarn build:win       # .exe (run on Windows)
yarn build:mac       # .dmg / .zip (run on macOS)
```

Output lands in `dist/`. Packaging is driven by `electron-builder.json`; artifacts are named `${productName}-${version}-${os}-${arch}.${ext}`.

For a fast unsigned macOS app bundle (no installer, no notarization):

```bash
yarn mac:dir:arm64      # or mac:dir:x64 / mac:dir:universal
```

These set `CSC_IDENTITY_AUTO_DISCOVERY=false` and `SKIP_AFTER_SIGN=1` so no certificates are required.

To build Linux `.rpm` targets you need `rpm`/`rpmbuild` installed locally; `.deb` needs `dpkg`/`fakeroot`.

---

## 7. Release environment configuration

Real releases are orchestrated from a Linux control machine that drives a remote Windows build/sign host and a mac ARM build host → Intel sign host chain. **You do not need any of this to run `yarn dev`** — skip this section unless you are cutting a release.

Two env files are required, both gitignored. Only the `.example` templates are committed.

```bash
cp scripts/release/.env.orchestrator.example scripts/release/.env.orchestrator
cp scripts/.env.release.example scripts/.env.release
```

### `scripts/release/.env.orchestrator` (Linux control machine)

Drives the whole multi-platform release. Fill in values for the pieces you actually use:

| Group | Keys | Purpose |
|---|---|---|
| General | `RELEASE_TAG`, `RELEASE_STAGING_DIR`, `RELEASE_BUILDS_DIR`, `RELEASE_ONLY` | Tag format (`v__VERSION__`) and where artifacts are collected. Version is always read from `package.json`. |
| Linux | `RUN_LINUX_BUILD`, `LINUX_BUILD_CMD`, `LINUX_GIT_PULL_CMD`, `LINUX_CLEAN_OUTPUTS` | Local build on the control machine. |
| Windows | `RUN_WINDOWS_BUILD`, `WIN_PHASE`, `WIN_BUILD_HOST`, `WIN_BUILD_USER`, `WIN_BUILD_PASSWORD`, `WIN_BUILD_MODE`, `WIN_BUILD_REMOTE_DIR`, `WIN_SAMBA_*` | Remote Windows build over SSH; artifacts move through a Samba share for manual GUI code signing. `WIN_PHASE=stage` builds and uploads unsigned, `finalize` fetches the signed `.exe` back. |
| macOS | `RUN_MAC_BUILD`, `MAC_ARM_HOST`, `MAC_ARM_USER`, `MAC_ARM_PORT`, `MAC_ARM_REPO_DIR`, `MAC_RELEASE_ENV_LOCAL`, `MAC_RELEASE_ENV_REMOTE` | ARM Mac builds, then hands off to the Intel signer. |

### `scripts/.env.release` (macOS signing host)

Apple signing/notarization settings, consumed by `scripts/release-mac-build.sh` and `scripts/sign-mac-on-intel.sh`:

`APP_PRODUCT_FILENAME`, `ENTITLEMENTS_FILE`, `CODESIGN_IDENTITY`, `INSTALLER_IDENTITY`, `NOTARY_PROFILE`, `SIGN_INBOX`, `SIGN_OUTPUT_DIR`, `MAC_BUILD_KIND`, `SIGN_HOST`, `SIGN_USER`, `SIGN_KEYCHAIN`, `SIGN_KEYCHAIN_PASSWORD`, `SYNC_SIGNED_BACK_TO_ARM`, `ARM_SIGNED_OUTPUT_DIR`.

> Secrets note: `.env`/`.env*` are gitignored — keep certificates, keychain passwords, notary profiles, and host credentials out of the repo. Apple notarization credentials should live in a keychain notary profile (`xcrun notarytool store-credentials`) referenced by name via `NOTARY_PROFILE`, not pasted into the env file. GitHub publishing uses the `gh` CLI's own auth, so no token belongs in these files either.

### GitHub CLI

Releases are published with `gh`, which must be installed and authenticated on the control machine:

```bash
gh auth login
gh auth status
```

`electron-builder.json` points `publish` at `provider=github`, `owner=45Drives`, `repo=houston-client-manager` — the same source the in-app auto-updater reads.

### Other release-machine requirements

The orchestrator shells out to `bash`, `ssh`, `scp`, `rsync`, `node`, `yarn`, and `git`, and calls `require_cmd sshpass` if any build host is configured with a password instead of an SSH key. The Windows signing share must be mounted before a Windows run. A full host/credential checklist is in the release console's `docs/SETUP.md`.

### Running a release

```bash
yarn release:patch      # bump patch, build all platforms
yarn release:minor
yarn release:major
yarn release:quick      # no bump, build all
yarn release:linux
yarn release:windows:stage      # build + upload unsigned for GUI signing
yarn release:windows:finalize   # fetch signed artifacts back
bash scripts/release/release.sh --help
```

### GUI alternative: the release console

[`electron-release-console`](https://github.com/45Drives/electron-release-console) is a small
Tk app that composes and runs the exact same `orchestrate-release.sh` invocation, with
preflight checks, a `.env.orchestrator` editor, and run history. Setup instructions for a new
workstation are in that repo's `docs/SETUP.md`. It has the same credential requirements as
running the scripts by hand.

---

## 8. Testing against a server

The app is a client for Cockpit modules that run on a 45Drives server (Super Simple Setup, Task Scheduler, WireShield). To exercise setup, backups, or restore end to end you need a reachable server on your network — either real hardware or a VM running Cockpit on port 9090. The app's discovery scan looks for open port 9090 on the local subnet, and you can always enter an IP manually if mDNS is blocked.

Never hard-code server IPs or credentials into committed code or config.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find module '@45drives/houston-common-lib'` | Submodule missing or not built: `git submodule update --init --recursive && yarn build:common`. |
| Yarn refuses to run / wrong version | `corepack enable && corepack prepare yarn@4.6.0 --activate`. |
| Stale UI after editing `houston-common` | Re-run `yarn build:common`. |
| Dependency tree corrupted | `bash rebuild.sh`. |
| Electron won't launch on Linux | Install the shared libs listed in Prerequisites. |
| Weird persisted app state in dev | Delete `.electron-dev-userdata/`. |
| TypeScript errors block Electron start | `yarn dev` prints them; the main process won't start until `src/main` compiles. |
