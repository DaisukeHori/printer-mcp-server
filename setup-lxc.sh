#!/bin/bash
set -euo pipefail

# ============================================================
# printer-mcp-server: LXC Setup Script
# For Proxmox LXC (Ubuntu 22.04/24.04)
# Includes: CUPS + Kyocera UPD Driver (mandatory) + Node.js + MCP Server
#
# Usage:
#   PRINTER_IP=192.168.x.x bash setup-lxc.sh
# ============================================================

PRINTER_IP="${PRINTER_IP:-}"
PRINTER_NAME="${PRINTER_NAME:-Kyocera-TASKalfa-6054ci}"
MCP_API_KEY="${MCP_API_KEY:-pmcp-$(openssl rand -hex 20)}"

# Kyocera Linux UPD Driver v10.0 (official, supports TASKalfa 6054ci)
KYOCERA_DRIVER_URL="https://www.kyoceradocumentsolutions.us/content/dam/download-center-americas-cf/us/drivers/drivers/KyoceraLinuxPackages_20240521_tar_gz.download.gz"
KYOCERA_DRIVER_FILE="/tmp/KyoceraLinuxPackages.tar.gz"

echo "========================================="
echo " printer-mcp-server LXC Setup"
echo "========================================="

if [ -z "$PRINTER_IP" ]; then
  read -rp "Enter the Kyocera TASKalfa 6054ci IP address: " PRINTER_IP
fi

echo ""
echo "Printer IP:    $PRINTER_IP"
echo "Printer Name:  $PRINTER_NAME"
echo "MCP API Key:   $MCP_API_KEY"
echo ""

# ─── 1. System packages ─────────────────────────────────────

echo "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
  cups \
  cups-client \
  cups-bsd \
  cups-filters \
  cups-ipp-utils \
  ghostscript \
  curl \
  wget \
  git \
  build-essential \
  python3 \
  > /dev/null 2>&1

echo "  ✓ System packages installed"

# ─── 2. Install Node.js 22 LTS ──────────────────────────────

echo "[2/7] Installing Node.js 22 LTS..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
echo "  ✓ Node.js $(node -v)"

# ─── 3. Download & Install Kyocera UPD Driver ───────────────

echo "[3/7] Installing Kyocera Linux UPD Driver (mandatory)..."

if [ ! -f "$KYOCERA_DRIVER_FILE" ]; then
  echo "  Downloading Kyocera Linux UPD v10.0 (~251 MB)..."
  wget -q -O "$KYOCERA_DRIVER_FILE" "$KYOCERA_DRIVER_URL" || {
    echo "  ❌ Failed to download Kyocera driver from official URL."
    echo "     Please download manually from:"
    echo "     https://www.kyoceradocumentsolutions.us/en/support/downloads.html"
    echo "     Search for 'TASKalfa 6054ci' → Linux Print Driver"
    echo "     Place the .tar.gz at: $KYOCERA_DRIVER_FILE"
    echo "     Then re-run this script."
    exit 1
  }
fi

echo "  Extracting driver..."
DRIVER_TMP="/tmp/kyocera-driver"
rm -rf "$DRIVER_TMP"
mkdir -p "$DRIVER_TMP"
tar xzf "$KYOCERA_DRIVER_FILE" -C "$DRIVER_TMP" 2>/dev/null || \
  gunzip -c "$KYOCERA_DRIVER_FILE" | tar xf - -C "$DRIVER_TMP" 2>/dev/null || {
    echo "  ❌ Failed to extract driver archive."
    exit 1
  }

# Find and install the .deb package (Ubuntu/Debian 64-bit)
echo "  Looking for .deb installer..."
DEB_FILE=$(find "$DRIVER_TMP" -name "*.deb" -path "*Ubuntu*" -path "*64*" | head -1)
if [ -z "$DEB_FILE" ]; then
  DEB_FILE=$(find "$DRIVER_TMP" -name "*.deb" -path "*Debian*" -path "*64*" | head -1)
fi
if [ -z "$DEB_FILE" ]; then
  DEB_FILE=$(find "$DRIVER_TMP" -name "*.deb" | head -1)
fi

if [ -n "$DEB_FILE" ]; then
  echo "  Installing: $(basename "$DEB_FILE")"
  dpkg -i "$DEB_FILE" 2>/dev/null || apt-get install -f -y -qq > /dev/null 2>&1
  echo "  ✓ Kyocera UPD .deb installed"
