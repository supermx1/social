#!/usr/bin/env bash
#
# Builds assets/Social.icns from assets/icon.svg.
#
# ponytail: macOS ships `sips` (which rasterizes SVG since macOS 26) and `iconutil`,
# so there is no image dependency to install — not for you, not for a contributor.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="assets/icon.svg"
SET="assets/Social.iconset"

rm -rf "$SET"
mkdir -p "$SET"

# One high-res rasterization, then downsample — rasterizing the SVG per size is slower
# and gives sips a different hinting result at each step.
sips -s format png -Z 1024 "$SRC" --out "$SET/base.png" >/dev/null

for size in 16 32 128 256 512; do
	sips -Z "$size" "$SET/base.png" --out "$SET/icon_${size}x${size}.png" >/dev/null
	sips -Z "$((size * 2))" "$SET/base.png" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done

rm "$SET/base.png"
iconutil -c icns "$SET" -o assets/Social.icns
rm -rf "$SET"

# The web UI's favicon is the same mark from the same source, so the browser tab and the
# Dock icon can never drift apart.
cp "$SRC" apps/web/src/lib/assets/favicon.svg

echo "assets/Social.icns"
echo "apps/web/src/lib/assets/favicon.svg"
