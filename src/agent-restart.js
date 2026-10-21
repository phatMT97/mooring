// Restart in the existing PTY: only a fresh shell prompt may receive the resume command.
export function createAgentRestarter({ invoke, tabs, hasAgent, distro, app, t, toast,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now }) {
  const fail = (key) => { throw new Error(t(`agent.${key}`)); };

  async function restartAgent(tab, force = false, launcher = null) {
    if (!tab || tabs.get(tab.id) !== tab) fail("noAgent");
    if (tab.shell !== "wsl") fail("wslOnly");
    if (tab.restarting) fail("alreadyRestarting");
    if (!hasAgent(tab) || tab.status === "exited") fail("noAgent");
    if (tab.status === "working" && !force) return { skipped: "busy", id: tab.id };
    if (tab.queued) fail("alreadyRestarting");
    tab.restarting = true;
    try {
      const args = ["resume-cmd", String(tab.id), app];
      if (launcher) args.push(launcher);
      const json = await invoke("agent_tabs", { distro: distro(), args });
      const plan = json ? JSON.parse(json) : null;
      if (plan?.error) fail(plan.error);
      if (!plan?.cmd || !plan.exit || !plan.session) fail("noSession");
      if (tabs.get(tab.id) !== tab || tab.status === "exited") fail("closed");
      // The agent may have started a turn while process inspection was in flight.
      if (tab.status === "working" && !force) return { skipped: "busy", id: tab.id };
      toast(t("agent.draftWarning"));
      const write = (data) => invoke("pty_write", { id: tab.id, data });
      if (tab.status === "working") {
        await write("\x1b");
        await sleep(300);
      }
      if (tabs.get(tab.id) !== tab || tab.status === "exited") fail("closed");
      tab.atPrompt = false;
      // End-of-input, then clear it: /exit must not be appended to an unfinished draft.
      await write("\x05\x15");
      await write(plan.exit + "\r");
      const deadline = now() + 20000;
      while (!tab.atPrompt) {
        if (tabs.get(tab.id) !== tab || tab.status === "exited") fail("closed");
        if (now() >= deadline) fail("promptTimeout");
        await sleep(50);
      }
      if (tabs.get(tab.id) !== tab || tab.status === "exited") fail("closed");
      tab.atPrompt = false;
      await write(plan.cmd + "\r");
      return { id: tab.id, tool: plan.tool, session: plan.session, launcher: plan.launcher };
    } finally {
      tab.restarting = false;
    }
  }

  async function restartAll({ force = false, launcher = null, from = null } = {}) {
    const result = { restarted: [], skippedBusy: 0, skippedSelf: 0, failed: [] };
    const candidates = [...tabs.values()].filter((x) => x.shell === "wsl" && hasAgent(x));
    for (const tab of candidates) {
      if (tab === from) { result.skippedSelf++; continue; }
      try {
        const out = await restartAgent(tab, force, launcher);
        if (out.skipped === "busy") result.skippedBusy++;
        else {
          result.restarted.push(out);
          await sleep(1000);
        }
      } catch (e) {
        result.failed.push({ id: tab.id, error: String(e?.message ?? e) });
      }
    }
    toast(t("agent.restartSummary", { n: result.restarted.length, m: result.skippedBusy, f: result.failed.length }));
    return result;
  }

  return { restartAgent, restartAll };
}
