# OpenCode bootstrap (Windows)

This folder contains ready-to-use OpenCode auth state:

- `auth.json` (OpenAI OAuth)
- `codexswap.json` (CodexSwap profiles: `safzan`, `piranir`)

## Windows setup

1. Find your OpenCode data path:

```powershell
ocx debug paths
```

2. Copy these files into the OpenCode **data** directory shown above:

- `auth.json`
- `codexswap.json`

3. Verify:

```powershell
ocx auth list
```

Then in TUI:

- `/codexswap status`
- `/codexwho`
- `/codexswap use safzan`
- `/codexswap use piranir`

## Notes

- If a profile fails with `refresh_token_reused`, run `ocx auth login openai` and then `/codexswap add <label>` to refresh that profile.
