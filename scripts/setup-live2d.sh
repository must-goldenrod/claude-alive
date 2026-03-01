#!/bin/bash
# Downloads Live2D Cubism SDK Core and sample models for claude-alive.
#
# Live2D Cubism Core: https://www.live2d.com/en/sdk/about/
#   Licensed under Live2D Proprietary Software License Agreement
#   https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
#
# Sample Models (Haru, Hiyori, Rice, Mao, Ren, Wanko):
#   Licensed under Live2D Free Material License
#   https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html
#
# By running this script you agree to the above licenses.

set -e

DEST="packages/ui/public/live2d"
MODELS_DIR="$DEST/models"
CORE_URL="https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js"
SAMPLE_REPO="https://github.com/Live2D/CubismWebSamples"
MODELS=("Haru" "Hiyori" "Rice" "Mao" "Ren" "Wanko")

echo "claude-alive: Live2D setup"
echo ""
echo "This downloads proprietary Live2D SDK files."
echo "By continuing you agree to the Live2D license agreements."
echo ""

mkdir -p "$DEST" "$MODELS_DIR"

# 1. Download Cubism Core
if [ -f "$DEST/live2dcubismcore.min.js" ]; then
  echo "[ok] Cubism Core already exists"
else
  echo "[dl] Downloading Cubism Core..."
  curl -fsSL "$CORE_URL" -o "$DEST/live2dcubismcore.min.js"
  echo "[ok] Cubism Core downloaded"
fi

# 2. Download sample models
TEMP_DIR=$(mktemp -d)
echo "[dl] Cloning sample models (sparse checkout)..."
git clone --depth 1 --filter=blob:none --sparse "$SAMPLE_REPO" "$TEMP_DIR/samples" 2>/dev/null
cd "$TEMP_DIR/samples"
git sparse-checkout set Samples/Resources
cd - > /dev/null

for model in "${MODELS[@]}"; do
  if [ -d "$MODELS_DIR/$model" ]; then
    echo "[ok] $model already exists"
  else
    SRC="$TEMP_DIR/samples/Samples/Resources/$model"
    if [ -d "$SRC" ]; then
      cp -r "$SRC" "$MODELS_DIR/$model"
      echo "[ok] $model copied"
    else
      echo "[!!] $model not found in samples repo"
    fi
  fi
done

rm -rf "$TEMP_DIR"

echo ""
echo "Done! Live2D assets are in $DEST"
echo "You can now run: pnpm dev"
