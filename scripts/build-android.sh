#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [[ ! -x "${JAVA_HOME:-/nonexistent}/bin/javac" ]]; then
  if command -v javac >/dev/null 2>&1; then
    export JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  elif [[ -x "$HOME/android-studio/jbr/bin/javac" ]]; then
    export JAVA_HOME="$HOME/android-studio/jbr"
  else
    printf 'Set JAVA_HOME to a full JDK (17+), including bin/javac.\n' >&2
    exit 1
  fi
fi
export NODE_ENV=production
cd "$project_dir/mobile"
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease --console=plain --max-workers=2 -PreactNativeArchitectures="${ANDROID_ARCHITECTURES:-arm64-v8a}" -Dorg.gradle.jvmargs='-Xmx2048m -XX:MaxMetaspaceSize=768m'
mkdir -p "$project_dir/artifacts"
cp app/build/outputs/apk/release/app-release.apk "$project_dir/artifacts/herdr-mobile.apk"
printf '\nAPK: %s/artifacts/herdr-mobile.apk\n' "$project_dir"
