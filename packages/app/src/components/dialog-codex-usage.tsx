import { createMemo, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tag } from "@opencode-ai/ui/tag"

export type CodexAccount = {
  current: {
    id: string | null
    label: string | null
    email: string | null
    accountId: string | null
  } | null
  profiles: {
    id: string
    label: string
    email: string | null
    accountId: string | null
    active: boolean
  }[]
  usage: {
    limitId: string | null
    limitName: string | null
    primary: {
      usedPercent: number
      windowDurationMins: number | null
      resetsAt: number | null
    } | null
    secondary: {
      usedPercent: number
      windowDurationMins: number | null
      resetsAt: number | null
    } | null
    planType: string | null
  } | null
  error?: string
}

function label(input: { label: string | null; email: string | null; accountId: string | null } | null) {
  if (!input) return "Not connected"
  return input.label ?? input.email ?? input.accountId ?? "Unnamed account"
}

function meter(value: number | null | undefined) {
  if (value === null || value === undefined) return 0
  return Math.max(0, Math.min(100, value))
}

function windowLabel(input: { windowDurationMins: number | null; resetsAt: number | null }) {
  const parts = [] as string[]
  if (input.windowDurationMins) parts.push(`${input.windowDurationMins}m window`)
  if (input.resetsAt) parts.push(`resets ${new Date(input.resetsAt).toLocaleString()}`)
  return parts.join(" · ")
}

function UsageRow(props: {
  title: string
  value: { usedPercent: number; windowDurationMins: number | null; resetsAt: number | null } | null
}) {
  return (
    <Show when={props.value}>
      {(value) => (
        <div class="flex flex-col gap-2 rounded-lg border border-border-base bg-surface-base p-3">
          <div class="flex items-center justify-between gap-3">
            <span class="text-13-medium text-text-strong">{props.title}</span>
            <span class="text-12-medium text-text-weak">{meter(value().usedPercent)}%</span>
          </div>
          <div class="h-2 overflow-hidden rounded-full bg-surface-raised-base">
            <div class="h-full rounded-full bg-icon-info-active" style={{ width: `${meter(value().usedPercent)}%` }} />
          </div>
          <Show when={windowLabel(value())}>
            {(text) => <span class="text-12-regular text-text-weak">{text()}</span>}
          </Show>
        </div>
      )}
    </Show>
  )
}

export function DialogCodexUsage(props: { data: CodexAccount }) {
  const plan = createMemo(() => props.data.usage?.planType ?? props.data.usage?.limitName ?? "Unknown plan")

  return (
    <Dialog title="Codex" size="large" transition>
      <div class="flex flex-col gap-4 p-1">
        <Show when={props.data.error}>
          {(err) => (
            <div class="rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-13-regular text-text-strong">
              {err()}
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2 rounded-lg border border-border-base bg-surface-base p-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-12-medium uppercase tracking-wide text-text-weak">Current account</div>
              <div class="text-14-medium text-text-strong">{label(props.data.current)}</div>
            </div>
            <Tag>{plan()}</Tag>
          </div>
          <Show when={props.data.current?.email && props.data.current?.label !== props.data.current?.email}>
            <div class="text-13-regular text-text-weak">{props.data.current?.email}</div>
          </Show>
          <Show when={props.data.current?.accountId}>
            <div class="text-12-regular text-text-subtle">Account ID: {props.data.current?.accountId}</div>
          </Show>
        </div>

        <Show when={props.data.usage}>
          {(usage) => (
            <div class="grid gap-3 md:grid-cols-2">
              <UsageRow title="Primary usage" value={usage().primary} />
              <UsageRow title="Secondary usage" value={usage().secondary} />
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2 rounded-lg border border-border-base bg-surface-base p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="text-12-medium uppercase tracking-wide text-text-weak">Saved profiles</div>
            <div class="text-12-regular text-text-weak">
              {props.data.profiles.length} profile{props.data.profiles.length === 1 ? "" : "s"}
            </div>
          </div>
          <Show
            when={props.data.profiles.length > 0}
            fallback={<div class="text-13-regular text-text-weak">No saved Codex profiles yet.</div>}
          >
            <div class="flex flex-col gap-2">
              <For each={props.data.profiles}>
                {(item) => (
                  <div class="flex items-center justify-between gap-3 rounded-lg border border-border-base px-3 py-2">
                    <div class="min-w-0">
                      <div class="truncate text-13-medium text-text-strong">{label(item)}</div>
                      <Show when={item.email && item.label !== item.email}>
                        <div class="truncate text-12-regular text-text-weak">{item.email}</div>
                      </Show>
                    </div>
                    <Show when={item.active}>
                      <Tag>Active</Tag>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
