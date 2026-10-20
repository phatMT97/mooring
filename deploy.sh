#!/usr/bin/env bash
# Build and install Mooring on the Windows side. Never closes a running instance unless asked:
# a running exe is renamed to Mooring.old.exe and the new one dropped in, effective on next launch.
#   ./deploy.sh dev [--restart]   test variant (own folder + state, title "Mooring DEV", never claims sessions)
#   ./deploy.sh prod              the daily Mooring (also keeps a Start menu shortcut)
set -euo pipefail
cd "$(dirname "$0")"
mode=${1:-dev}
restart=${2:-}
export PATH=/usr/lib/llvm-18/bin:$HOME/.cargo/bin:$PATH CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-6}
programs=/mnt/c/Users/PhatMT3/AppData/Local/Programs
exe=src-tauri/target/x86_64-pc-windows-msvc/release/termdeck.exe  # the Rust crate keeps its old name
name=Mooring

if [ "$mode" = dev ]; then
  config='{"identifier":"dev.phatmt3.mooring.dev","productName":"Mooring DEV"}'
  folder=Mooring-dev
else
  config='{}'
  folder=Mooring
fi
dest=$programs/$folder

npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle --config "$config" 2>&1 | grep -E '^error|Finished' -A3
mkdir -p "$dest"

ours="Get-Process $name -EA 0 | ? { \$_.Path -like '*\\Programs\\$folder\\*' }"
if [ "$mode" = dev ] && [ "$restart" = --restart ]; then
  powershell.exe -NoProfile -Command "$ours | Stop-Process; Start-Sleep -Milliseconds 800" >/dev/null
fi
rm -f "$dest/$name.old.exe" 2>/dev/null || true
[ -f "$dest/$name.exe" ] && mv "$dest/$name.exe" "$dest/$name.old.exe" 2>/dev/null || true
cp "$exe" "$dest/$name.exe"

if [ "$mode" = prod ]; then
  powershell.exe -NoProfile -Command "\$s = (New-Object -ComObject WScript.Shell).CreateShortcut(\"\$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\$name.lnk\"); \$s.TargetPath = \"\$env:LOCALAPPDATA\\Programs\\$folder\\$name.exe\"; \$s.Save()" >/dev/null
fi

running=$(powershell.exe -NoProfile -Command "@($ours).Count" | tr -d '\r')
if [ "$running" = 0 ] && [ "$mode" = dev ]; then
  powershell.exe -NoProfile -Command "Start-Process \"\$env:LOCALAPPDATA\\Programs\\$folder\\$name.exe\"" >/dev/null
  echo "$mode build installed and started"
elif [ "$running" = 0 ]; then
  echo "$mode build installed"
else
  echo "$mode build installed; the running instance keeps the old version until you restart it"
fi
