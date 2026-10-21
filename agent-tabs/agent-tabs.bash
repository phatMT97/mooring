# agent-tabs: remember which agent session runs in each tab and offer to resume it
# after WSL / Windows Terminal restarts. Sourced at the end of ~/.bashrc.

# Tell Windows Terminal the cwd so "Open windows from a previous session" restores it.
# Not gated on $WT_SESSION: it is unset when WSL is started from the Start menu and handed to WT.
if [[ $- == *i* && -z "$TMUX" && "$TERM_PROGRAM" != vscode ]]; then
  _agent_tabs_osc99() { printf '\e]9;9;%s\e\\' "$(wslpath -w "$PWD")"; }
  case "$PROMPT_COMMAND" in *_agent_tabs_osc99*) ;; *) PROMPT_COMMAND="_agent_tabs_osc99${PROMPT_COMMAND:+; $PROMPT_COMMAND}" ;; esac

  # Tint the whole background per git repo (OSC 11) so torn-off windows are easy to tell
  # apart on Alt+Tab. Pin a colour with lines "<repo-name> #rrggbb" in ~/.config/agent-tabs/tints.
  _AGENT_TABS_TINTS=('#10243a' '#2a1020' '#12301e' '#2e2410' '#241a38' '#0f2e2e' '#321616' '#1f2a10')
  _agent_tabs_tint() {
    [ "$PWD" = "$_agent_tabs_tint_pwd" ] && return
    _agent_tabs_tint_pwd=$PWD
    local root color h
    root=$(git rev-parse --show-toplevel 2>/dev/null)
    [ "$root" = "$_agent_tabs_tint_root" ] && return
    _agent_tabs_tint_root=$root
    # back to the profile colour; explicit because the console host drops OSC 111
    if [ -z "$root" ]; then printf '\e]11;%s\e\\' "${AGENT_TABS_DEFAULT_BG:-#300A24}"; return; fi
    color=$(awk -v r="${root##*/}" '$1 == r { print $2 }' ~/.config/agent-tabs/tints 2>/dev/null)
    if [ -z "$color" ]; then
      h=$(printf %s "$root" | cksum); h=${h%% *}
      color=${_AGENT_TABS_TINTS[h % ${#_AGENT_TABS_TINTS[@]}]}
    fi
    printf '\e]11;%s\e\\' "$color"
  }
  case "$PROMPT_COMMAND" in *_agent_tabs_tint*) ;; *) PROMPT_COMMAND="_agent_tabs_tint; $PROMPT_COMMAND" ;; esac
fi

_agent_tabs_track() {  # $1 = name shown/used for resume, rest = real command
  local launcher=$1; shift
  # Profile functions/aliases may call another wrapped launcher; preserve the outer profile.
  if [[ -n "${_agent_tabs_tracking:-}" ]]; then "$@"; return; fi
  local _agent_tabs_tracking=1
  agent-tabs mark "$$" "$launcher" 2>/dev/null
  "$@"
  local rc=$?
  rm -f "$HOME/.local/state/agent-tabs/run/$$.json"
  return $rc
}

while IFS=$'\t' read -r _at_tool _f; do
  if [[ $_at_tool == JSON ]]; then
    export AGENT_TABS_LAUNCHERS=$_f
    continue
  fi
  if ! declare -F "_agent_tabs_orig_$_f" >/dev/null; then
    if [[ -v BASH_ALIASES[$_f] ]]; then
      # Preserve the alias's options/profile, then route calls through a tracked function.
      _at_alias=${BASH_ALIASES[$_f]}
      unalias "$_f"
      # `alias claude='claude --flag'` refers to the executable, not our new function.
      if [[ $_at_alias == "$_f" || $_at_alias == "$_f "* ]]; then _at_alias="command $_at_alias"; fi
      eval "_agent_tabs_orig_$_f() { $_at_alias \"\$@\"; }"
    elif ! declare -F "$_f" >/dev/null; then
      eval "$_f() { _agent_tabs_track $_f command $_f \"\$@\"; }"
      continue
    else
      [[ $(declare -f "$_f") == *"_agent_tabs_track $_f "* ]] && continue
      eval "$(declare -f "$_f" | sed "1s/^$_f /_agent_tabs_orig_$_f /")"
    fi
    eval "$_f() { _agent_tabs_track $_f _agent_tabs_orig_$_f \"\$@\"; }"
  fi
done < <({ compgen -A function; compgen -A alias; } | agent-tabs launchers --shell)
unset _f _at_tool _at_alias

# On a fresh interactive tab, pick up a session that was cut off in this directory.
if [[ $- == *i* && -t 0 && -z "$BASH_EXECUTION_STRING" && -z "$AGENT_TABS_NO_CLAIM" && -z "$CLAUDECODE" ]]; then
  export AGENT_TABS_NO_CLAIM=1  # only the tab's first shell claims
  IFS=$'\t' read -r _at_kind _at_label _at_cmd < <(agent-tabs claim "$PWD" 2>/dev/null)
  if [ "$_at_kind" = R ]; then
    # auto-resume; any key within 2s cancels
    if read -r -s -n 1 -t 2 -p "$(agent-tabs msg resume_prompt "label=$_at_label" "cmd=$_at_cmd")" _at_ans; then
      agent-tabs msg cancelled
    else
      echo
      history -s "$_at_cmd"; eval "$_at_cmd"
    fi
  elif [ "$_at_kind" = H ]; then
    agent-tabs msg waiting_here "n=$_at_label"
  elif [ "$_at_kind" = N ]; then
    agent-tabs msg leftover "n=$_at_label"
  fi
  unset _at_kind _at_label _at_cmd _at_ans
fi

# Resume a session waiting for this folder later on (e.g. one that was still running elsewhere
# when this tab started and so was skipped at startup).
agent-resume() {
  local kind label cmd
  IFS=$'\t' read -r kind label cmd < <(AGENT_TABS_NO_WAIT=1 agent-tabs claim "$PWD")
  if [ "$kind" = R ]; then
    agent-tabs msg resuming "label=$label" "cmd=$cmd"
    history -s "$cmd"
    eval "$cmd"
  else
    agent-tabs msg none_here "dir=$PWD"
    agent-tabs
  fi
}
