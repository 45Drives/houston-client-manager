#!/usr/bin/env bash
#
# Removes Storage Wizard SMB mount leftovers (fstab entries, mount dirs, credential
# files, keychain items) that are NOT currently mounted and NOT referenced by an
# installed backup task.
#
# Usage:
#   ./cleanup-houston-mounts.sh          # dry run - shows what would be removed
#   ./cleanup-houston-mounts.sh --apply  # actually remove
#
set -uo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

OS="$(uname -s)"

# Set HOUSTON_TEST_ROOT to exercise this logic against a sandbox tree instead of
# the live system. Empty in normal use, so every path below resolves under /.
R="${HOUSTON_TEST_ROOT:-}"
FSTAB="${R}/etc/fstab"
MOUNTS="${R}/proc/self/mounts"
SUDO="sudo"
[[ -n "$R" ]] && SUDO=""

say()  { printf '%s\n' "$*"; }
keep() { printf '  KEEP   %-55s %s\n' "$1" "$2"; }
drop() { printf '  REMOVE %-55s %s\n' "$1" "$2"; }

# ---------------------------------------------------------------------------
# Keys referenced by installed backup tasks (parsed out of the cron entries)
# ---------------------------------------------------------------------------
IN_USE=()
while IFS= read -r script; do
  [[ -f "$script" ]] || continue
  d="$(grep -m1 -E "^MOUNT_DIR=" "$script" | cut -d= -f2- | tr -d "'\"")"
  [[ -n "$d" ]] && IN_USE+=("$(basename "$d")")
