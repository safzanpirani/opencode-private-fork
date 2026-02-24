import { TextAttributes } from "@opentui/core"
import { For, Show } from "solid-js"
import { useTheme } from "../context/theme"

type UsageWindow = {
  usedPercent: number
  windowMinutes: number | null
  resetsAt: number | null
}

export type UsageEntry = {
  provider: string
  displayName: string
  planType: string | null
  primary: UsageWindow | null
  secondary: UsageWindow | null
}

export function DialogUsage(props: { entries: UsageEntry[] }) {
  const { theme } = useTheme()

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} flexDirection="column">
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <Show when={props.entries.length > 0} fallback={<text fg={theme.textMuted}>No usage data available.</text>}>
        <For each={props.entries}>
          {(entry) => (
            <box gap={1}>
              <text fg={theme.text}>
                <b>{entry.displayName}</b>
                <span style={{ fg: theme.textMuted }}>{entry.planType ? ` · ${entry.planType}` : ""}</span>
              </text>
              <Show when={entry.primary}>{(window) => <UsageRow label={windowLabel(window().windowMinutes, "primary")} window={window()} />}</Show>
              <Show when={entry.secondary}>{(window) => <UsageRow label={windowLabel(window().windowMinutes, "secondary")} window={window()} />}</Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

function UsageRow(props: { label: string; window: UsageWindow }) {
  const { theme } = useTheme()
  const percent = clampPercent(props.window.usedPercent)
  const warn = percent >= 90
  return (
    <text fg={theme.textMuted}>
      <span style={{ fg: theme.text }}>{props.label}</span>
      <span style={{ fg: warn ? theme.error : theme.warning }}> {bar(percent)}</span>
      <span style={{ fg: warn ? theme.error : theme.warning }}> {Math.round(percent)}%</span>
      <span style={{ fg: theme.textMuted }}> · resets {resetLabel(props.window.resetsAt)}</span>
    </text>
  )
}

function windowLabel(windowMinutes: number | null, fallback: "primary" | "secondary") {
  if (!windowMinutes) return fallback === "primary" ? "Primary" : "Secondary"
  if (windowMinutes >= 24 * 60) return `${Math.max(1, Math.round(windowMinutes / (24 * 60)))}d`
  if (windowMinutes >= 60) return `${Math.max(1, Math.round(windowMinutes / 60))}h`
  return `${Math.max(1, Math.round(windowMinutes))}m`
}

function resetLabel(resetAt: number | null) {
  if (!resetAt) return "--"
  const remaining = resetAt - Math.floor(Date.now() / 1000)
  if (remaining <= 0) return "now"
  if (remaining < 3600) return `${Math.max(1, Math.round(remaining / 60))}m`
  if (remaining < 24 * 3600) return `${Math.max(1, Math.round(remaining / 3600))}h`
  return `${Math.max(1, Math.round(remaining / (24 * 3600)))}d`
}

function bar(usedPercent: number, width = 18) {
  const used = Math.round((usedPercent / 100) * width)
  return `${"█".repeat(Math.max(0, used))}${"░".repeat(Math.max(0, width - used))}`
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}
