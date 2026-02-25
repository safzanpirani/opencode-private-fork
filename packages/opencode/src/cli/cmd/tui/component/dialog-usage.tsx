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
              <Show when={entry.primary}>{(window) => <UsageRow window={window()} />}</Show>
              <Show when={entry.secondary}>{(window) => <UsageRow window={window()} />}</Show>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}

function UsageRow(props: { window: UsageWindow }) {
  const { theme } = useTheme()
  const used = clampPercent(props.window.usedPercent)
  const pace = pacePercent(props.window)
  const overPace = pace !== null && used > pace
  const stateColor = overPace || used >= 90 ? theme.error : theme.warning
  const parts = barParts(used, pace, 24)

  return (
    <text fg={theme.textMuted}>
      <span style={{ fg: theme.textMuted }}>{windowProgress(props.window)}</span>
      <span style={{ fg: stateColor }}> {parts.before}</span>
      <span style={{ fg: pace === null ? stateColor : theme.text }}>{parts.marker}</span>
      <span style={{ fg: stateColor }}>{parts.after}</span>
      <span style={{ fg: stateColor }}> {Math.round(used)}%</span>
    </text>
  )
}

function formatDuration(totalMinutes: number) {
  if (totalMinutes < 60) return `${Math.max(0, Math.round(totalMinutes))}m`
  if (totalMinutes < 24 * 60) return `${(totalMinutes / 60).toFixed(1)}h`
  return `${(totalMinutes / (24 * 60)).toFixed(1)}d`
}

function windowProgress(window: UsageWindow) {
  if (!window.windowMinutes) return "(--/--)"
  if (!window.resetsAt) return `(--/${formatDuration(window.windowMinutes)})`
  const remaining = Math.max(0, (window.resetsAt * 1000 - Date.now()) / 60000)
  return `(${formatDuration(remaining)}/${formatDuration(window.windowMinutes)})`
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
