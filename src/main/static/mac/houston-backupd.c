/*
 * houston-backupd — LaunchDaemon entry point for 45Drives Storage Wizard backups.
 *
 * This exists as a compiled binary for one reason: TCC will not grant Full Disk Access to
 * a shell script. A shebang script's process image is /bin/bash, so the grant can only
 * ever attach to bash, and adding the script to the Full Disk Access list does nothing.
 * A Mach-O at ProgramArguments[0] can hold the grant, and child processes inherit it,
 * which is what lets rsync read Desktop/Documents/Downloads and network volumes during a
 * backup with nobody signed in.
 *
 * All scheduling logic stays in houston-backupd.sh. This binary only supplies identity.
 *
 * Neither mode accepts a program path from an untrusted caller: a binary holding Full
 * Disk Access that execs whatever it is handed is a privilege escalation. The daemon
 * script path is compile-time constant, and --as-user only ever drops privileges.
 *
 *   (no arguments)              exec the daemon script, still as root
 *   --as-user <uid> <script>    become <uid> and exec <script>
 *
 * --as-user replaces `sudo -n -H -u`. sudo is setuid, which resets the TCC responsible
 * process, so task scripts launched through it were attributed to rsync itself and denied.
 * Calling setuid(2) here keeps responsibility with this binary and the grant survives.
 *
 * Build with scripts/mac/build-shim.sh. Keep DAEMON_VERSION in houston-backupd.sh and
 * MAC_DAEMON_VERSION in src/main/backup/macDaemon.ts in step with any change here.
 */

#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define DAEMON_SCRIPT "/Library/Application Support/45Drives/Houston/bin/houston-backupd.sh"

/* Real local accounts start here; matches the filter in houston-backupd.sh. */
#define MIN_UID 500

static int fail(const char *msg) {
    fprintf(stderr, "houston-backupd: %s\n", msg);
    return 1;
}

/* A file we are about to run must not be writable by anyone we are not already trusting. */
static int safe_to_exec(const char *path, uid_t owner) {
    struct stat st;
    if (stat(path, &st) != 0) return 0;
    if (!S_ISREG(st.st_mode)) return 0;
    if (st.st_uid != owner) return 0;
    if (st.st_mode & (S_IWGRP | S_IWOTH)) return 0;
    return 1;
}

static int run_daemon_script(void) {
    if (!safe_to_exec(DAEMON_SCRIPT, 0)) {
        return fail(DAEMON_SCRIPT " is missing, not root-owned, or group/world writable");
    }
    execl("/bin/bash", "bash", DAEMON_SCRIPT, (char *)NULL);
    return fail(strerror(errno));
}

static int run_as_user(const char *uid_arg, const char *script) {
    char *end = NULL;
    long uid = strtol(uid_arg, &end, 10);
    if (end == uid_arg || *end != '\0' || uid < MIN_UID) {
        return fail("--as-user requires the uid of a real local account");
    }

    struct passwd *pw = getpwuid((uid_t)uid);
    if (pw == NULL) return fail("no such uid");

    /* The script lives in the user's home, so only that user may own it. */
    if (!safe_to_exec(script, (uid_t)uid)) {
        return fail("task script is missing, not owned by the target user, or writable by others");
    }

    if (initgroups(pw->pw_name, pw->pw_gid) != 0) return fail("initgroups failed");
    if (setgid(pw->pw_gid) != 0) return fail("setgid failed");
    if (setuid((uid_t)uid) != 0) return fail("setuid failed");
    if (setuid(0) == 0) return fail("privileges were not dropped");

    setenv("HOME", pw->pw_dir, 1);
    setenv("USER", pw->pw_name, 1);
    setenv("LOGNAME", pw->pw_name, 1);
    setenv("SHELL", "/bin/bash", 1);

    execl("/bin/bash", "bash", script, (char *)NULL);
    return fail(strerror(errno));
}

int main(int argc, char **argv) {
    if (argc == 1) return run_daemon_script();
    if (argc == 4 && strcmp(argv[1], "--as-user") == 0) return run_as_user(argv[2], argv[3]);
    fprintf(stderr, "usage: houston-backupd [--as-user <uid> <script>]\n");
    return 2;
}
