#!/usr/bin/env bash
# Runs Playwright. If the required system libraries were extracted to
# /tmp/pwlibs (see README), point the dynamic loader and fontconfig at them so
# a headless Chromium can start without root.
set -e
if [ -d /tmp/pwlibs ]; then
  export LD_LIBRARY_PATH="$(find /tmp/pwlibs -type d -name lib | tr '\n' ':')${LD_LIBRARY_PATH}"
  export FONTCONFIG_PATH="${FONTCONFIG_PATH:-/tmp/pwlibs/etc/fonts}"
  export FONTCONFIG_FILE="${FONTCONFIG_FILE:-/tmp/pwlibs/etc/fonts/fonts.conf}"
fi
exec node_modules/.bin/playwright test "$@"