done < <(
  {
    [[ -z "$R" ]] && crontab -l 2>/dev/null
    cat "$R"/var/spool/cron/crontabs/* "$R"/var/spool/cron/* "$R"/etc/cron.d/* 2>/dev/null
  } | grep -oE '/[^ "]*[Hh]ouston[-_][Bb]ack[Uu]p[-_][Tt]ask[^ "]*\.sh' | sort -u
)

is_in_use() {
  local k="$1"
  for u in "${IN_USE[@]:-}"; do [[ "$u" == "$k" ]] && return 0; done
  return 1
}

# ---------------------------------------------------------------------------
# Desktop "Places" sidebar entries. KDE/GNOME auto-add fstab `user,noauto` lines
# as sidebar devices and keep them cached after the fstab line is gone. Only
# entries whose target directory no longer exists are removed, so anything still
# mounted or still in fstab is untouched by construction.
# ---------------------------------------------------------------------------
cleanup_places() {
  local root="$1"
  local xbel="$HOME/.local/share/user-places.xbel"
  local dead=()

  if [[ -f "$xbel" ]]; then
    while IFS= read -r p; do
      [[ -d "$p" ]] || dead+=("$p")
    done < <(grep -oE "href=\"file://${root}/[^\"]+\"" "$xbel" \
             | sed -e 's|^href="file://||' -e 's|"$||' | sort -u)
  fi

  local gtkdead=()
  for gtk in "$HOME/.config/gtk-3.0/bookmarks" "$HOME/.config/gtk-4.0/bookmarks"; do
    [[ -f "$gtk" ]] || continue
    while IFS= read -r p; do
      [[ -d "$p" ]] || gtkdead+=("$gtk|$p")
    done < <(grep -oE "file://${root}/[^ ]+" "$gtk" | sort -u)
  done

  if (( ${#dead[@]} == 0 && ${#gtkdead[@]} == 0 )); then
    say ""; say "Desktop sidebar (Places): nothing stale."
    return
  fi

  say ""
  say "Desktop sidebar (Places) entries pointing at directories that no longer exist:"
  for p in "${dead[@]:-}";    do [[ -n "$p" ]] && drop "$(basename "$p")" "(KDE Places)"; done
  for e in "${gtkdead[@]:-}"; do [[ -n "$e" ]] && drop "$(basename "${e#*|}")" "(GTK bookmarks)"; done

  (( APPLY == 0 )) && return

  if (( ${#dead[@]} > 0 )); then
    cp -a "$xbel" "${xbel}.houston-bak.$(date +%s)"
    local tmp; tmp="$(mktemp)"
    printf '%s\n' "${dead[@]}" | awk '
      NR==FNR { kill["file://" $0]=1; next }
      /<bookmark[ \t]/ {
        href=""
        if (match($0, /href="[^"]*"/)) href=substr($0, RSTART+6, RLENGTH-7)
        if (href in kill) { skip=1 }
      }
      !skip { print }
      skip && /<\/bookmark>/ { skip=0 }
    ' - "$xbel" > "$tmp" && cat "$tmp" > "$xbel"
    rm -f "$tmp"
  fi

  for e in "${gtkdead[@]:-}"; do
    [[ -n "$e" ]] || continue
    local f="${e%%|*}" p="${e#*|}"
    [[ -f "${f}.houston-bak" ]] || cp -a "$f" "${f}.houston-bak"
    grep -vF "file://${p}" "$f" > "${f}.tmp" && cat "${f}.tmp" > "$f"
    rm -f "${f}.tmp"
  done

  say ""
  say "Sidebar entries removed. Log out/in (or restart the file dialog) to refresh."
}

# ===========================================================================
# LINUX
# ===========================================================================
cleanup_linux() {
  local MOUNT_ROOT="${R}/mnt/houston-mounts"
  local CRED_DIR="${R}/etc/samba/houston-credentials"

  # Gather every key we know about from fstab, mount dirs and cred files.
  # The cred dir is root-only, so only read it when we already need a password.
  local keys=()
  while IFS= read -r k; do keys+=("$k"); done < <(
    {
      grep -oE "${MOUNT_ROOT}/[^ ]+" "$FSTAB" 2>/dev/null | xargs -r -n1 basename
      ls -1 "$MOUNT_ROOT" 2>/dev/null
      (( APPLY == 1 )) && $SUDO ls -1 "$CRED_DIR" 2>/dev/null | sed 's/\.cred$//'
    } | sort -u
  )

  # Read the kernel mount table directly. `mountpoint`/`stat` block on an
  # unreachable CIFS server and can report a live mount as absent.
  is_mounted() { awk -v d="$1" '$2 == d { found = 1 } END { exit !found }' "$MOUNTS"; }

  # A mount whose server is gone (destroyed pool, decommissioned host) still
  # appears in the mount table but never answers. Bounded so a hang can't stall.
  responds() { timeout 5 stat -t "$1" >/dev/null 2>&1; }

  local stale=() dead_mounts=()
  say "Scanning ${#keys[@]} Houston mount key(s)..."
  for k in "${keys[@]}"; do
    local mdir="${MOUNT_ROOT}/${k}"
    if is_mounted "$mdir"; then
      if responds "$mdir"; then
        keep "$k" "(mounted and responding)"
        continue
      fi
      dead_mounts+=("$k")
      if is_in_use "$k"; then
        drop "$k" "(dead mount - will unmount, config kept for its backup task)"
      else
        drop "$k" "(dead mount - server unreachable)"
        stale+=("$k")
      fi
    elif is_in_use "$k"; then
      keep "$k" "(used by an installed backup task)"
    else
      drop "$k" "(stale)"
      stale+=("$k")
    fi
  done

  if (( ${#dead_mounts[@]} > 0 && APPLY == 1 )) && [[ -z "$R" ]]; then
    for k in "${dead_mounts[@]}"; do
      sudo umount -f "${MOUNT_ROOT}/${k}" 2>/dev/null || sudo umount -l "${MOUNT_ROOT}/${k}" 2>/dev/null || true
    done
    say ""
    say "Unmounted ${#dead_mounts[@]} dead mount(s)."
  fi

  if (( ${#stale[@]} == 0 )); then
    say "No stale fstab/credential entries."
  elif (( APPLY == 1 )); then
    # Build one privileged script so we only prompt for a password once.
    local tmp; tmp="$(mktemp)"
    {
      echo 'set -euo pipefail'
      echo 'TMP="$(mktemp)"'
      echo "trap 'rm -f \"\$TMP\"' EXIT"
      echo "FSTAB=$(printf %q "$FSTAB")"
      echo "MOUNTS=$(printf %q "$MOUNTS")"
      echo "R=$(printf %q "$R")"
      echo 'cp -a "$FSTAB" "${FSTAB}.houston-bak.$(date +%s)"'
      echo "OWNER_UID=$(id -u)"
      echo 'key_referenced_elsewhere() {'
      echo '  local mdir="$1" f'
      echo '  for f in "$R"/var/spool/cron/crontabs/* "$R"/var/spool/cron/* "$R"/etc/cron.d/* \'
      echo '           "$R"/home/*/.local/share/houston-backups/Houston_Backup_Task_*.sh \'
      echo '           "$R"/root/.local/share/houston-backups/Houston_Backup_Task_*.sh; do'
      echo '    [ -f "$f" ] || continue'
      echo '    grep -qF "$mdir" "$f" && return 0'
      echo '  done'
      echo '  return 1'
      echo '}'
      echo 'remove_key() {'
      echo '  local mdir="$1" cred="$2" line'
      echo '  awk -v d="$mdir" '"'"'$2 == d { f = 1 } END { exit !f }'"'"' "$MOUNTS" && return 0'
      echo '  key_referenced_elsewhere "$mdir" && return 0'
      echo '  line="$(awk -v d="$mdir" '"'"'$2 == d'"'"' "$FSTAB")"'
      echo '  if [ -n "$line" ]; then case "$line" in *"uid=$OWNER_UID,"*) ;; *) return 0 ;; esac; fi'
      echo '  awk -v d="$mdir" '"'"'$2 != d'"'"' "$FSTAB" > "$TMP" && cat "$TMP" > "$FSTAB"'
      echo '  rm -f "$cred"'
      echo '  rmdir "$mdir" 2>/dev/null || true'
      echo '}'
      for k in "${stale[@]}"; do
        printf 'remove_key %q %q\n' "${MOUNT_ROOT}/${k}" "${CRED_DIR}/${k}.cred"
      done
    } > "$tmp"

    $SUDO bash "$tmp"
    rm -f "$tmp"
    say ""
    say "Removed ${#stale[@]} stale entr(ies). /etc/fstab backed up alongside itself."
  fi

  cleanup_places "$MOUNT_ROOT"

  if (( APPLY == 0 )); then
    say ""
    say "Dry run - re-run with --apply to remove the items marked REMOVE above."
  fi
}

