#!/bin/sh
# Start the repository's Bash gates without BASH_ENV/ENV startup-file hooks.
# The target script remains responsible for narrowing its ordinary environment;
# this launcher does not clear credentials, restrict PATH/filesystem/network
# access, or provide an OS sandbox.

set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: bin/bash-without-env-hooks.sh <bash-script-or-option> [args...]" >&2
  exit 2
fi

unset BASH_ENV ENV
exec /bin/bash "$@"
