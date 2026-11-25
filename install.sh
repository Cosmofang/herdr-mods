#!/bin/sh
# Links every mod in this repo into Herdr.app's mods folder.
# Herdr's own (shipped) mods are never touched, so Herdr can keep updating itself.
set -e
here="$(cd "$(dirname "$0")" && pwd)"
dest="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
mkdir -p "$dest"
for mod in "$here"/mods/*/; do
  name="$(basename "$mod")"
  target="$dest/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "skip $name: $target exists and is not a link from this repo" >&2
    continue
  fi
  ln -sfn "${mod%/}" "$target"
  echo "linked $name -> $target"
  if command -v herdr-app >/dev/null; then herdr-app check "$target"; fi
done

# The command agents run to suggest side tasks.
bin="${HERDR_MODS_BIN:-$HOME/.local/bin}"
mkdir -p "$bin"
ln -sfn "$here/bin/herdr-suggest-task" "$bin/herdr-suggest-task"
echo "linked herdr-suggest-task -> $bin/herdr-suggest-task"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "note: $bin is not on PATH; add it, or have agents call $here/bin/herdr-suggest-task" >&2 ;;
esac
