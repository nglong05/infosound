#define _GNU_SOURCE
#include <fcntl.h>
#include <linux/landlock.h>
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Fixed image decoder, no user paths or inherited credentials. */
static void fail(const char *message) { (void)message; fputs("IMAGE_SANDBOX_UNAVAILABLE\n", stderr); _exit(125); }
static void cap(int resource, rlim_t value) {
  struct rlimit limit = { value, value };
  if (setrlimit(resource, &limit)) fail("limit");
}
static void allow_path(int ruleset, const char *path, __u64 access, int required) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) { if (required) fail("parser sandbox path"); return; }
  struct landlock_path_beneath_attr rule = { .allowed_access = access, .parent_fd = fd };
  if (syscall(__NR_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0)) fail("parser sandbox rule");
  close(fd);
}
#define DENY(n) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (n), 0, 1), BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)
static void restrict_syscalls(void) {
#if defined(__x86_64__)
  const unsigned int arch = AUDIT_ARCH_X86_64;
#elif defined(__aarch64__)
  const unsigned int arch = AUDIT_ARCH_AARCH64;
#else
#error Unsupported image parser architecture
#endif
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, arch, 1, 0),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
    BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
    DENY(__NR_socket), DENY(__NR_socketpair), DENY(__NR_connect), DENY(__NR_bind), DENY(__NR_listen),
    DENY(__NR_accept), DENY(__NR_accept4), DENY(__NR_ptrace),
    DENY(__NR_process_vm_readv), DENY(__NR_process_vm_writev),
#ifdef __NR_pidfd_getfd
    DENY(__NR_pidfd_getfd),
#endif
#ifdef __NR_io_uring_setup
    DENY(__NR_io_uring_setup),
#endif
#ifdef __NR_bpf
    DENY(__NR_bpf),
#endif
#ifdef __NR_perf_event_open
    DENY(__NR_perf_event_open),
#endif
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
  };
  struct sock_fprog program = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
  if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fail("seccomp");
}
int main(int argc, char **argv) {
  if (argc != 3 || (strcmp(argv[1], "avatar") && strcmp(argv[1], "cover")) ||
      (strcmp(argv[2], "image/jpeg") && strcmp(argv[2], "image/png") && strcmp(argv[2], "image/webp"))) fail("arguments");
  cap(RLIMIT_CPU, 5); cap(RLIMIT_DATA, 384ULL * 1024 * 1024);
  cap(RLIMIT_NOFILE, 64); cap(RLIMIT_NPROC, 256); cap(RLIMIT_CORE, 0);
  cap(RLIMIT_FSIZE, 2ULL * 1024 * 1024);
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
  __u64 read = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR;
  allow_path(ruleset, "/usr", read, 1);
  allow_path(ruleset, "/lib", read, 1);
  allow_path(ruleset, "/lib64", read, 0);
  allow_path(ruleset, "/app", read, 1);
  allow_path(ruleset, "/usr/local/bin/node", LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE, 1);
  allow_path(ruleset, "/lib64/ld-linux-x86-64.so.2", LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/lib/ld-linux-aarch64.so.1", LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/etc/ld.so.cache", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/etc/localtime", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/etc/ssl/openssl.cnf", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  allow_path(ruleset, "/dev/null", LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE, 1);
  allow_path(ruleset, "/dev/urandom", LANDLOCK_ACCESS_FS_READ_FILE, 0);
  if (chdir("/app")) fail("parser working directory");
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0)) fail("parser no-new-privileges");
  if (syscall(__NR_landlock_restrict_self, ruleset, 0)) fail("parser sandbox enforcement");
  close(ruleset);
  restrict_syscalls();
  char *const child[] = { "/usr/local/bin/node", "--jitless", "--max-old-space-size=64", "--max-semi-space-size=8", "/app/dist/image-decoder.js", argv[1], argv[2], NULL };
  char *const environment[] = { "NODE_ENV=production", "UV_THREADPOOL_SIZE=1", "VIPS_CONCURRENCY=1", "MALLOC_ARENA_MAX=2", "TZ=UTC", "LANG=C.UTF-8", NULL };
  execve(child[0], child, environment);
  fail("parser exec");
}