# ===========================================================================
# MACOS
# ===========================================================================
cleanup_macos() {
  local MOUNT_ROOT="$HOME/houston-mounts"

  say "Scanning $MOUNT_ROOT ..."
  local stale=()
  for p in "$MOUNT_ROOT"/*; do
    [[ -e "$p" || -L "$p" ]] || continue
    local k; k="$(basename "$p")"
    if mount | grep -q " on /Volumes/${k} "; then
      keep "$k" "(volume currently mounted)"
    elif is_in_use "$k"; then
      keep "$k" "(used by an installed backup task)"
    else
      drop "$k" "(stale link/dir)"
      stale+=("$k")
    fi
  done

  # Keychain entries created by the wizard.
  say ""
  say "Keychain services matching 'houston-smb-*' (removed with --apply):"
  security dump-keychain 2>/dev/null | grep -oE 'houston-smb-[^"]+' | sort -u | sed 's/^/  /'

  if (( APPLY == 0 )); then
    cleanup_places "$MOUNT_ROOT"
    say ""
    say "Dry run - re-run with --apply to remove."
    return
  fi

  for k in "${stale[@]:-}"; do [[ -n "$k" ]] && rm -rf "${MOUNT_ROOT:?}/${k}"; done
  while IFS= read -r svc; do
    security delete-generic-password -s "$svc" >/dev/null 2>&1 || true
  done < <(security dump-keychain 2>/dev/null | grep -oE 'houston-smb-[^"]+' | sort -u)

  cleanup_places "$MOUNT_ROOT"

  say "Removed ${#stale[@]} stale mount link(s) and matching keychain items."
  say "Note: /private/etc/sudoers.d/houston-$USER is left in place (harmless)."
}

case "$OS" in
  Linux)  cleanup_linux  ;;
  Darwin) cleanup_macos  ;;
  *) say "Unsupported OS: $OS (use scripts/cleanup-houston-mounts.ps1 on Windows)"; exit 1 ;;
esac
