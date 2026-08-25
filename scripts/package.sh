#!/usr/bin/env bash
#
# Builds dist/Social OS.app — UI, backend, database, cron and worker in one double-clickable
# bundle. ego lite stays a separate install (it is a signed third-party app that holds the
# user's logged-in browser sessions); the dashboard prompts for it when it's missing.
#
# The result is NOT signed or notarized, so a copy downloaded from the internet will be
# quarantined by Gatekeeper. See README for the codesign/notarize step.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="dist/Social OS.app"
VERSION="$(node -p "require('./package.json').version")"

# Bun installs to ~/.bun/bin, which is not on a non-interactive PATH.
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
[ -x "$BUN" ] || { echo "bun not found — install it: curl -fsSL https://bun.sh/install | bash" >&2; exit 1; }

echo "==> web"
npm run build --silent   # SvelteKit adapter-static writes into backend/pb_public

echo "==> icon"
./scripts/make-icon.sh >/dev/null

echo "==> worker (bun $("$BUN" --version))"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
"$BUN" build --compile --target=bun-darwin-arm64 --minify \
	apps/worker/src/index.ts --outfile "$APP/Contents/Resources/worker" >/dev/null

echo "==> bundle"
cp backend/backend            "$APP/Contents/Resources/backend"
cp assets/Social.icns         "$APP/Contents/Resources/Social.icns"
cp scripts/launcher.sh        "$APP/Contents/MacOS/Social OS"
chmod +x "$APP/Contents/MacOS/Social OS" "$APP/Contents/Resources/backend" "$APP/Contents/Resources/worker"

# pb_data is deliberately NOT copied: the user's database lives in Application Support, so
# reinstalling or replacing the app never touches their accounts, posts or API keys.
cp -R backend/pb_hooks        "$APP/Contents/Resources/pb_hooks"
cp -R backend/pb_migrations   "$APP/Contents/Resources/pb_migrations"
cp -R backend/pb_public       "$APP/Contents/Resources/pb_public"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Social OS</string>
	<key>CFBundleDisplayName</key><string>Social OS</string>
	<key>CFBundleIdentifier</key><string>com.socialos.app</string>
	<key>CFBundleExecutable</key><string>Social OS</string>
	<key>CFBundleIconFile</key><string>Social</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>$VERSION</string>
	<key>CFBundleVersion</key><string>$VERSION</string>
	<key>LSMinimumSystemVersion</key><string>12.0</string>
	<key>LSApplicationCategoryType</key><string>public.app-category.social-networking</string>
	<key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

echo
echo "$APP  ($(du -sh "$APP" | cut -f1))"
echo "Unsigned — fine on this Mac, quarantined if downloaded elsewhere. See README."
