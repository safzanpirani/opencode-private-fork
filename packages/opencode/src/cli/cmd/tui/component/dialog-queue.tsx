import { createMemo, createSignal } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"

function preview(input: string) {
  const line = input.replace(/\s+/g, " ").trim()
  if (line.length <= 80) return line
  return line.slice(0, 77) + "..."
}

export function DialogQueue(props: {
  items: () => {
    id: string
    inputText: string
    agent: string
    model: { providerID: string; modelID: string }
    variant?: string
  }[]
  current?: () => string | undefined
  status: string
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  const dialog = useDialog()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const [drop, setDrop] = createSignal<string>()

  const options = createMemo(() => {
    return props.items().map((item, index) => {
      const active = drop() === item.id
      const model = `${item.model.providerID}/${item.model.modelID}`
      const variant = item.variant ? ` · ${item.variant}` : ""
      return {
        title: active
          ? `Press ${keybind.print("stash_delete")} again to confirm`
          : `${index + 1}. ${preview(item.inputText)}`,
        value: item.id,
        description: `${item.agent} · ${model}${variant}`,
        footer: item.id === props.current?.() ? "editing" : undefined,
        bg: active ? theme.error : undefined,
      }
    })
  })

  return (
    <DialogSelect
      title={`Queue ${props.status}`}
      options={options()}
      current={props.current?.()}
      onMove={() => {
        setDrop(undefined)
      }}
      onSelect={(option) => {
        props.onSelect(option.value)
        dialog.clear()
      }}
      keybind={[
        {
          keybind: keybind.all.stash_delete?.[0],
          title: "remove",
          onTrigger: (option) => {
            if (drop() === option.value) {
              props.onRemove(option.value)
              setDrop(undefined)
              if (props.items().length === 1) dialog.clear()
              return
            }
            setDrop(option.value)
          },
        },
      ]}
    />
  )
}
