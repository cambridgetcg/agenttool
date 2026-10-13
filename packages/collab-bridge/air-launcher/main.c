/*
 * collab-bridge-hub: the executable inside CollabBridgeHub.app (C15). launchd runs it as the hub's LaunchAgent, so macOS
 * attributes the hub's Local Network use to this app's bundle id and this executable's own UUID (K45), never to bun,
 * whose signature and UUID every compiled bun program shares. It posix_spawns the program it is given and stays its
 * parent (an exec would turn the grant back into "bun"), forwards SIGTERM and SIGINT, and exits with the child's status.
 *
 *   collab-bridge-hub <program> [args...]
 *
 * Exit: the child's status; 128 + N when signal N killed the child; 64 usage; 127 the spawn failed; 70 an internal fault.
 * A SIGKILL of the launcher itself orphans the child to launchd (F15); the hub's flock on hub.lock covers that case.
 */
#include <errno.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>

extern char **environ;

static volatile pid_t child = 0;

static void forward(int sig) {
  if (child > 0) kill(child, sig);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: collab-bridge-hub <program> [args...]\n");
    return 64;
  }
  /* launchd's environment reaches bun through environ: a preload or a bun-CLI switch in it must not (P14, F4). */
  unsetenv("BUN_OPTIONS");
  unsetenv("BUN_BE_BUN");

  /* Hold SIGTERM and SIGINT until the child's pid is known, so a stop that arrives during the spawn still reaches it. */
  sigset_t held, old;
  sigemptyset(&held);
  sigaddset(&held, SIGTERM);
  sigaddset(&held, SIGINT);
  if (sigprocmask(SIG_BLOCK, &held, &old) != 0) { perror("collab-bridge-hub: sigprocmask"); return 70; }

  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = forward;
  sigemptyset(&sa.sa_mask);
  if (sigaction(SIGTERM, &sa, NULL) != 0 || sigaction(SIGINT, &sa, NULL) != 0) { perror("collab-bridge-hub: sigaction"); return 70; }

  /* The child starts with the mask the launcher was given and the default action for both signals. */
  posix_spawnattr_t attr;
  if (posix_spawnattr_init(&attr) != 0) { perror("collab-bridge-hub: posix_spawnattr_init"); return 70; }
  posix_spawnattr_setsigmask(&attr, &old);
  posix_spawnattr_setsigdefault(&attr, &held);
  posix_spawnattr_setflags(&attr, (short)(POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF));

  pid_t pid;
  int rc = posix_spawn(&pid, argv[1], NULL, &attr, argv + 1, environ);
  posix_spawnattr_destroy(&attr);
  if (rc != 0) {
    fprintf(stderr, "collab-bridge-hub: posix_spawn %s: %s\n", argv[1], strerror(rc));
    return 127;
  }
  child = pid;
  sigprocmask(SIG_SETMASK, &old, NULL); /* a held stop is delivered here and forwarded */

  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) { perror("collab-bridge-hub: waitpid"); return 70; }
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 70;
}