else
  # Fallback: Install PPD files directly
  echo "  No .deb found, installing PPD files directly..."
  PPD_DIR="/usr/share/cups/model/Kyocera"
  mkdir -p "$PPD_DIR"

  # Find PPDs matching TASKalfa 6054ci
  PPD_FILE=$(find "$DRIVER_TMP" -iname "*6054*" -name "*.ppd" | head -1)
  if [ -z "$PPD_FILE" ]; then
    # Try English PPD directory
    PPD_FILE=$(find "$DRIVER_TMP" -path "*English*" -name "*.ppd" | head -1)
  fi
  if [ -z "$PPD_FILE" ]; then
    PPD_FILE=$(find "$DRIVER_TMP" -name "*.ppd" | head -1)
  fi

  if [ -n "$PPD_FILE" ]; then
    cp "$PPD_FILE" "$PPD_DIR/"
    # Copy all PPDs for future use
    find "$DRIVER_TMP" -path "*English*" -name "*.ppd" -exec cp {} "$PPD_DIR/" \; 2>/dev/null || true
    echo "  ✓ PPD files copied to $PPD_DIR"
  else
    echo "  ⚠ No PPD files found in the archive. Check driver package."
  fi

  # Copy filter if present
  FILTER_FILE=$(find "$DRIVER_TMP" -name "kyofilter*" -type f | head -1)
  if [ -n "$FILTER_FILE" ]; then
    cp "$FILTER_FILE" /usr/lib/cups/filter/ 2>/dev/null || \
    cp "$FILTER_FILE" /usr/libexec/cups/filter/ 2>/dev/null || true
    chmod +x /usr/lib/cups/filter/kyofilter* 2>/dev/null || true
    echo "  ✓ Kyocera filter installed"
  fi
fi

# ─── 4. Configure CUPS ──────────────────────────────────────

echo "[4/7] Configuring CUPS..."
cupsctl --remote-admin --remote-any --share-printers 2>/dev/null || true

# Enable logging for job tracking
cat >> /etc/cups/cupsd.conf << 'CUPSCFG' 2>/dev/null || true

# Enhanced logging for MCP job tracking
LogLevel info
MaxLogSize 10m
PreserveJobHistory Yes
PreserveJobFiles 1h
CUPSCFG

systemctl enable cups
systemctl restart cups
echo "  ✓ CUPS configured (LogLevel=info, PreserveJobHistory=Yes)"

# ─── 5. Add Kyocera TASKalfa 6054ci printer ─────────────────

echo "[5/7] Adding Kyocera TASKalfa 6054ci printer..."

# Find the specific PPD for 6054ci
INSTALLED_PPD=$(find /usr/share/cups/model -iname "*6054*" -name "*.ppd" 2>/dev/null | head -1)
if [ -z "$INSTALLED_PPD" ]; then
  INSTALLED_PPD=$(find /usr/share/ppd -iname "*6054*" -name "*.ppd" 2>/dev/null | head -1)
fi

if [ -n "$INSTALLED_PPD" ]; then
  echo "  Using PPD: $INSTALLED_PPD"
  lpadmin -p "$PRINTER_NAME" \
    -E \
    -v "ipp://${PRINTER_IP}/ipp/print" \
    -P "$INSTALLED_PPD"
  echo "  ✓ Printer added with Kyocera UPD PPD (full feature support)"
else
  echo "  ⚠ No 6054ci-specific PPD found. Trying IPP Everywhere..."
  lpadmin -p "$PRINTER_NAME" \
    -E \
    -v "ipp://${PRINTER_IP}/ipp/print" \
    -m everywhere 2>/dev/null || {
      echo "  Using generic PostScript as last resort..."
      lpadmin -p "$PRINTER_NAME" \
        -E \
        -v "ipp://${PRINTER_IP}/ipp/print" \
        -m "drv:///sample.drv/generic.ppd"
    }
  echo "  ⚠ Limited features. Manually install PPD later."
fi

# Set as default
lpadmin -d "$PRINTER_NAME" 2>/dev/null || true

# Defaults: A4, duplex
lpoptions -p "$PRINTER_NAME" -o media=A4 2>/dev/null || true
lpoptions -p "$PRINTER_NAME" -o sides=two-sided-long-edge 2>/dev/null || true

# ─── 5b. Configure installable options (finisher etc.) ───────

echo ""
echo "  Configuring finisher/options as installed..."
echo "  (Uncomment the lines matching YOUR hardware configuration)"
echo ""

# These lpadmin -o commands mark hardware as installed in the PPD.
# Uncomment the ones that match your actual finisher configuration:

