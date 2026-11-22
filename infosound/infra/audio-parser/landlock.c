#define _GNU_SOURCE
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Fail-closed Landlock launcher. Build: cc -O2 -Wall -Wextra -Werror -o infosound-parser landlock.c */
static void fail(const char *message) { perror(message); _exit(125); }
static void allow_path(int ruleset, const char *path, __u64 access, int required) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) { if (required) fail("parser sandbox path"); return; }
  struct landlock_path_beneath_attr rule = { .allowed_access = access, .parent_fd = fd };
  if (syscall(__NR_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) fail("parser sandbox rule");
  close(fd);
}
int main(int argc, char **argv) {
  if (argc < 3 || argv[1][0] != '/' || (strcmp(argv[2], "/usr/bin/ffmpeg") && strcmp(argv[2], "/usr/bin/ffprobe"))) {
    fputs("invalid parser launcher arguments\n", stderr); return 125;
  }
  int abi = syscall(__NR_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  if (abi < 1) fail("Landlock is required for audio parsing");
  __u64 read_only = LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
  __u64 handled = read_only | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |
    LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SOCK |
    LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK | LANDLOCK_ACCESS_FS_MAKE_SYM;
#ifdef LANDLOCK_ACCESS_FS_REFER
  if (abi >= 2) handled |= LANDLOCK_ACCESS_FS_REFER;
#endif
#ifdef LANDLOCK_ACCESS_FS_TRUNCATE
  if (abi >= 3) handled |= LANDLOCK_ACCESS_FS_TRUNCATE;
#endif
  struct landlock_ruleset_attr rules = { .handled_access_fs = handled };
  int ruleset = syscall(__NR_landlock_create_ruleset, &rules, sizeof(rules), 0);
  if (ruleset < 0) fail("parser sandbox ruleset");
  allow_path(ruleset, "/usr", read_only, 1);
  allow_path(ruleset, "/lib", read_only, 1);
  allow_path(ruleset, "/lib64", read_only, 0);
  allow_path(ruleset, "/etc/ld.so.cache", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/etc/localtime", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE, 1);
  allow_path(ruleset, "/dev/urandom", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  __u64 workspace = handled & ~LANDLOCK_ACCESS_FS_EXECUTE & ~LANDLOCK_ACCESS_FS_MAKE_CHAR & ~LANDLOCK_ACCESS_FS_MAKE_BLOCK & ~LANDLOCK_ACCESS_FS_MAKE_SOCK;
  allow_path(ruleset, argv[1], workspace, 1);
  if (chdir(argv[1])) fail("parser working directory");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail("parser no-new-privileges");
  if (syscall(__NR_landlock_restrict_self, ruleset, 0)) fail("parser sandbox enforcement");
  close(ruleset);
  execv(argv[2], &argv[2]);
  fail("parser exec");
}
