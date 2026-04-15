#!/bin/bash
# setup-mac.sh - Setup Mac as Office-to-PDF conversion server
# Run on the Mac itself (not remotely)
#
# Prerequisites:
#   - macOS with Microsoft Office for Mac installed (Word, Excel, PowerPoint)
#   - Admin access
#
# Usage: bash setup-mac.sh

set -euo pipefail

INSTALL_DIR="/opt/printer-mcp"
CONVERT_DIR="/tmp/printer-mcp-convert"
SCRIPT_SOURCE="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo " Mac Office Conversion Server Setup"
echo "========================================="

# ─── 1. Check Office installation ───────────────────────────

echo "[1/5] Checking Microsoft Office..."

check_app() {
  if [ -d "/Applications/$1.app" ]; then
    echo "  ✓ $1 found"
    return 0
  else
    echo "  ❌ $1 NOT found"
    return 1
  fi
}

MISSING=0
check_app "Microsoft Word" || MISSING=1
check_app "Microsoft Excel" || MISSING=1
check_app "Microsoft PowerPoint" || MISSING=1

if [ $MISSING -eq 1 ]; then
  echo ""
  echo "  ⚠ Some Office apps are missing."
  echo "  Install Microsoft Office for Mac before proceeding."
  echo "  Download: https://www.office.com/ or via your M365 subscription."
  echo ""
  read -rp "  Continue anyway? (y/N) " CONTINUE
  [ "$CONTINUE" = "y" ] || exit 1
fi

# ─── 2. Enable SSH (Remote Login) ───────────────────────────

echo "[2/5] Enabling SSH (Remote Login)..."

# Check if SSH is already enabled
if systemsetup -getremotelogin 2>/dev/null | grep -q "On"; then
  echo "  ✓ SSH already enabled"
else
  echo "  Enabling Remote Login..."
  sudo systemsetup -setremotelogin on
  echo "  ✓ SSH enabled"
fi

echo "  SSH address: $(whoami)@$(ipconfig getifaddr en0 2>/dev/null || echo 'CHECK_IP')"

# ─── 3. Install conversion scripts ──────────────────────────

echo "[3/5] Installing conversion scripts to $INSTALL_DIR..."

sudo mkdir -p "$INSTALL_DIR"
sudo cp "$SCRIPT_SOURCE/convert.sh" "$INSTALL_DIR/"
sudo cp "$SCRIPT_SOURCE/convert-word.scpt" "$INSTALL_DIR/"
sudo cp "$SCRIPT_SOURCE/convert-excel.scpt" "$INSTALL_DIR/"
sudo cp "$SCRIPT_SOURCE/convert-pptx.scpt" "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/convert.sh"

echo "  ✓ Scripts installed"

# ─── 4. Create working directory ────────────────────────────

echo "[4/5] Creating working directory..."

mkdir -p "$CONVERT_DIR"
echo "  ✓ $CONVERT_DIR created"

# ─── 5. Configure macOS for headless operation ──────────────

echo "[5/5] Configuring headless operation..."

# Prevent sleep
sudo pmset -a sleep 0
sudo pmset -a disksleep 0
sudo pmset -a displaysleep 5
# Restart after power failure
sudo pmset -a autorestart 1
# Wake on network access
sudo pmset -a womp 1

echo "  ✓ Sleep disabled, auto-restart enabled, wake-on-LAN enabled"

# ─── Setup authorized_keys for LXC ──────────────────────────

echo ""
echo "========================================="
echo " Setup Complete!"
echo "========================================="
echo ""
echo "Mac Conversion Server:"
echo "  Install dir:  $INSTALL_DIR"
echo "  Working dir:  $CONVERT_DIR"
echo "  SSH user:     $(whoami)"
echo "  SSH address:  $(ipconfig getifaddr en0 2>/dev/null || echo 'CHECK_IP')"
echo ""
echo "=== NEXT: Setup SSH key from LXC ==="
echo ""
echo "On the LXC (printer-mcp-server), run:"
echo ""
echo "  # Generate SSH key if not exists"
echo "  ssh-keygen -t ed25519 -f /root/.ssh/printer-mcp-mac -N ''"
echo ""
echo "  # Copy public key to Mac"
echo "  ssh-copy-id -i /root/.ssh/printer-mcp-mac.pub $(whoami)@$(ipconfig getifaddr en0 2>/dev/null || echo 'MAC_IP')"
echo ""
echo "  # Test connection"
echo "  ssh -i /root/.ssh/printer-mcp-mac $(whoami)@MAC_IP '/opt/printer-mcp/convert.sh'"
echo ""
echo "=== Test conversion ==="
echo ""
echo "  # Local test (on Mac):"
echo "  /opt/printer-mcp/convert.sh /path/to/test.docx"
echo ""
echo "  # Remote test (from LXC):"
echo "  scp -i KEY test.docx mac@IP:/tmp/printer-mcp-convert/"
echo "  ssh -i KEY mac@IP '/opt/printer-mcp/convert.sh /tmp/printer-mcp-convert/test.docx'"
echo "  scp -i KEY mac@IP:/tmp/printer-mcp-convert/test.pdf ./"
echo ""
echo "=== Recommended: HDMI Dummy Plug ==="
echo ""
echo "  For reliable headless operation, plug in an HDMI dummy adapter."
echo "  Available on Amazon for ~1000 JPY."
echo ""
