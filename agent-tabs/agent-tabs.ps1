# agent-tabs (PowerShell side), the counterpart of ~/.config/agent-tabs/agent-tabs.bash in WSL:
#  - tints the whole background per git repo (OSC 11) so torn-off windows are easy to tell apart,
#  - reports the cwd to Windows Terminal (OSC 9;9) so restored tabs reopen in the same folder,
#  - remembers which claude/agy session runs in this tab and auto-resumes it after a shutdown.
# Pin a colour with lines "<repo-name> #rrggbb" in %LOCALAPPDATA%\agent-tabs\tints.

$global:AgentTabsHome = Join-Path $env:LOCALAPPDATA 'agent-tabs'
$global:AgentTabsRun = Join-Path $global:AgentTabsHome 'run'
$global:AgentTabsTints = '#10243a', '#2a1020', '#12301e', '#2e2410', '#241a38', '#0f2e2e', '#321616', '#1f2a10'
$global:AgentTabsEsc = [char]27
$global:AgentTabsDefaultBg = '#0C0C0C'  # Windows Terminal's Campbell scheme
$global:AgentTabsClaudeExe = @("$env:USERPROFILE\.local\bin\claude.exe", 'claude.exe') |
    Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

# ---- background tint + cwd reporting -------------------------------------------------

function global:Get-AgentTabsRepoRoot([string]$Dir) {
    while ($Dir) {
        if (Test-Path -LiteralPath (Join-Path $Dir '.git')) { return $Dir }
        $parent = Split-Path -Parent $Dir
        if (-not $parent -or $parent -eq $Dir) { break }
        $Dir = $parent
    }
    return $null
}

function global:Get-AgentTabsTint([string]$Root) {
    $pins = Join-Path $global:AgentTabsHome 'tints'
    if (Test-Path -LiteralPath $pins) {
        $name = Split-Path -Leaf $Root
        foreach ($line in Get-Content -LiteralPath $pins) {
            $f = -split $line
            if ($f.Count -ge 2 -and $f[0] -eq $name) { return $f[1] }
        }
    }
    $md5 = [Security.Cryptography.MD5]::Create()
    $b = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Root.ToLowerInvariant()))
    return $global:AgentTabsTints[$b[0] % $global:AgentTabsTints.Count]
}

if ($Host.UI.SupportsVirtualTerminal -and -not $global:AgentTabsOrigPrompt) {  # guard: profile may be re-sourced
    $global:AgentTabsOrigPrompt = $function:prompt
    function global:prompt {
        if ($PWD.Provider.Name -eq 'FileSystem') {
            $e = $global:AgentTabsEsc
            $p = $PWD.ProviderPath
            $out = "$e]9;9;$p$e\"
            if ($p -ne $global:AgentTabsTintPwd) {
                $global:AgentTabsTintPwd = $p
                $root = Get-AgentTabsRepoRoot $p
                if ($root -ne $global:AgentTabsTintRoot) {
                    $global:AgentTabsTintRoot = $root
                    # explicit default instead of OSC 111: the console host drops the reset sequence
                    $bg = if ($root) { Get-AgentTabsTint $root } else { $global:AgentTabsDefaultBg }
                    $out += "$e]11;$bg$e\"
                }
            }
            [Console]::Write($out)
        }
        & $global:AgentTabsOrigPrompt
    }
}

# ---- session tracking ----------------------------------------------------------------

function global:Invoke-AgentTabsTracked([string]$Launcher, [string]$Tool, [string]$Exe, [object[]]$Rest, [string]$SessionId) {
    New-Item -ItemType Directory -Force -Path $global:AgentTabsRun | Out-Null
    $marker = Join-Path $global:AgentTabsRun "$PID.json"
    @{
        pid = $PID; procStart = (Get-Process -Id $PID).StartTime.Ticks; launcher = $Launcher; tool = $Tool
        cwd = $PWD.ProviderPath; started = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds(); session_id = $SessionId
    } | ConvertTo-Json -Compress | Set-Content -LiteralPath $marker -Encoding UTF8
    try { & $Exe @Rest }
    finally { Remove-Item -LiteralPath $marker -ErrorAction SilentlyContinue }
}

if ($global:AgentTabsClaudeExe) {
    function global:claude {
        $a = @($args)
        $sid = $null
        if ($a.Count -eq 0) {
            $sid = [guid]::NewGuid().ToString()  # pin the id up front so a restore knows what to resume
            $a = @('--session-id', $sid)
        } elseif ($a.Count -ge 2 -and ($a[0] -eq '-r' -or $a[0] -eq '--resume')) {
            $sid = [string]$a[1]
        }
        Invoke-AgentTabsTracked 'claude' 'claude' $global:AgentTabsClaudeExe $a $sid
    }
}

$global:AgentTabsAgyExe = @("$env:LOCALAPPDATA\agy\bin\agy.exe", 'agy.exe', 'agy') |
    Where-Object { Get-Command $_ -ErrorAction SilentlyContinue } | Select-Object -First 1

