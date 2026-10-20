#!/usr/bin/env bash
# Install agent-tabs: remember which claude/codex/agy session runs in each terminal tab and resume
# it after WSL / Windows restarts. Safe to re-run.
#   Linux side  : symlinks into ~/.local/bin and ~/.config (edits in this repo apply at once)
#   Windows side: copies agent-tabs.ps1 to %LOCALAPPDATA%\agent-tabs (re-run after editing it)
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)

link() { mkdir -p "$(dirname "$2")"; ln -sfn "$1" "$2"; echo "  $2 -> $1"; }

echo "WSL:"
link "$here/agent-tabs" "$HOME/.local/bin/agent-tabs"
link "$here/cc-recent" "$HOME/.local/bin/cc-recent"
link "$here/mooring" "$HOME/.local/bin/mooring"
link "$here/agent-tabs.bash" "$HOME/.config/agent-tabs/agent-tabs.bash"
mkdir -p "$HOME/.config/systemd/user"
cp "$here/systemd/agent-tabs.service" "$here/systemd/agent-tabs.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now agent-tabs.timer >/dev/null
echo "  systemd timer agent-tabs.timer enabled"

if ! grep -q 'agent-tabs/agent-tabs.bash' "$HOME/.bashrc"; then
  printf '\n# agent-tabs: resume claude/codex/agy sessions after WSL restarts (keep last)\n[ -f ~/.config/agent-tabs/agent-tabs.bash ] && . ~/.config/agent-tabs/agent-tabs.bash\n' >> "$HOME/.bashrc"
  echo "  sourced from ~/.bashrc"
fi

# Windows side: only when run under WSL with access to the Windows user profile
if command -v powershell.exe >/dev/null && command -v wslpath >/dev/null; then
  echo "Windows:"
  win() { powershell.exe -NoProfile -Command "$1" | tr -d '\r'; }
  localapp=$(wslpath "$(win '$env:LOCALAPPDATA')")
  mkdir -p "$localapp/agent-tabs"
  cp "$here/agent-tabs.ps1" "$localapp/agent-tabs/agent-tabs.ps1"
  mkdir -p "$localapp/agent-tabs/locales"
  cp "$here"/locales/*.json "$localapp/agent-tabs/locales/"
  echo "  $localapp/agent-tabs/agent-tabs.ps1 (+ locales)"

  profile=$(wslpath "$(win '$PROFILE.CurrentUserCurrentHost')")
  if ! grep -qs 'agent-tabs\\agent-tabs.ps1' "$profile"; then
    mkdir -p "$(dirname "$profile")"
    # UTF-8 with BOM, or Windows PowerShell 5.1 misreads non-ASCII
    { [ -s "$profile" ] || printf '\xef\xbb\xbf'
      printf '%s\r\n' "# agent-tabs: per-repo tint, cwd for Windows Terminal, auto-resume claude/agy after shutdown" \
        "\$agentTabs = Join-Path \$env:LOCALAPPDATA 'agent-tabs\\agent-tabs.ps1'" \
        "if (Test-Path -LiteralPath \$agentTabs) { . \$agentTabs }" \
        "Remove-Variable agentTabs"; } >> "$profile"
    echo "  dot-sourced from $profile"
  fi
  if [ "$(win 'Get-ExecutionPolicy -Scope CurrentUser')" = Undefined ]; then
    win 'Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force'
    echo "  ExecutionPolicy CurrentUser = RemoteSigned (no admin needed)"
  fi
fi
echo "Done. Open a new tab to load it."
