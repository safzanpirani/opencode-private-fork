<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a>
</p>

> [!IMPORTANT]
> This repository includes a custom fork setup focused on Codex usage UX + queue behavior improvements.
> If you're sharing this with a friend, use the quick setup prompt below to make it feel native (single command launch via alias/wrapper).

## Quick fork setup (agent-friendly)

Give the following prompt to any coding agent (or run manually) to set everything up in one shot:

```text
Set up this OpenCode fork so it runs like a native command named `ocx`.

Requirements:
1) Clone this fork to ~/Development/opencode-fork (or keep existing clone if present).
2) Install dependencies with bun.
3) Create executable launcher at ~/.local/bin/ocx that starts OpenCode in the directory where `ocx` is run (unless a path is explicitly passed), while executing from this repo:
   bun run --cwd "<ABSOLUTE_PATH_TO_REPO>/packages/opencode" --conditions=browser src/index.ts "$PWD" "$@"
4) Ensure ~/.local/bin is in PATH (append to shell rc if missing).
5) chmod +x ~/.local/bin/ocx
6) Verify with:
   - command -v ocx
   - ocx --help
7) Print a short success summary and exactly what was changed.

Do not use shell aliases unless explicitly asked. Use an executable wrapper script.
```

### Manual setup (if you prefer)

```bash
# 1) Clone
git clone <YOUR_FORK_URL> ~/Development/opencode-fork

# 2) Install deps
cd ~/Development/opencode-fork
bun install

# 3) Create native launcher command
mkdir -p ~/.local/bin
cat > ~/.local/bin/ocx <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

REPO="$HOME/Development/opencode-fork"

# Default to the directory you run ocx from.
# If the first argument is a positional path/subcommand, keep args unchanged.
if [[ $# -eq 0 || "${1:0:1}" == "-" ]]; then
  exec bun run --cwd "$REPO/packages/opencode" --conditions=browser src/index.ts "$PWD" "$@"
fi

exec bun run --cwd "$REPO/packages/opencode" --conditions=browser src/index.ts "$@"
EOF
chmod +x ~/.local/bin/ocx

# 4) Ensure PATH includes ~/.local/bin
# (example for zsh)
grep -q 'export PATH="$HOME/.local/bin:$PATH"' ~/.zshrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc

# 5) Reload shell and verify
source ~/.zshrc
command -v ocx
ocx --help
```

## Fork-specific features (Codex usage + queue UX)

> [!NOTE]
> This section documents **fork-only behavior** added in this repository. Upstream `anomalyco/opencode` may not include these changes.

### 1) Always-visible Codex usage meters

This fork surfaces Codex usage in three places:

- **Session strip above the prompt** (always visible during chat)
- **Session sidebar → Context → Codex**
- **`/usage` dialog**

What the values mean:

- `(<remaining>/<window>)` format, for example `(1.2h/5.0h)` and `(5.3d/7.0d)`
- `│` inside the bar = expected pace marker for current time in window
- Percent (`23%`) = actual consumed usage
- Colors:
  - warning color = within expected pace
  - error color = usage is ahead of expected pace (higher risk of hitting limit)

### 2) `/usage` command

Show current provider usage snapshot in a dialog:

```bash
/usage
/usage openai
/usage codex
/usage --refresh
```

Notes:

- Default provider is OpenAI/Codex.
- `--refresh` forces a fresh fetch instead of relying on cached state.

### 3) Message queue behavior (fork custom)

This fork supports two queue modes:

- **Enter** → queue/send immediately (default OpenCode behavior)
- **Option/Alt + Enter** → queue for **end of current agent loop** (tail queue)

Tail-queue editing hotkeys:

- **Option/Alt + Up** → load queued tail message into input (newest first)
- **Option/Alt + Down** → move in reverse
- **Enter while editing a queued tail message** → updates that queued item **in place** (keeps original execution order)

A pinned muted preview is shown near the prompt when tail-queued messages exist.

### 4) Quick example

If queued order is:

1. `message 1`
2. `message 2`
3. `message 3`

Edit `message 2` via Option/Alt+Up/Down and press Enter after editing to `message 2xyz`.

Final queue order remains:

1. `message 1`
2. `message 2xyz`
3. `message 3`

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode for latest dev branch
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, or AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

### FAQ

#### How is this different from Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although we recommend the models we provide through [OpenCode Zen](https://opencode.ai/zen), OpenCode can be used with Claude, OpenAI, Google, or even local models. As models evolve, the gaps between them will close and pricing will drop, so being provider-agnostic is important.
- Out-of-the-box LSP support
- A focus on TUI. OpenCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This, for example, can allow OpenCode to run on your computer while you drive it remotely from a mobile app, meaning that the TUI frontend is just one of the possible clients.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
