import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { InView } from '../types'

const latest = atom({ plugin: 'latest-prompt', key: 'text' } as const, null)
const isOpen = atom({ plugin: 'latest-prompt', key: 'isOpen' } as const, false)
const inView = atom({ plugin: 'latest-prompt', key: 'inView' } as const, {} as InView)

// The transcript rows that report which part of them the viewport shows
// (fullscreen only: on the main screen the terminal scrolls, unseen).
const ROWS = [
  'UserMessage',
  'AssistantMessage',
  'ToolUse',
  'ToolResult',
  'ToolGroup',
  'CommandOutput',
  'TurnDuration',
  'InfoNotice',
  'Placed',
] as const

type Row = { order: number; question: string | null; isOnScreen: boolean }

// The latest question at or above the viewport's bottom row, rows numbered in
// the order they were first drawn; undefined while no row says it is on screen.
export function questionInView(rows: Iterable<Row>): string | undefined {
  const all = [...rows]
  const bottom = Math.max(-1, ...all.filter(row => row.isOnScreen).map(row => row.order))
  let best: Row | undefined
  for (const row of all) {
    if (row.question !== null && row.order <= bottom && (!best || row.order > best.order)) best = row
  }

  return best?.question ?? undefined
}
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

// surface → requestId → row, rebuilt from the redraws after a reload.
const views = new Map<string, Map<string, Row>>()
let drawn = 0
let isQueued = false

async function publish($: EngineInterface): Promise<void> {
  const found: InView = {}
  for (const [surface, rows] of views) {
    const question = questionInView(rows.values())
    if (question !== undefined) found[surface] = question
  }
  const held = await read($, inView)
  if (Object.entries(found).every(([surface, question]) => held[surface] === question)) return
  await update($, inView, was => ({ ...was, ...found }))
}

// A drawing may not write state, so the question in view is written just after.
function queue($: EngineInterface): void {
  if (isQueued) return
  isQueued = true
  $.clock.after(30, () => {
    isQueued = false
    void publish($).catch(() => {})
  })
}

export const register: Register = on => {
  // Watches each row's place in the viewport and draws it as the engine does.
  on('ui.render', { component: ROWS }, ($, e, next) => {
    let rows = views.get(e.surface)
    if (!rows) views.set(e.surface, (rows = new Map()))
    const row = rows.get(e.requestId) ?? { order: drawn++, question: null, isOnScreen: false }
    rows.set(e.requestId, row)
    if (e.component === 'UserMessage' && isPerson(e.props.origin)) row.question = clean(e.props.text) || null
    if (e.props.onScreen !== undefined) {
      row.isOnScreen = e.props.onScreen !== null
      queue($)
    }

    return next(e)
  })

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
      views.clear()
      await update($, latest, () => null)
      await update($, isOpen, () => false)
      await update($, inView, () => ({}))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const text = (await read($, inView))[e.surface] ?? (await read($, latest))
    if (e.props.hasSurvey || text === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const open = await read($, isOpen)

    // A rule above sets the question apart from the transcript; the prompt's
    // own border closes it below. ~/.claude/keybindings.json binds ctrl+x
    // ctrl+a to TOGGLE_ACTION, so the chord presses this Button.
    return (
      <Box flexDirection="column">
        <Text dimColor>{'─'.repeat(Math.max(0, e.props.bodyColumns))}</Text>
        <Button
          key="latest-prompt"
          plain
          action={TOGGLE_ACTION}
          onPress={() => update($, isOpen, was => !was)}
        >
          {open ? <Text wrap="wrap">{text}</Text> : <Text>{oneLine(text, e.props.bodyColumns)}</Text>}
        </Button>
      </Box>
    )
  })
}
