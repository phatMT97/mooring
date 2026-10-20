// Every theme drives the whole deck: UI layers, the eight repo accents and the terminal's ANSI colours.
// accents[0] doubles as the PowerShell colour, [3] as "needs you", [6] as the WSL colour.

const ansi = (a) => ({
  black: a[0], red: a[1], green: a[2], yellow: a[3], blue: a[4], magenta: a[5], cyan: a[6], white: a[7],
  brightBlack: a[8], brightRed: a[9], brightGreen: a[10], brightYellow: a[11],
  brightBlue: a[12], brightMagenta: a[13], brightCyan: a[14], brightWhite: a[15],
});

export const THEMES = [
  {
    id: "mocha", name: "Mocha", kind: "dark",
    ui: { side: "#11111b", layer: "#181825", raised: "#1e1e2e", text: "#cdd6f4", text2: "#a6adc8", text3: "#7f849c" },
    accents: ["#89b4fa", "#f38ba8", "#a6e3a1", "#f9e2af", "#cba6f7", "#94e2d5", "#fab387", "#f5c2e7"],
    term: { foreground: "#cdd6f4", cursor: "#f5e0dc", selectionBackground: "#585b7099",
      ...ansi(["#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
        "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8"]) },
  },
  {
    id: "tokyo", name: "Tokyo Night", kind: "dark",
    ui: { side: "#13141c", layer: "#1a1b26", raised: "#24283b", text: "#c0caf5", text2: "#a9b1d6", text3: "#737aa2" },
    accents: ["#7aa2f7", "#f7768e", "#9ece6a", "#e0af68", "#bb9af7", "#73daca", "#ff9e64", "#7dcfff"],
    term: { foreground: "#c0caf5", cursor: "#c0caf5", selectionBackground: "#33467c",
      ...ansi(["#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
        "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"]) },
  },
  {
    id: "rose", name: "Rosé Pine", kind: "dark",
    ui: { side: "#13111c", layer: "#191724", raised: "#26233a", text: "#e0def4", text2: "#908caa", text3: "#6e6a86" },
    accents: ["#9ccfd8", "#eb6f92", "#3e8fb0", "#f6c177", "#c4a7e7", "#a3d4c4", "#ebbcba", "#e2a4c8"],
    term: { foreground: "#e0def4", cursor: "#ebbcba", selectionBackground: "#403d52",
      ...ansi(["#26233a", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4",
        "#6e6a86", "#eb6f92", "#3e8fb0", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4"]) },
  },
  {
    id: "nord", name: "Nord", kind: "dark",
    ui: { side: "#242933", layer: "#2e3440", raised: "#3b4252", text: "#eceff4", text2: "#d8dee9", text3: "#8f99ad" },
    accents: ["#88c0d0", "#bf616a", "#a3be8c", "#ebcb8b", "#b48ead", "#8fbcbb", "#d08770", "#81a1c1"],
    term: { foreground: "#d8dee9", cursor: "#d8dee9", selectionBackground: "#434c5e",
      ...ansi(["#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
        "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4"]) },
  },
  {
    id: "gruvbox", name: "Gruvbox", kind: "dark",
    ui: { side: "#1d2021", layer: "#282828", raised: "#32302f", text: "#ebdbb2", text2: "#d5c4a1", text3: "#928374" },
    accents: ["#83a598", "#fb4934", "#b8bb26", "#fabd2f", "#d3869b", "#8ec07c", "#fe8019", "#bdae93"],
    term: { foreground: "#ebdbb2", cursor: "#ebdbb2", selectionBackground: "#504945",
      ...ansi(["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
        "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2"]) },
  },
  {
    id: "midnight", name: "Midnight", kind: "dark",
    ui: { side: "#000000", layer: "#0a0a0a", raised: "#161616", text: "#ededed", text2: "#a1a1a1", text3: "#6e6e6e" },
    accents: ["#3b9eff", "#ff6369", "#3dd68c", "#ffca16", "#9e8cfc", "#0ac5b3", "#ff801f", "#f76ec2"],
    term: { foreground: "#ededed", cursor: "#ffffff", selectionBackground: "#ffffff30",
      ...ansi(["#1f1f1f", "#ff6369", "#3dd68c", "#ffca16", "#3b9eff", "#9e8cfc", "#0ac5b3", "#d4d4d4",
        "#5c5c5c", "#ff8589", "#5ee3a3", "#ffd84d", "#70b8ff", "#b9aefd", "#4fd8c8", "#ffffff"]) },
  },
  {
    id: "neon", name: "Neon", kind: "dark", glow: true,
    ui: { side: "#16121f", layer: "#1c1729", raised: "#2a2140", text: "#f4eefe", text2: "#c3b6dd", text3: "#8a7bab" },
    accents: ["#36f9f6", "#fe4450", "#72f1b8", "#fede5d", "#c792ea", "#03edf9", "#f97e72", "#ff7edb"],
    term: { foreground: "#f4eefe", cursor: "#ff7edb", selectionBackground: "#ff7edb33",
      ...ansi(["#2a2140", "#fe4450", "#72f1b8", "#fede5d", "#36f9f6", "#ff7edb", "#03edf9", "#e0d8f0",
        "#6c5c8f", "#ff6b74", "#9af5cd", "#fee88f", "#7afbf9", "#ffa4e8", "#5ff3fb", "#ffffff"]) },
  },
  {
    id: "latte", name: "Latte", kind: "light",
    ui: { side: "#dce0e8", layer: "#eff1f5", raised: "#f9fafc", text: "#4c4f69", text2: "#6c6f85", text3: "#8c8fa1" },
    accents: ["#1e66f5", "#d20f39", "#40a02b", "#df8e1d", "#8839ef", "#179299", "#fe640b", "#ea76cb"],
    term: { foreground: "#4c4f69", cursor: "#dc8a78", selectionBackground: "#acb0be80",
      ...ansi(["#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be",
        "#6c6f85", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#bcc0cc"]) },
  },
  {
    id: "dawn", name: "Rosé Dawn", kind: "light",
    ui: { side: "#f2e9e1", layer: "#faf4ed", raised: "#fffaf3", text: "#575279", text2: "#797593", text3: "#9893a5" },
    accents: ["#56949f", "#b4637a", "#286983", "#ea9d34", "#907aa9", "#3f8f86", "#d7827e", "#c4789e"],
    term: { foreground: "#575279", cursor: "#d7827e", selectionBackground: "#dfdad9",
      ...ansi(["#f2e9e1", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279",
        "#9893a5", "#b4637a", "#286983", "#ea9d34", "#56949f", "#907aa9", "#d7827e", "#575279"]) },
  },
  {
    id: "paper", name: "Paper", kind: "light",
    ui: { side: "#eef1f4", layer: "#ffffff", raised: "#ffffff", text: "#1f2328", text2: "#59636e", text3: "#818b98" },
    accents: ["#0969da", "#cf222e", "#1a7f37", "#9a6700", "#8250df", "#1b7c83", "#bc4c00", "#bf3989"],
    term: { foreground: "#1f2328", cursor: "#0969da", selectionBackground: "#0969da33",
      ...ansi(["#24292f", "#cf222e", "#116329", "#4d2d00", "#0969da", "#8250df", "#1b7c83", "#6e7781",
        "#57606a", "#a40e26", "#1a7f37", "#633c01", "#218bff", "#a475f9", "#3192aa", "#8c959f"]) },
  },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");

// Push a theme into the CSS custom properties every rule reads.
export function applyTheme(t) {
  const s = document.documentElement.style;
  for (const [k, v] of Object.entries(t.ui)) s.setProperty(`--${k === "text2" ? "text-2" : k === "text3" ? "text-3" : k}`, v);
  s.setProperty("--ink", rgb(t.ui.text)); // hover/stroke overlays are the text colour at low alpha
  s.setProperty("--on-accent", t.kind === "light" ? "#ffffff" : t.ui.side);
  s.setProperty("--ps", t.accents[0]);
  s.setProperty("--needs", t.accents[3]);
  s.setProperty("--danger", t.accents[1]);
  s.setProperty("--primary", t.accents[0]); // the safe choice in a dialog: never a tab's colour, never red
  s.setProperty("--wsl", t.accents[6]);
  s.setProperty("--shadow-a", t.kind === "light" ? ".10" : ".45");
  s.colorScheme = t.kind;
  document.documentElement.dataset.theme = t.id;
  document.documentElement.dataset.kind = t.kind;
}
