import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

const latest = atom({ plugin: 'latest-prompt', key: 'text' } as const, null)
const isOpen = atom({ plugin: 'latest-prompt', key: 'isOpen' } as const, false)
// A DiffPanel action: no engine handler is mounted at the prompt to take it first.
const TOGGLE_ACTION = 'app:cycleDiffBase'

// Reminders the engine attaches, and tagged rows (slash commands, their output).
function clean(text: string): string {
  const bare = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()

  return bare.startsWith('<') ? '' : bare
}

const isPerson = (o: PromptOrigin) =>
  o.kind === 'composer' || o.kind === 'bridge' || (o.kind === 'plugin' && o.asUser === true)

async function lastFromTranscript($: EngineInterface): Promise<string | null> {
  const messages = await $.session.messages()
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role !== 'user' || m.toolResults?.length) continue
    const text = clean(m.text)
    if (text) return text
  }

  return null
}

// Terminal cells: Hangul, CJK, fullwidth forms and emoji take two.
function cells(cp: number): number {
  const isWide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff)

  return isWide ? 2 : 1
}

function oneLine(text: string, room: number): string {
  const chars = [...text.replace(/\s+/g, ' ')]
  const widths = chars.map(ch => cells(ch.codePointAt(0) ?? 0))
  if (widths.reduce((a, b) => a + b, 0) <= room) return chars.join('')

  let used = 1 // the ellipsis
  let end = 0
  while (end < chars.length && used + widths[end]! <= room) used += widths[end++]!

  return chars.slice(0, end).join('') + '…'
}

export const register: Register = on => {
  // Startup, --resume, or this mod loading into a running session.
  on('session.start', async ($, e, next) => {
    const text = await lastFromTranscript($).catch(() => null)
    if (text) await update($, latest, () => text).catch(() => {})

    return next(e)
  })

  // Awaited so two quick prompts land in the order they were sent.
  on('prompt.submit', async ($, e, next) => {
    const text = clean(e.text)
    if (text && !e.command && !e.isMeta && isPerson(e.origin)) {
      await update($, latest, () => text).catch(() => {})
    }

    return next(e)
  })

  // /clear and /resume keep the process but change the conversation.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, latest, () => null)
      await update($, isOpen, () => false)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = await read($, latest)
    if (e.props.hasSurvey || text === null) return next(e)

    const { Button, Text } = $.ui.resolve(e)
    const open = await read($, isOpen)

    // ~/.claude/keybindings.json binds ctrl+x ctrl+a to this action in place of
    // abovePrompt:toggle, so the chord presses this Button instead of hiding the band.
    return (
      <Button
        key="latest-prompt"
        plain
        action={TOGGLE_ACTION}
        onPress={() => update($, isOpen, was => !was)}
      >
        {open ? <Text wrap="wrap">{text}</Text> : <Text>{oneLine(text, e.props.bodyColumns)}</Text>}
      </Button>
    )
  })
}
