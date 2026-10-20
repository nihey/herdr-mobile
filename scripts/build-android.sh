#!/usr/bin/env bash
# Usage: build-android.sh [apk|bundle]
# apk: standalone release APK (default arm64-v8a). bundle: Play App Bundle (all ABIs).
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
format="${1:-apk}"
case "$format" in
  apk) task=assembleRelease abis=arm64-v8a output=apk/release/app-release.apk artifact=herdr-mobile.apk ;;
  bundle) task=bundleRelease abis=armeabi-v7a,arm64-v8a,x86,x86_64 output=bundle/release/app-release.aab artifact=herdr-mobile.aab ;;
  *) printf 'Usage: build-android.sh [apk|bundle]\n' >&2; exit 1 ;;
esac
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
# A private upload key signs release builds when present. Without it, APKs use React
# Native's public debug key (personal sideloading only); Play bundles require the key.
signing="$project_dir/.local/upload-keystore.properties"
if [[ ! -f "$signing" ]]; then
  if [[ "$format" == bundle ]]; then
    printf 'Play bundles need a private upload key in %s (see README).\n' "$signing" >&2
    exit 1
  fi
  printf 'No upload key: signing with the public debug key.\n' >&2
fi
export NODE_ENV=production
cd "$project_dir/mobile"
npx expo prebuild --platform android --no-install
cd android
gradle_args=("$task" --console=plain --max-workers=2 -PreactNativeArchitectures="${ANDROID_ARCHITECTURES:-$abis}" -Dorg.gradle.jvmargs='-Xmx2048m -XX:MaxMetaspaceSize=768m')
if [[ -f "$signing" ]]; then
  # Pass the key as the Android Gradle Plugin's injected signing properties through the
  # environment, so passwords never reach argv. The dotted names need exec from Python,
  # and gradlew must run under bash: dash (/bin/sh on Debian) drops them.
  python3 -I - "$signing" bash ./gradlew "${gradle_args[@]}" <<'PY'
import os, sys
props = dict(line.rstrip('\n').split('=', 1) for line in open(sys.argv[1]) if '=' in line)
names = {'storeFile': 'store.file', 'storePassword': 'store.password', 'keyAlias': 'key.alias', 'keyPassword': 'key.password'}
env = dict(os.environ)
for key, name in names.items():
    env['ORG_GRADLE_PROJECT_android.injected.signing.' + name] = props[key]
os.execvpe(sys.argv[2], sys.argv[2:], env)
PY
else
  ./gradlew "${gradle_args[@]}"
fi
mkdir -p "$project_dir/artifacts"
cp "app/build/outputs/$output" "$project_dir/artifacts/$artifact"
printf '\n%s: %s/artifacts/%s\n' "${format^^}" "$project_dir" "$artifact"
