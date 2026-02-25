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
  const used = clampPercent(props.window.usedPercent)
  const pace = pacePercent(props.window)
  const overPace = pace !== null && used > pace
  const stateColor = overPace || used >= 90 ? theme.error : theme.warning
  const parts = barParts(used, pace, 18)

  return (
    <text fg={theme.textMuted}>
      <span style={{ fg: theme.text }}>{props.label}</span>
      <span style={{ fg: stateColor }}> {parts.before}</span>
      <span style={{ fg: pace === null ? stateColor : theme.text }}>{parts.marker}</span>
      <span style={{ fg: stateColor }}>{parts.after}</span>
      <span style={{ fg: stateColor }}> {Math.round(used)}%</span>
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

function barParts(usedPercent: number, pacePercent: number | null, width: number) {
  const span = Math.max(6, width)
  const used = Math.round((usedPercent / 100) * span)
  const chars = Array.from({ length: span }, (_, i) => (i < used ? "━" : "─"))
  if (pacePercent === null) {
    return {
      before: chars.join(""),
      marker: "",
      after: "",
    }
  }

  const markerIndex = Math.max(0, Math.min(span - 1, Math.round((pacePercent / 100) * (span - 1))))
  return {
    before: chars.slice(0, markerIndex).join(""),
    marker: "│",
    after: chars.slice(markerIndex + 1).join(""),
  }
}

function pacePercent(window: UsageWindow) {
  if (!window.windowMinutes || !window.resetsAt) return null
  const total = Math.max(1, window.windowMinutes)
  const remaining = Math.max(0, (window.resetsAt * 1000 - Date.now()) / 60000)
  const elapsed = Math.max(0, Math.min(total, total - remaining))
  return clampPercent((elapsed / total) * 100)
}

function clampPercent(value: number) {
  if (Number.isNaN(value)) return 0
  if (value < 0) return 0
  if (value > 100) return 100
  return value
}
