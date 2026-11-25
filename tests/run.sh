#!/bin/sh
# Runs the pure-logic tests with a stub for Herdr's "herdr" module.
set -e
cd "$(dirname "$0")"
mkdir -p .build
sed 's#from "herdr"#from "../herdr-stub.mjs"#; s#^import \* as fs from "fs/promises";##' ../mods/board/store.js > .build/store.mjs
cp ../mods/tok-meter/usage.js .build/usage.mjs
sed 's#from "herdr"#from "../herdr-stub.mjs"#' ../mods/side-tasks/tasks.js > .build/tasks.mjs
for t in *.test.mjs; do node "$t"; done
