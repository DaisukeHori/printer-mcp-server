#!/bin/bash
# convert.sh - Office-to-PDF conversion via AppleScript on macOS
# Called from LXC via: ssh mac@ip '/opt/printer-mcp/convert.sh /path/to/input.docx'
# Output: PDF written to same directory as input, with .pdf extension
# Stdout: JSON result { "success": bool, "output": "path", "error": "msg" }

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT_FILE="${1:-}"

if [ -z "$INPUT_FILE" ]; then
  echo '{"success":false,"output":"","error":"No input file specified"}'
  exit 1
fi

if [ ! -f "$INPUT_FILE" ]; then
  echo "{\"success\":false,\"output\":\"\",\"error\":\"File not found: $INPUT_FILE\"}"
  exit 1
fi

# Determine extension
EXT="${INPUT_FILE##*.}"
EXT_LOWER=$(echo "$EXT" | tr '[:upper:]' '[:lower:]')

# Output path: same dir, same name, .pdf
OUTPUT_DIR="$(dirname "$INPUT_FILE")"
BASENAME="$(basename "$INPUT_FILE" ".$EXT")"
OUTPUT_PDF="${OUTPUT_DIR}/${BASENAME}.pdf"

# Remove existing output if present
rm -f "$OUTPUT_PDF"

convert_with_word() {
  osascript "$SCRIPT_DIR/convert-word.scpt" "$INPUT_FILE" "$OUTPUT_PDF" 2>&1
}

convert_with_excel() {
  osascript "$SCRIPT_DIR/convert-excel.scpt" "$INPUT_FILE" "$OUTPUT_PDF" 2>&1
}

convert_with_powerpoint() {
  osascript "$SCRIPT_DIR/convert-pptx.scpt" "$INPUT_FILE" "$OUTPUT_PDF" 2>&1
}

RESULT=""
case "$EXT_LOWER" in
  doc|docx|docm|dotx|dotm|rtf|odt)
    RESULT=$(convert_with_word)
    ;;
  xls|xlsx|xlsm|xlsb|xltx|csv)
    RESULT=$(convert_with_excel)
    ;;
  ppt|pptx|pptm|ppsx|pps|potx)
    RESULT=$(convert_with_powerpoint)
    ;;
  *)
    echo "{\"success\":false,\"output\":\"\",\"error\":\"Unsupported format: .$EXT_LOWER\"}"
    exit 1
    ;;
esac

# Check if PDF was created
if [ -f "$OUTPUT_PDF" ]; then
  FILE_SIZE=$(stat -f%z "$OUTPUT_PDF" 2>/dev/null || stat -c%s "$OUTPUT_PDF" 2>/dev/null || echo "0")
  echo "{\"success\":true,\"output\":\"$OUTPUT_PDF\",\"size\":$FILE_SIZE,\"error\":\"\"}"
else
  # Escape any quotes in RESULT for JSON safety
  SAFE_RESULT=$(echo "$RESULT" | tr '"' "'" | tr '\n' ' ')
  echo "{\"success\":false,\"output\":\"\",\"error\":\"Conversion failed: $SAFE_RESULT\"}"
  exit 1
fi
