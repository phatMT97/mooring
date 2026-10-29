import contextlib
import importlib.machinery
import io
import json
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest
from unittest.mock import patch, MagicMock


ROOT = Path(__file__).resolve().parents[1]
agent = importlib.machinery.SourceFileLoader("agent_tabs", str(ROOT / "agent-tabs/agent-tabs")).load_module()
cli = importlib.machinery.SourceFileLoader("mooring", str(ROOT / "agent-tabs/mooring")).load_module()


def output(fn, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        fn(*args)
    return json.loads(out.getvalue())


class RestartPlanTests(unittest.TestCase):
    def plan(self, tool="claude", launcher=None, marker="vclaude", sid="session-1"):
        with patch.object(agent, "termdeck_shell", return_value=42), \
                patch.object(agent, "children_map", return_value={}), \
                patch.object(agent, "live_session", return_value=(tool, sid, "/repo")), \
                patch.object(agent, "load", return_value={"launcher": marker,
                    "launchers": {"claude": ["claude", "vclaude", "nclaude", "work-ai"], "codex": ["codex"]}}):
            return output(agent.cmd_resume_cmd, "1", "test.app", launcher)

    def test_preserves_original_launcher(self):
        self.assertEqual(self.plan(), {"tool": "claude", "session": "session-1", "launcher": "vclaude",
                                       "cmd": "vclaude --resume session-1", "exit": "/exit"})

    def test_switches_claude_profiles_and_codex_exit(self):
        self.assertEqual(self.plan(launcher="nclaude")["cmd"], "nclaude --resume session-1")
        self.assertEqual(self.plan(launcher="work-ai")["cmd"], "work-ai --resume session-1")
        codex = self.plan(tool="codex", marker="codex")
        self.assertEqual((codex["cmd"], codex["exit"]), ("codex resume session-1", "/quit"))

    def test_rejects_unknown_and_cross_tool_launchers(self):
        for tool, launcher in [("claude", "codex"), ("codex", "vclaude"), ("claude", "missing"),
                               ("claude", "claude; echo oops")]:
            self.assertEqual(self.plan(tool=tool, launcher=launcher)["error"], "invalidLauncher")

    def test_unsupported_and_missing_session(self):
        self.assertEqual(self.plan(tool="agy")["error"], "unsupported")
        self.assertEqual(self.plan(sid=None)["error"], "noSession")

    def test_session_id_is_one_shell_argument(self):
        sid = "session; touch /tmp/should-not-exist"
        self.assertEqual(shlex.split(self.plan(sid=sid)["cmd"]), ["vclaude", "--resume", sid])


class IdentityTests(unittest.TestCase):
    def test_running_identifies_tools_and_filters_other_apps(self):
        with patch.object(agent.glob, "glob", return_value=[f"/proc/{i}/comm" for i in range(1, 5)]), \
                patch.object(agent, "markers", return_value=iter([("marker", {
                    "termdeck_tab": "1", "termdeck_app": "test", "launcher": "vclaude"})])), \
                patch.object(agent, "alive", return_value=True), \
                patch.object(agent, "running", return_value=True), \
                patch.object(agent, "proc_comm", side_effect=lambda pid: ["claude", "codex", "agy", "claude"][pid - 1]), \
                patch.object(agent, "proc_env", side_effect=lambda pid: {
                    "TERMDECK_TAB": str(pid), "TERMDECK_APP": "other" if pid == 4 else "test"}):
            self.assertEqual(output(agent.cmd_running, "test"), [
                {"tab": "1", "tool": "claude", "launcher": "vclaude", "launchers": ["vclaude"], "session": None, "title": None},
                {"tab": "2", "tool": "codex", "launcher": "codex", "launchers": ["codex"], "session": None, "title": None},
                {"tab": "3", "tool": "agy", "launcher": "agy", "launchers": ["agy"], "session": None, "title": None}])


class DiscoveryTests(unittest.TestCase):
    def test_discovery_includes_only_available_names_and_configured_shortcuts(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "launchers.json"
            config.write_text(json.dumps({"claude": ["cc", "not-installed"], "codex": ["cx"]}))
            with patch.object(agent, "LAUNCHER_CONFIG", str(config)), \
                    patch.object(agent, "path_launchers", return_value=set()), \
                    patch.object(agent.sys, "stdin", io.StringIO("claude\nvclaude\ncc\ncx\nwork-codex\nls\n_agent_tabs_orig_claude\n")):
                self.assertEqual(output(agent.cmd_launchers), {
                    "claude": ["cc", "claude", "vclaude"], "codex": ["cx", "work-codex"], "agy": []})

    def test_catalog_rejects_command_fragments_and_canonical_tool_remapping(self):
        catalog = agent.launcher_catalog({"claude": ["cc", "codex", "claude --flag", "x;echo", 3],
                                          "codex": ["codex", "cc"], "agy": "bad"})
        self.assertEqual(catalog, {"claude": ["cc"], "codex": ["codex"], "agy": []})
        self.assertEqual(agent.launcher_catalog("not json"), {"claude": [], "codex": [], "agy": []})

    def test_executable_detection_skips_non_executables_and_unrelated_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            for name, mode in [("vclaude", 0o755), ("nclaude", 0o644), ("cc", 0o755), ("other", 0o755)]:
                p = Path(tmp) / name
                p.write_text("#!/bin/sh\n")
                p.chmod(mode)
            with patch.dict(agent.os.environ, {"PATH": tmp}):
                self.assertEqual(agent.path_launchers({"cc": "claude"}), {"cc", "vclaude"})

    def test_original_custom_launcher_in_old_marker_stays_resumable(self):
        self.assertEqual(agent.launcher_options({"launcher": "work-ai"}, "claude"), ["work-ai"])

    def test_mark_records_catalog_and_tool_for_custom_launchers(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(agent, "RUN", tmp), \
                patch.dict(agent.os.environ, {"AGENT_TABS_LAUNCHERS": '{"codex": ["cx"]}'}):
            agent.cmd_mark(42, "cx")
            marker = agent.load(str(Path(tmp) / "42.json"))
            self.assertEqual(marker["tool"], "codex")
            self.assertEqual(marker["launchers"]["codex"], ["cx"])


class CliTests(unittest.TestCase):
    def test_restart_parsing(self):
        with patch.object(cli, "ask", return_value={}) as ask, contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            cli.cmd_restart(["other", "--force", "--launcher", "vclaude"])
            ask.assert_called_once_with("restart", timeout=60, tab="other", all=False, force=True, launcher="vclaude")

    def test_cli_accepts_custom_launcher_names(self):
        with patch.object(cli, "ask", return_value={}) as ask, contextlib.redirect_stdout(io.StringIO()), \
                contextlib.redirect_stderr(io.StringIO()):
            cli.cmd_restart(["other", "--launcher", "work-ai"])
            self.assertEqual(ask.call_args.kwargs["launcher"], "work-ai")

    def test_batch_timeout_scales_with_tabs(self):
        with patch.object(cli, "ask", side_effect=[{"tabs": [1, 2, 3]}, {}]) as ask, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            cli.cmd_restart(["--all"])
            self.assertEqual(ask.call_args.kwargs["timeout"], 90)

    def test_invalid_args_never_send_restart(self):
        for args in [[], ["1", "--all"], ["--all", "--launcher", "agy --flag"], ["1", "--unknown"]]:
            with patch.object(cli, "ask") as ask, contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.cmd_restart(args)
                ask.assert_not_called()


class WrapperTests(unittest.TestCase):
    def test_plain_and_profile_launchers_recreate_and_remove_markers(self):
        # Redirect only the wrapper's marker operations into a temporary fixture directory.
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp) / "wrapper.bash"
            script.write_text((ROOT / "agent-tabs/agent-tabs.bash").read_text().replace(
                '$HOME/.local/state/agent-tabs/run', tmp))
            plain = Path(tmp) / "nclaude"
            plain.write_text('#!/bin/bash\ntest "$(cat "$fixture/$PPID.json")" = nclaude\n')
            plain.chmod(0o755)
            (Path(tmp) / "agent-tabs").mkdir()
            (Path(tmp) / "agent-tabs" / "launchers.json").write_text('{"claude": ["cc", "work-ai"]}')
            test_script = r'''
agent-tabs() {
  if [[ $1 == mark ]]; then printf '%s' "$3" > "$fixture/$$.json"; else "$helper" "$@"; fi
}
claude() { test "$(cat "$fixture/$$.json")" = "$expected"; }
vclaude() { test "$(cat "$fixture/$$.json")" = "$expected"; }
work-ai() { claude "$@"; }
alias cc='claude --profile work'
alias nclaude='nclaude --profile test'
source "$wrapper"
source "$wrapper"
expected=claude
claude --resume session-1 || exit 10
test ! -e "$fixture/$$.json" || exit 11
expected=vclaude
vclaude --resume session-1 || exit 12
test ! -e "$fixture/$$.json" || exit 13
declare -f _agent_tabs_orig_nclaude | grep -q 'command nclaude --profile test' || exit 14
nclaude --resume session-1 || exit 15
test ! -e "$fixture/$$.json" || exit 16
expected=work-ai
work-ai --resume session-1 || exit 17
test ! -e "$fixture/$$.json" || exit 18
expected=cc
cc --resume session-1 || exit 19
test ! -e "$fixture/$$.json" || exit 20
declare -F nowhereclaude >/dev/null && exit 21
exit 0
'''
            subprocess.run(["bash", "--noprofile", "--norc", "-c",
                            'export fixture=$1; wrapper=$2; helper=$3; export PATH="$fixture:$PATH" XDG_CONFIG_HOME="$fixture" TERMDECK_TAB=test\n' + test_script,
                            "test", tmp, str(script), str(ROOT / "agent-tabs/agent-tabs")], check=True, timeout=5)


class ProcessIntegrationTests(unittest.TestCase):
    def test_real_process_lookup_keeps_tab_session_and_launcher(self):
        # A fake Claude publishes the same session metadata as the live-session reader expects.
        # Its parent shell survives both launches; no existing terminal/session is touched.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "sessions").mkdir()
            (root / "run").mkdir()
            fake = root / "fake.py"
            fake.write_text('''import ctypes,json,os,sys
ctypes.CDLL(None).prctl(15, b"claude", 0, 0, 0)
path = os.path.join(os.environ["CLAUDE_CONFIG_DIR"], "sessions", str(os.getpid()) + ".json")
with open(path, "w") as f: json.dump({"sessionId": "same-session", "cwd": os.getcwd()}, f)
print("ready", flush=True)
sys.stdin.readline()
''')
            import os
            env = dict(os.environ, TERMDECK_TAB="987654", TERMDECK_APP="mooring.restart.test",
                       CLAUDE_CONFIG_DIR=tmp)
            # Read two commands in a single shell to exercise lookup across an exit/resume.
            shell = subprocess.Popen(["bash", "--noprofile", "--norc", "-c",
                                      'for i in 1 2; do python3 "$1"; done', "test", str(fake)],
                                     env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                with patch.object(agent, "RUN", str(root / "run")):
                    marker = {"shell_pid": shell.pid, "boot": agent.boot_id(), "launcher": "vclaude",
                              "termdeck_tab": "987654", "termdeck_app": "mooring.restart.test"}
                    agent.save(str(root / "run" / f"{shell.pid}.json"), marker)
                    for _ in range(2):
                        self.assertEqual(shell.stdout.readline().strip(), "ready")
                        plan = output(agent.cmd_resume_cmd, "987654", "mooring.restart.test")
                        self.assertEqual(plan["session"], "same-session")
                        self.assertEqual(plan["cmd"], "vclaude --resume same-session")
                        identities = output(agent.cmd_running, "mooring.restart.test")
                        self.assertEqual(identities, [{"tab": "987654", "tool": "claude", "launcher": "vclaude",
                                                      "launchers": ["vclaude"], "session": "same-session", "title": None}])
                        shell.stdin.write("/exit\n")
                        shell.stdin.flush()
                    shell.wait(timeout=5)
            finally:
                if shell.poll() is None:
                    shell.terminate()
                    shell.wait(timeout=5)
                shell.stdin.close()
                shell.stdout.close()


class PreserveAndClaimTests(unittest.TestCase):
    def test_preserve_restores_claimed_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "run"
            claimed_dir = Path(tmp) / "claimed"
            run_dir.mkdir()
            claimed_dir.mkdir()
            with patch.object(agent, "RUN", str(run_dir)), patch.object(agent, "CLAIMED", str(claimed_dir)):
                marker_path = str(run_dir / "123.json")
                agent.save(marker_path, {"session_id": "sid-abc", "title": "Test Task", "cwd": "/repo", "tool": "codex", "launcher": "codex"})
                # take it
                self.assertTrue(agent.take(marker_path))
                self.assertFalse(Path(marker_path).exists())
                self.assertTrue((claimed_dir / "sid-abc.json").exists())
                # preserve it back
                agent.cmd_preserve("sid-abc")
                preserved = run_dir / "preserved_sid-abc.json"
                self.assertTrue(preserved.exists())
                loaded = agent.load(str(preserved))
                self.assertEqual(loaded["session_id"], "sid-abc")
                self.assertEqual(loaded["title"], "Test Task")

    def test_claim_prioritizes_termdeck_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "run"
            claimed_dir = Path(tmp) / "claimed"
            run_dir.mkdir()
            claimed_dir.mkdir()
            with patch.object(agent, "RUN", str(run_dir)), patch.object(agent, "CLAIMED", str(claimed_dir)), \
                    patch.object(agent, "alive", return_value=False), \
                    patch.object(agent, "left_behind", return_value=True):
                now = agent.time.time()
                agent.save(str(run_dir / "1.json"), {"session_id": "sid-1", "cwd": "/repo", "tool": "codex", "launcher": "codex", "started": now})
                agent.save(str(run_dir / "2.json"), {"session_id": "sid-2", "cwd": "/repo", "tool": "codex", "launcher": "codex", "started": now + 10})
                with patch.dict(agent.os.environ, {"TERMDECK_TAB": "10", "TERMDECK_RESTORING": "1", "TERMDECK_SESSION": "sid-1"}):
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        agent.cmd_claim("/repo")
                    parts = out.getvalue().strip().split("\t")
                    self.assertEqual(parts[0], "R")
                    self.assertEqual(parts[3], "sid-1")
                    self.assertEqual(parts[4], "codex")

    def test_claim_with_termdeck_session_by_hand(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "run"
            claimed_dir = Path(tmp) / "claimed"
            run_dir.mkdir()
            claimed_dir.mkdir()
            with patch.object(agent, "RUN", str(run_dir)), patch.object(agent, "CLAIMED", str(claimed_dir)), \
                    patch.object(agent, "alive", return_value=False), \
                    patch.object(agent, "left_behind", return_value=True):
                now = agent.time.time()
                agent.save(str(run_dir / "1.json"), {"session_id": "sid-target", "cwd": "/repo", "tool": "codex", "launcher": "codex", "started": now})
                # Not restoring, opened by hand: should still take sid-target directly
                with patch.dict(agent.os.environ, {"TERMDECK_TAB": "10", "TERMDECK_SESSION": "sid-target"}, clear=True):
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        agent.cmd_claim("/repo")
                    parts = out.getvalue().strip().split("\t")
                    self.assertEqual(parts[0], "R")
                    self.assertEqual(parts[3], "sid-target")

    def test_claim_with_target_session_does_not_steal_unrelated(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp) / "run"
            claimed_dir = Path(tmp) / "claimed"
            run_dir.mkdir()
            claimed_dir.mkdir()
            with patch.object(agent, "RUN", str(run_dir)), patch.object(agent, "CLAIMED", str(claimed_dir)), \
                    patch.object(agent, "alive", return_value=False), \
                    patch.object(agent, "left_behind", return_value=True):
                now = agent.time.time()
                agent.save(str(run_dir / "1.json"), {"session_id": "sid-other", "cwd": "/repo", "tool": "codex", "launcher": "codex", "started": now})
                with patch.dict(agent.os.environ, {"TERMDECK_TAB": "10", "TERMDECK_SESSION": "sid-nonexistent", "TERMDECK_RESTORING": "1", "AGENT_TABS_NO_WAIT": "1"}, clear=True):
                    out = io.StringIO()
                    with contextlib.redirect_stdout(out):
                        agent.cmd_claim("/repo")
                    # Should NOT have claimed sid-other
                    self.assertFalse(out.getvalue().startswith("R\t"))
                    self.assertFalse((claimed_dir / "sid-other.json").exists())

    def test_cmd_running_ignores_codex_daemon(self):
        with patch.object(agent, "glob", MagicMock(glob=lambda p: ["/proc/5014/comm"])), \
                patch.object(agent, "proc_comm", return_value="codex"), \
                patch.object(agent, "running", return_value=True), \
                patch.object(agent, "proc_cmdline", return_value=["codex", "app-server", "--managed-daemon"]), \
                patch.object(agent, "proc_env", return_value={"TERMDECK_TAB": "56", "TERMDECK_APP": "dev.mooring"}):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                agent.cmd_running("dev.mooring")
            self.assertEqual(out.getvalue().strip(), "[]")

    def test_cmd_freeze_ignores_daemon(self):
        with patch.object(agent, "markers", return_value=[("1.json", {"shell_pid": 100, "termdeck_tab": "1", "termdeck_app": "app"})]), \
                patch.object(agent, "alive", return_value=True), \
                patch.object(agent, "children_map", return_value={100: [200]}), \
                patch.object(agent, "proc_cmdline", side_effect=lambda pid: ["codex", "app-server", "--managed-daemon"] if pid == 200 else ["bash"]), \
                patch.object(agent.os, "kill") as mock_kill:
            agent.cmd_freeze("1", "app")
            mock_kill.assert_called_once_with(100, agent.signal.SIGSTOP)

    def test_auto_resume_ignores_mouse_tracking_escape_sequences(self):
        import pty, os, subprocess, tempfile, select, time
        master, slave = pty.openpty()
        with tempfile.TemporaryDirectory() as td:
            fake_bin = Path(td) / "bin"
            fake_bin.mkdir()
            fake_at = fake_bin / "agent-tabs"
            fake_at.write_text(
                "#!/bin/bash\n"
                "case \"$1\" in\n"
                "  claim) printf \"R\\tTestSession\\techo RESUMED_OK\\tsid-123\\tcodex\\n\" ;;\n"
                "  msg) shift; case \"$1\" in\n"
                "    resume_prompt) echo -n \"Reopen prompt \" ;;\n"
                "    cancelled) echo \"cancelled\" ;;\n"
                "  esac ;;\n"
                "  launchers) printf \"JSON\\t{}\\ncodex\\tcodex\\n\" ;;\n"
                "esac\n"
            )
            fake_at.chmod(0o755)
            env = os.environ.copy()
            env.pop("AGENT_TABS_NO_CLAIM", None)
            env.pop("BASH_EXECUTION_STRING", None)
            env["TERMDECK_TAB"] = "1"
            env["PATH"] = f"{fake_bin}:{env.get('PATH', '')}"
            bash_script = Path(__file__).parent.parent / "agent-tabs" / "agent-tabs.bash"

            p = subprocess.Popen(["bash", "--rcfile", str(bash_script), "-i"],
                                 stdin=slave, stdout=slave, stderr=slave, env=env, preexec_fn=os.setsid)
            time.sleep(0.2)
            # Send SGR mouse tracking events during prompt
            os.write(master, b"\x1b[<35;5;32M\x1b[<35;7;32M")
            time.sleep(2.3)
            os.write(master, b"exit\n")
            out = b""
            while True:
                r, _, _ = select.select([master], [], [], 0.3)
                if not r:
                    break
                try:
                    chunk = os.read(master, 1024)
                    if not chunk:
                        break
                    out += chunk
                except Exception:
                    break
            os.close(master)
            os.close(slave)
            p.kill()
            self.assertIn("RESUMED_OK", out.decode(errors="ignore"))


if __name__ == "__main__":
    unittest.main()
