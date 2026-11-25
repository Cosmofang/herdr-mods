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