# lpadmin -p "$PRINTER_NAME" -o KyoFinisher=FinisherDF7120     # DF-7120 (1000-sheet)
# lpadmin -p "$PRINTER_NAME" -o KyoFinisher=FinisherDF7140     # DF-7140 (4000-sheet)
# lpadmin -p "$PRINTER_NAME" -o KyoPunchUnit=Installed          # Punch unit
# lpadmin -p "$PRINTER_NAME" -o KyoZFold=Installed              # Z-fold unit
# lpadmin -p "$PRINTER_NAME" -o KyoBookletFolder=Installed      # Booklet folder
# lpadmin -p "$PRINTER_NAME" -o KyoInserter1=Installed          # Inserter unit 1
# lpadmin -p "$PRINTER_NAME" -o KyoInserter2=Installed          # Inserter unit 2
# lpadmin -p "$PRINTER_NAME" -o KyoInnerFinisher=Installed      # Inner finisher
# lpadmin -p "$PRINTER_NAME" -o KyoPaperFeeder=PF7120           # Paper feeder

echo "  ⚠ Finisher options are commented out by default."
echo "    Edit this section or run lpadmin commands manually."
echo "    Example: lpadmin -p $PRINTER_NAME -o KyoFinisher=FinisherDF7140"
echo "    Then run: systemctl restart cups"

# Verify
echo ""
echo "  Verifying printer..."
if lpstat -p "$PRINTER_NAME" 2>/dev/null | grep -qE "idle|enabled"; then
  echo "  ✓ Printer is online"
else
  echo "  ⚠ Printer may not be reachable. Check IP: $PRINTER_IP"
fi

# Show available options count
OPT_COUNT=$(lpoptions -p "$PRINTER_NAME" -l 2>/dev/null | wc -l)
echo "  Available CUPS options: $OPT_COUNT"

# ─── 6. Build MCP server ────────────────────────────────────

echo "[6/7] Building printer-mcp-server..."
cd /opt

if [ -d printer-mcp-server ]; then
  cd printer-mcp-server && git pull 2>/dev/null || true
else
  git clone "https://github.com/DaisukeHori/printer-mcp-server.git" 2>/dev/null || {
    echo "  ⚠ Git clone failed. Copy project files manually to /opt/printer-mcp-server"
  }
  cd printer-mcp-server
fi

npm install 2>/dev/null
npm run build 2>/dev/null
echo "  ✓ Build complete"

# ─── 7. Systemd service ─────────────────────────────────────

echo "[7/7] Creating systemd service..."

cat > /etc/systemd/system/printer-mcp.service << EOF
[Unit]
Description=Printer MCP Server (Kyocera TASKalfa 6054ci)
After=network.target cups.service
Wants=cups.service

[Service]
Type=simple
WorkingDirectory=/opt/printer-mcp-server
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=PORT=3000
Environment=MCP_API_KEY=${MCP_API_KEY}
Environment=NODE_ENV=production
User=root
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable printer-mcp
systemctl start printer-mcp

echo ""
echo "========================================="
echo " Setup Complete!"
echo "========================================="
echo ""
echo "MCP Server:    http://localhost:3000/mcp"
echo "Health Check:  http://localhost:3000/health"
echo "MCP API Key:   $MCP_API_KEY"
echo "Printer Name:  $PRINTER_NAME"
echo "Printer IP:    $PRINTER_IP"
echo "CUPS Web UI:   http://localhost:631"
echo "CUPS Options:  $OPT_COUNT available"
echo ""
echo "=== IMPORTANT: Finisher Configuration ==="
echo ""
echo "To enable staple/punch/fold/booklet, you MUST configure"
echo "the installed finisher hardware. Run the commands for YOUR setup:"
echo ""
echo "  # 4000-sheet finisher (DF-7140):"
echo "  lpadmin -p $PRINTER_NAME -o KyoFinisher=FinisherDF7140"
echo ""
echo "  # Punch unit:"
echo "  lpadmin -p $PRINTER_NAME -o KyoPunchUnit=Installed"
echo ""
echo "  # Z-fold unit:"
echo "  lpadmin -p $PRINTER_NAME -o KyoZFold=Installed"
echo ""
echo "  # Booklet folder:"
echo "  lpadmin -p $PRINTER_NAME -o KyoBookletFolder=Installed"
echo ""
echo "  # Then restart CUPS:"
echo "  systemctl restart cups"
echo ""
echo "  # Verify new options appeared:"
echo "  lpoptions -p $PRINTER_NAME -l | grep -i 'staple\|punch\|fold\|booklet'"
echo ""
echo "=== Next: Cloudflare Tunnel ==="
echo ""
echo "  printer-mcp.appserver.tokyo → http://localhost:3000"
echo ""
echo "=== Test ==="
echo ""
echo "  curl -s http://localhost:3000/health"
echo ""
echo "  curl -X POST http://localhost:3000/mcp \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H 'Accept: application/json, text/event-stream' \\"
echo "    -H 'Authorization: Bearer $MCP_API_KEY' \\"
echo "    -d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}'"
echo ""
