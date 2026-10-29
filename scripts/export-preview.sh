#!/bin/sh
# Local-only export; publication and reviewer submission require separate approval.
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 /absolute/path/outside-git/preview.html" >&2
  exit 2
fi

for command in curl git dirname realpath; do
  command -v "$command" >/dev/null
done

case "$1" in
  /*) ;;
  *) echo 'Destination must be an absolute path.' >&2; exit 2 ;;
esac

# Resolve symlinks before checking Git membership; the parent must already exist.
destination=$(realpath -m -- "$1")
parent=$(realpath -e -- "$(dirname -- "$destination")")
[ -d "$parent" ] || exit 2
# Do not let caller-specific Git settings hide a containing worktree.
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_CEILING_DIRECTORIES
export GIT_DISCOVERY_ACROSS_FILESYSTEM=1
if git -C "$parent" rev-parse --git-dir >/dev/null 2>&1; then
  echo 'Refusing to save a preview inside a Git worktree or repository.' >&2
  exit 2
fi

# Never replace existing files. Private permissions also apply to failed downloads.
umask 077
set -C
exec 3> "$destination"
if ! curl --fail --silent --show-error --connect-timeout 5 --max-time 30 \
  'http://127.0.0.1:8787/digest/2026-10-28' >&3; then
  exec 3>&-
  rm -- "$destination"
  exit 1
fi
exec 3>&-
echo 'Local preview saved; no publication performed.'
