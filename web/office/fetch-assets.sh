#!/usr/bin/env bash
# 拉取办公室原型所需的资产(PixiJS + LPC 像素角色)到 ./assets 与 ./pixi.min.js
# 这些资产不入库(LPC 为 CC-BY-SA / GPL / OGA-BY 多重许可,见 ATTRIBUTION.md)。
# 用法: bash fetch-assets.sh   然后: python3 -m http.server 8911  打开 http://localhost:8911
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/assets"
LPC=https://raw.githubusercontent.com/jrconway3/Universal-LPC-spritesheet/master
g(){ curl -sL -o "$DIR/assets/$2" "$LPC/$1"; echo "  $2"; }

echo "PixiJS ..."
curl -sL -o "$DIR/pixi.min.js" https://unpkg.com/pixi.js@7.4.2/dist/pixi.min.js

echo "LPC 角色资产 ..."
g "body/male/light.png"                              body_light.png
g "body/male/dark.png"                               body_dark.png
g "body/male/tanned2.png"                            body_tan.png
g "torso/shirts/longsleeve/male/teal_longsleeve.png"   shirt_teal.png
g "torso/shirts/longsleeve/male/maroon_longsleeve.png" shirt_maroon.png
g "torso/shirts/longsleeve/male/white_longsleeve.png"  shirt_white.png
g "legs/pants/male/teal_pants_male.png"              pants_teal.png
g "legs/pants/male/red_pants_male.png"               pants_red.png
g "legs/pants/male/white_pants_male.png"             pants_white.png
g "hair/male/plain/black.png"                        hair_black.png
g "hair/male/parted/black.png"                       hair_parted.png

echo "完成。 python3 -m http.server 8911  ->  http://localhost:8911"
