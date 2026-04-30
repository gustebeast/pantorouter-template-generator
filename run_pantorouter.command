#!/bin/bash
# Pantorouter Template Generator — macOS double-click launcher.
# Double-click this file in Finder. macOS will open Terminal and run it.
#
# First run: installs Python (via Apple's Command Line Tools, ~1 GB Apple
# download) and CadQuery (via pip, ~500 MB) into a local folder. Takes
# 10–30 minutes depending on internet speed. After that, subsequent runs
# are instant.

set -e
cd "$(dirname "$0")"

PYSCRIPT="pantorouter_template_generator.py"
VENV=".venv"

echo "=========================================="
echo "  Pantorouter Template Generator"
echo "=========================================="
echo ""

# ── 1. Make sure python3 is available ───────────────────────────────────────
if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 isn't installed yet. Installing Apple's Command Line"
    echo "Tools, which includes Python 3 (and is also what you'd need for"
    echo "any developer software on this Mac)."
    echo ""
    echo "An Apple-branded popup window will appear. Click 'Install' in it"
    echo "and wait for it to finish (about 5–15 minutes). Then come back"
    echo "to this window and press Return."
    echo ""
    xcode-select --install 2>/dev/null || true
    read -r -p "Press Return once the Apple installer says it's finished... " _

    if ! command -v python3 >/dev/null 2>&1; then
        echo ""
        echo "Python 3 still isn't found. Please install it manually from"
        echo "https://www.python.org/downloads/ and then run this script"
        echo "again."
        echo ""
        read -r -p "Press Return to close. " _
        exit 1
    fi
fi

PY_VER=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Found Python $PY_VER."
echo ""

# ── 2. Create a local virtual environment + install CadQuery ────────────────
if [ ! -d "$VENV" ]; then
    echo "First run: creating a local Python environment in ./$VENV"
    echo "and installing CadQuery (the 3D modeling library). This"
    echo "downloads about 500 MB and takes a few minutes."
    echo ""
    python3 -m venv "$VENV"
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
    python -m pip install --upgrade pip >/dev/null
    python -m pip install cadquery
    echo ""
    echo "Setup complete."
    echo ""
else
    # shellcheck disable=SC1091
    source "$VENV/bin/activate"
fi

# ── 3. Prompt the user for parameters ───────────────────────────────────────
echo "------------------------------------------"
echo "Enter the parameters for your template."
echo "Press Return to accept the default value shown in [brackets]."
echo "------------------------------------------"
echo ""

prompt() {
    # prompt VARNAME "Question text" "default"
    local var="$1" question="$2" default="$3" answer
    read -r -p "$question [$default]: " answer
    answer="${answer:-$default}"
    eval "$var=\"\$answer\""
}

prompt TENON_W   "Tenon WIDTH (short axis), mm"       "20"
prompt TENON_L   "Tenon LENGTH (long axis), mm"       "70"
prompt BIT       "Router bit diameter, mm"            "12.7"
prompt BEARING   "Guide bushing diameter, mm"         "12"
prompt SHRINK    "Shrink compensation (1.000 = none, calibrate per print)" "1.000"

echo ""
echo "Corner radius of the finished tenon. A round-bottom router bit"
echo "can't cut a sharper corner than its own radius, so the smallest"
echo "possible value is bit/2 (the default if you just press Return) —"
echo "that gives crisp corners that exactly match the bit. Larger values"
echo "round the corners more (half the short axis = fully rounded ends)."
read -r -p "Tenon corner radius in mm [bit/2 = $(awk "BEGIN {print $BIT/2}")]: " RADIUS
RADIUS_ARG=""
if [ -n "$RADIUS" ]; then
    RADIUS_ARG="--tenon-radius $RADIUS"
fi

# ── 4. Build a sensible output filename from the parameters ─────────────────
STEM="template_${TENON_W}x${TENON_L}mm_bit${BIT}mm_bearing${BEARING}mm"
STEM="${STEM// /}"  # strip any spaces

echo ""
echo "------------------------------------------"
echo "Generating template..."
echo "------------------------------------------"

python "$PYSCRIPT" \
    --tenon-width   "$TENON_W" \
    --tenon-length  "$TENON_L" \
    --bit           "$BIT" \
    --bearing       "$BEARING" \
    --shrink-comp   "$SHRINK" \
    --output        "$STEM" \
    $RADIUS_ARG

echo ""
echo "=========================================="
echo "Done! Files written to:"
echo "  $(pwd)/$STEM.step"
echo "  $(pwd)/$STEM.stl"
echo "=========================================="
echo ""
echo "Send the .stl file to your 3D printer slicer (Cura, Bambu Studio,"
echo "PrusaSlicer, etc.). The .step file is for CAD software if you want"
echo "to inspect or modify the geometry."
echo ""
read -r -p "Press Return to close this window. " _