if ($global:AgentTabsAgyExe) {
    function global:agy {
        $a = @($args)
        $sid = $null
        $i = [Array]::IndexOf($a, '--conversation')
        if ($i -ge 0 -and $i + 1 -lt $a.Count) { $sid = [string]$a[$i + 1] }
        Invoke-AgentTabsTracked 'agy' 'agy' $global:AgentTabsAgyExe $a $sid
    }
}

function global:Resolve-AgentTabsSession($m) {
    if ($m.session_id) { return $m.session_id }
    $since = [DateTimeOffset]::FromUnixTimeSeconds([long]$m.started - 5).LocalDateTime
    if ($m.tool -eq 'agy') {
        $last = Join-Path $env:USERPROFILE '.gemini\antigravity-cli\cache\last_conversations.json'
        if (Test-Path -LiteralPath $last) {
            try {
                $cache = Get-Content -Raw -LiteralPath $last | ConvertFrom-Json
                $normCwd = $m.cwd.Replace('/', '\').TrimEnd('\')
                foreach ($entry in $cache.PSObject.Properties) {
                    if ($entry.Name.Replace('/', '\').TrimEnd('\') -ieq $normCwd) {
                        $sid = [string]$entry.Value
                        $db = Join-Path $env:USERPROFILE ".gemini\antigravity-cli\conversations\$sid.db"
                        if ($sid -and (Test-Path -LiteralPath $db)) { return $sid }
                    }
                }
            } catch {}
        }
        return $null
    }
    $slug = $m.cwd -replace '[^A-Za-z0-9]', '-'
    $dir = Join-Path $env:USERPROFILE ".claude\projects\$slug"
    if (-not (Test-Path -LiteralPath $dir)) { return $null }
    $f = Get-ChildItem -LiteralPath $dir -Filter *.jsonl | Where-Object { $_.LastWriteTime -ge $since } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($f) { return $f.BaseName }
    return $null
}

function global:Get-AgentTabsPending {
    if (-not (Test-Path -LiteralPath $global:AgentTabsRun)) { return @() }
    $running = $null
    $out = @()
    foreach ($file in Get-ChildItem -LiteralPath $global:AgentTabsRun -Filter *.json) {
        try { $m = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json } catch { continue }
        $p = Get-Process -Id $m.pid -ErrorAction SilentlyContinue
        if ($p -and $p.StartTime.Ticks -eq $m.procStart) { continue }  # its shell is still open
        $m.session_id = Resolve-AgentTabsSession $m
        if ($m.session_id -and $m.tool -eq 'claude' -and
            -not (Get-ChildItem "$env:USERPROFILE\.claude\projects\*\$($m.session_id).jsonl" -ErrorAction SilentlyContinue)) {
            $m.session_id = $null  # opened but never used: nothing to resume
        }
        if ($m.session_id -and $null -eq $running) {
            $procs = @(Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='agy.exe'" -ErrorAction SilentlyContinue)
            $running = ($procs | ForEach-Object { $_.CommandLine }) -join "`n"
        }
        if (-not $m.session_id -or ($running -and $running.Contains($m.session_id))) {
            Remove-Item -LiteralPath $file.FullName -ErrorAction SilentlyContinue
            continue
        }
        $m | Add-Member -NotePropertyName path -NotePropertyValue $file.FullName
        $out += $m
    }
    return $out
}

function global:Get-AgentTabsResumeCommand($m) {
    if ($m.tool -eq 'agy') { return "agy --conversation $($m.session_id) --dangerously-skip-permissions" }
    return "claude --resume $($m.session_id)"
}

function global:agent-resume {
    $here = $PWD.ProviderPath
    $rows = @(Get-AgentTabsPending)
    $claimed = $null
    foreach ($m in ($rows | Sort-Object started)) {
        if ($m.cwd -eq $here -and (Receive-AgentTabsMarker $m)) { $claimed = $m; break }
    }
    if ($claimed) {
        $cmd = Get-AgentTabsResumeCommand $claimed
        $label = if ($claimed.title) { $claimed.title } else { ([string]$claimed.session_id).Substring(0, 8) }
        Write-Host (Get-AgentTabsText 'resuming' @{ label = $label; cmd = $cmd })
        Invoke-Expression $cmd
    } else {
        Write-Host (Get-AgentTabsText 'none_here' @{ dir = $here })
        global:agent-tabs
    }
}

# Messages come from locales\<lang>.json beside this file (copied there by install.sh).
# Language: $env:AGENT_TABS_LANG, else $env:TERMDECK_LANG (set by termdeck), else Windows' UI culture.
# The dictionaries are read once per shell.
function global:Get-AgentTabsText([string]$Key, [hashtable]$Values = @{}) {
    if ($null -eq $global:AgentTabsWords) {
        $dir = Join-Path $env:LOCALAPPDATA 'agent-tabs\locales'
        $codes = @($env:AGENT_TABS_LANG, $env:TERMDECK_LANG, (Get-Culture).TwoLetterISOLanguageName, 'en') |
            Where-Object { $_ } | ForEach-Object { ($_ -split '[-_.]')[0].ToLower() }
        $global:AgentTabsWords = @($codes | Select-Object -Unique | ForEach-Object { Join-Path $dir "$_.json" } |
            Where-Object { Test-Path -LiteralPath $_ } |
            ForEach-Object { Get-Content -LiteralPath $_ -Raw -Encoding UTF8 | ConvertFrom-Json })
    }
    $text = $global:AgentTabsWords | ForEach-Object { $_.$Key } | Where-Object { $_ } | Select-Object -First 1
    if (-not $text) { $text = $Key }
    foreach ($k in $Values.Keys) { $text = $text.Replace('{' + $k + '}', [string]$Values[$k]) }
    return $text
}

function global:Receive-AgentTabsMarker($m) {
    # Atomic: two restored tabs never resume the same session.
    try { [IO.File]::Delete(($m.path + '.claimed')); [IO.File]::Move($m.path, $m.path + '.claimed') } catch { return $false }
    Remove-Item -LiteralPath ($m.path + '.claimed') -ErrorAction SilentlyContinue
    return $true
}

function global:agent-tabs([string]$Command = 'list', [string]$Which) {
    $rows = @(Get-AgentTabsPending)
    if ($rows.Count -eq 0) { Write-Host (Get-AgentTabsText 'none'); return }
    if ($Command -eq 'open') {
        if ($Which) { $rows = $Which.Split(',') | ForEach-Object { $rows[[int]$_ - 1] } }
        foreach ($m in $rows) {
            wt.exe -w 0 new-tab -p '{61c54bbd-c2c6-5271-96e7-009a87ff44bf}' -d $m.cwd
            Start-Sleep -Milliseconds 500  # wt drops tabs when spawned too fast
        }
        return
    }
    $i = 0
    foreach ($m in $rows) {
        $i++
        Write-Host ("{0,2}. [{1}] {2}" -f $i, $m.tool, $m.cwd)
        Write-Host ("    cd '{0}'; {1}" -f $m.cwd, (Get-AgentTabsResumeCommand $m))
    }
}

# ---- on a fresh tab, pick up the session that was cut off in this folder ----------------

# Only a shell opened as a tab (no -Command/-File: scripts calling powershell.exe must not resume agents).
$global:AgentTabsPlainShell = -not ([Environment]::GetCommandLineArgs() | Select-Object -Skip 1 |
    Where-Object { $_ -notmatch '^[-/](nologo|noexit)$' })
if ($global:AgentTabsPlainShell -and $Host.UI.SupportsVirtualTerminal -and -not $env:AGENT_TABS_NO_CLAIM) {
    $env:AGENT_TABS_NO_CLAIM = '1'  # only the tab's first shell claims
    $here = $PWD.ProviderPath
    $rows = @(Get-AgentTabsPending)
    $claimed = $null
    # Only tabs reopened at launch resume on their own; one opened by hand in termdeck just says so.
    $byHand = $env:TERMDECK_TAB -and -not $env:TERMDECK_RESTORING
    $waitingHere = @($rows | Where-Object { $_.cwd -eq $here }).Count
    if (-not $byHand) {
        foreach ($m in ($rows | Sort-Object started)) {
            if ($m.cwd -eq $here -and (Receive-AgentTabsMarker $m)) { $claimed = $m; break }
        }
    }
    if ($claimed) {
        $cmd = Get-AgentTabsResumeCommand $claimed
        $label = if ($claimed.title) { $claimed.title } else { ([string]$claimed.session_id).Substring(0, 8) }
        Write-Host -NoNewline (Get-AgentTabsText 'resume_prompt' @{ label = $label; cmd = $cmd })
        $deadline = (Get-Date).AddSeconds(2)
        $cancel = $false
        while ((Get-Date) -lt $deadline) {
            if ([Console]::KeyAvailable) { [void][Console]::ReadKey($true); $cancel = $true; break }
            Start-Sleep -Milliseconds 50
        }
        if ($cancel) { Write-Host (Get-AgentTabsText 'cancelled') } else { Write-Host ''; Invoke-Expression $cmd }
    } elseif ($byHand -and $waitingHere) {
        Write-Host (Get-AgentTabsText 'waiting_here' @{ n = $waitingHere })
    } elseif ($rows.Count -gt 0) {
        # Restored tabs start together: give the others a few seconds to claim theirs.
        # termdeck marks the tabs it restores, so a tab opened there by hand doesn't wait.
        $wait = if ($env:TERMDECK_TAB -and -not $env:TERMDECK_RESTORING) { 0 } else { 8 }
        $deadline = (Get-Date).AddSeconds($wait)
        while ($rows.Count -gt 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 1; $rows = @(Get-AgentTabsPending) }
        if ($rows.Count -gt 0) { Write-Host (Get-AgentTabsText 'leftover' @{ n = $rows.Count }) }
    }
    Remove-Variable here, rows, claimed -ErrorAction SilentlyContinue
}
