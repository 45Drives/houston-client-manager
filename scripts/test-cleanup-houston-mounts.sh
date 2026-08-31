#!/usr/bin/env bash
#
# Exercises cleanup-houston-mounts.sh against a throwaway tree via
# HOUSTON_TEST_ROOT. Touches nothing outside its own mktemp dir and never
# needs root.
#
#   ./scripts/test-cleanup-houston-mounts.sh
#
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/cleanup-houston-mounts.sh"
PASS=0
FAIL=0

ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
check(){ if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# ---------------------------------------------------------------------------
# Builds a sandbox. Each key is "name:state" where state is one of:
#   stale     - fstab + cred + dir, nothing references it
#   mounted   - as above, plus an entry in the fake mount table
#   incron    - as above, plus a cron file referencing its mount dir
#   otheruser - as above, but the fstab line carries a different uid=
# ---------------------------------------------------------------------------
build_root() {
  local root; root="$(mktemp -d)"
  local uid; uid="$(id -u)"
  mkdir -p "$root"/etc/samba/houston-credentials \
           "$root"/mnt/houston-mounts \
           "$root"/proc/self \
           "$root"/etc/cron.d \
           "$root"/var/spool/cron/crontabs \
           "$root"/home/otheruser/.local/share/houston-backups
  : > "$root/proc/self/mounts"
  printf 'UUID=deadbeef / ext4 defaults 0 1\n' > "$root/etc/fstab"

  for spec in "$@"; do
    local k="${spec%%:*}" state="${spec##*:}"
    local mdir="$root/mnt/houston-mounts/$k"
    local owner="$uid"
    [[ "$state" == "otheruser" ]] && owner=$((uid + 1))

    mkdir -p "$mdir"
    printf 'username=u\npassword=p\n' > "$root/etc/samba/houston-credentials/$k.cred"
    printf '//host/share %s cifs credentials=/etc/samba/houston-credentials/%s.cred,rw,uid=%s,gid=1000 0 0\n' \
      "$mdir" "$k" "$owner" >> "$root/etc/fstab"

    case "$state" in
      mounted)
        printf '//host/share %s cifs rw 0 0\n' "$mdir" >> "$root/proc/self/mounts" ;;
      incron)
        local s="$root/home/otheruser/.local/share/houston-backups/Houston_Backup_Task_x_$k.sh"
        printf "MOUNT_DIR='%s'\n" "$mdir" > "$s"
        printf '0 2 * * * root %s\n' "$s" > "$root/var/spool/cron/crontabs/otheruser" ;;
    esac
  done
  printf '%s' "$root"
}

# Match the mount-point field exactly - a plain grep for "..._keo" also hits
# "..._keo2" and would mask a real prefix-collision bug.
has_fstab()  { awk -v d="$1/mnt/houston-mounts/$2" '$2 == d { f = 1 } END { exit !f }' "$1/etc/fstab"; }
has_cred()   { [[ -f "$1/etc/samba/houston-credentials/$2.cred" ]]; }
has_backup() { compgen -G "$1/etc/fstab.houston-bak.*" >/dev/null; }
yn()         { if "$@" >/dev/null 2>&1; then echo yes; else echo no; fi; }

echo "== Dry run makes no changes =="
ROOT="$(build_root alpha:stale)"
BEFORE="$(md5sum < "$ROOT/etc/fstab")"
HOUSTON_TEST_ROOT="$ROOT" bash "$SCRIPT" >/dev/null 2>&1
check "fstab untouched by dry run" "$(md5sum < "$ROOT/etc/fstab")" "$BEFORE"
check "cred survives dry run"      "$(yn has_cred "$ROOT" alpha)" "yes"
rm -rf "$ROOT"

echo
echo "== --apply removes only the genuinely unused key =="
ROOT="$(build_root alpha:stale bravo:mounted charlie:incron delta:otheruser)"
HOUSTON_TEST_ROOT="$ROOT" bash "$SCRIPT" --apply >/dev/null 2>&1
check "stale entry removed"                 "$(yn has_fstab "$ROOT" alpha)"   "no"
check "stale cred removed"                  "$(yn has_cred  "$ROOT" alpha)"   "no"
check "mounted share kept"                  "$(yn has_fstab "$ROOT" bravo)"   "yes"
check "mounted cred kept"                   "$(yn has_cred  "$ROOT" bravo)"   "yes"
check "other user's cron reference kept"    "$(yn has_fstab "$ROOT" charlie)" "yes"
check "other user's cron cred kept"         "$(yn has_cred  "$ROOT" charlie)" "yes"
check "other uid's entry kept"              "$(yn has_fstab "$ROOT" delta)"   "yes"
check "other uid's cred kept"               "$(yn has_cred  "$ROOT" delta)"   "yes"
check "unrelated root fstab line intact"    "$(yn grep -qF 'UUID=deadbeef' "$ROOT/etc/fstab")" "yes"
check "fstab backup written"                "$(yn has_backup "$ROOT")" "yes"
rm -rf "$ROOT"

echo
echo "== Non-empty mount dir is never deleted =="
ROOT="$(build_root alpha:stale)"
echo "real data" > "$ROOT/mnt/houston-mounts/alpha/important.txt"
HOUSTON_TEST_ROOT="$ROOT" bash "$SCRIPT" --apply >/dev/null 2>&1
check "directory with contents survives" "$(yn test -f "$ROOT/mnt/houston-mounts/alpha/important.txt")" "yes"
rm -rf "$ROOT"

echo
echo "== Prefix collision: _keo must not match _keo2 =="
ROOT="$(build_root host_share_keo:stale host_share_keo2:mounted)"
HOUSTON_TEST_ROOT="$ROOT" bash "$SCRIPT" --apply >/dev/null 2>&1
check "exact key removed"        "$(yn has_fstab "$ROOT" host_share_keo)"  "no"
check "longer key kept"          "$(yn has_fstab "$ROOT" host_share_keo2)" "yes"
rm -rf "$ROOT"

echo
echo "== Read-only fstab aborts before deleting credentials =="
ROOT="$(build_root alpha:stale)"
chmod 0444 "$ROOT/etc/fstab"; chmod 0555 "$ROOT/etc"
HOUSTON_TEST_ROOT="$ROOT" bash "$SCRIPT" --apply >/dev/null 2>&1
chmod 0755 "$ROOT/etc"
check "cred kept when fstab cannot be rewritten" "$(yn has_cred "$ROOT" alpha)" "yes"
chmod -R u+w "$ROOT"; rm -rf "$ROOT"

echo
printf '%s passed, %s failed\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
