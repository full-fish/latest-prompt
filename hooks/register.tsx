import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register, SessionMessage } from 'claude-code'

import type { InView } from '../types'

const latest = atom({ plugin: 'latest-prompt', key: 'text' } as const, null)
const isOpen = atom({ plugin: 'latest-prompt', key: 'isOpen' } as const, false)
const inView = atom({ plugin: 'latest-prompt', key: 'inView' } as const, {} as InView)

// The transcript rows that report which part of them the viewport shows
// (fullscreen only: on the main screen the terminal scrolls, unseen) and can be
// found in $.session.messages(): tool rows by tool_use_id, messages by text.
const ROWS = ['UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup'] as const

type Anchor = { tool: string } | { role: 'user' | 'assistant'; text: string }
// `at` is the row's index in $.session.messages(). Rows are drawn lazily as
// they scroll in, so the order they are first drawn in is not the transcript's.
// The part of the row in view as last reported (`onScreen`), null while out.
type Extent = { first: number; last: number; of: number }
type Row = { anchor: Anchor; at: number | undefined; tries: number; extent: Extent | null }
type Question = { at: number; text: string }

const isSameAnchor = (a: Anchor, b: Anchor) =>
  'tool' in a ? 'tool' in b && a.tool === b.tool : 'role' in b && a.role === b.role && a.text === b.text

// On a scroll the engine reports the rows at the viewport's edges only, so a
// short row that leaves in one step is never told it left. A reported row cut
// at the top puts every earlier row above the view, one cut at the bottom every
// later row below it; a row reported whole says nothing of the others. Rows
// whose place is not known yet stay in `keys` to be judged once it is.
export function settle(rows: Map<string, Row>, keys: Set<string>): void {
  for (const key of keys) {
    const row = rows.get(key)
    if (row?.at === undefined) {
      if (!row || row.tries >= 3) keys.delete(key)
      continue
    }
    keys.delete(key)
    const extent = row.extent
    if (!extent) continue
    for (const other of rows.values()) {
      if (other.at === undefined) continue
      if ((extent.first > 0 && other.at < row.at) || (extent.last < extent.of - 1 && other.at > row.at)) {
        other.extent = null
      }
    }
  }
}

// The latest question at or above the bottom row in view; undefined while no
// row found in the transcript says it is on screen.
export function questionInView(rows: Iterable<Row>, questions: readonly Question[]): string | undefined {
  let bottom = -1
  for (const row of rows) if (row.extent && row.at !== undefined && row.at > bottom) bottom = row.at
  let found: string | undefined
  for (const question of questions) if (bottom >= 0 && question.at <= bottom) found = question.text

  return found
}

// Sets each row's `at` from the messages, and returns the questions among them.
export function locate(rows: Iterable<Row>, messages: readonly SessionMessage[]): Question[] {
  const toolAt = new Map<string, number>()
  const textAt = new Map<string, number>()
  const questions: Question[] = []
  messages.forEach((m, at) => {
    for (const use of m.toolUses) toolAt.set(use.tool_use_id, at)
    if (m.toolResults?.length) return
    const text = m.role === 'user' ? clean(m.text) : m.text.trim()
    if (!text) return
    textAt.set(`${m.role}\n${text}`, at)
    if (m.role === 'user') questions.push({ at, text })
  })
  for (const row of rows) {
    const a = row.anchor
    row.at = 'tool' in a ? toolAt.get(a.tool) : textAt.get(`${a.role}\n${a.text}`)
    // A block of a longer reply: the latest message holding it.
    if (row.at === undefined && 'role' in a && a.role === 'assistant') {
      for (let at = messages.length - 1; at >= 0 && row.at === undefined; at--) {
        if (messages[at]!.role === 'assistant' && messages[at]!.text.includes(a.text)) row.at = at
      }
    }
    if (row.at === undefined) row.tries += 1
  }

  return questions
}
// A DiffPanel action: no engine handler is mounted at the prompt to take it first.
const TOGGLE_ACTION = 'app:cycleDiffBase'
// Wider than any slot, so it is drawn at the slot's width; a mid grey at half
// strength reads on light and dark themes alike.
const RULE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1" viewBox="0 0 4000 1" preserveAspectRatio="none">' +
  '<rect width="4000" height="1" fill="#808080" fill-opacity="0.5"/></svg>'

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

// surface → component:requestId → row, rebuilt from the redraws after a reload.
const views = new Map<string, Map<string, Row>>()
// surface → keys of the rows reported and not yet settled.
const fresh = new Map<string, Set<string>>()
let questions: Question[] = []
let fetchedAt = Number.NEGATIVE_INFINITY
let isQueued = false
// At most two $.session.messages() reads a second; a row not found in three
// reads stops asking for more until the turn ends.
const FETCH_GAP_MS = 500
const isPending = (row: Row) => row.at === undefined && row.tries < 3

async function publish($: EngineInterface): Promise<void> {
  const all = [...views.values()].flatMap(rows => [...rows.values()])
  if (all.some(isPending)) {
    const now = await $.clock.now()
    const wait = fetchedAt + FETCH_GAP_MS - now
    if (wait > 0) {
      queue($, wait)
    } else {
      fetchedAt = now
      questions = locate(all, await $.session.messages())
    }
  }
  const found: InView = {}
  for (const [surface, rows] of views) {
    settle(rows, fresh.get(surface) ?? new Set())
    const question = questionInView(rows.values(), questions)
    if (question !== undefined) found[surface] = question
  }
  const held = await read($, inView)
  if (Object.entries(found).every(([surface, question]) => held[surface] === question)) return
  await update($, inView, was => ({ ...was, ...found }))
}

// A drawing may not write state, so the question in view is written just after.
function queue($: EngineInterface, ms: number): void {
  if (isQueued) return
  isQueued = true
  $.clock.after(ms, () => {
    isQueued = false
    void publish($).catch(() => {})
  })
}

export const register: Register = on => {
  // Watches each row's place in the viewport and draws it as the engine does.
  on('ui.render', { component: ROWS }, ($, e, next) => {
    let anchor: Anchor | undefined
    if (e.component === 'ToolUse' || e.component === 'ToolResult') {
      anchor = { tool: e.requestId }
    } else if (e.component === 'ToolGroup') {
      const id = e.props.calls.find(call => call.tool_use_id)?.tool_use_id
      if (id) anchor = { tool: id }
    } else if (e.component === 'UserMessage') {
      const text = clean(e.props.text)
      if (text && isPerson(e.props.origin)) anchor = { role: 'user', text }
    } else {
      const text = e.props.text.trim()
      if (text) anchor = { role: 'assistant', text }
    }
    if (anchor && e.props.onScreen !== undefined) {
      let rows = views.get(e.surface)
      if (!rows) views.set(e.surface, (rows = new Map()))
      const key = `${e.component}:${e.requestId}`
      const row = rows.get(key)
      const shown = e.props.onScreen
      const extent = shown === null ? null : { first: shown.first, last: shown.last, of: shown.of }
      if (row && isSameAnchor(row.anchor, anchor)) row.extent = extent
      else rows.set(key, { anchor, at: undefined, tries: 0, extent })
      let reported = fresh.get(e.surface)
      if (!reported) fresh.set(e.surface, (reported = new Set()))
      reported.add(key)
      queue($, 30)
    }

    return next(e)
  })

  // A reply streamed past the last read is stored by now: look once more.
  on('turn.complete', ($, e, next) => {
    for (const rows of views.values()) for (const row of rows.values()) if (row.at === undefined) row.tries = 0
    queue($, 30)

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
      fresh.clear()
      questions = []
      fetchedAt = Number.NEGATIVE_INFINITY
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
    // The terminal draws a row of box-drawing cells. The desktop counts
    // `bodyColumns` in its code font but sets Text in its UI font, where those
    // cells run past one line, so it gets a 1px line stretched to the slot.
    let rule = <Text dimColor>{'─'.repeat(Math.max(0, e.props.bodyColumns))}</Text>
    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)
      rule = <Svg source={RULE_SVG} alt="divider" height={1} />
    }

    // A rule above sets the question apart from the transcript; the prompt's
    // own border closes it below. ~/.claude/keybindings.json binds ctrl+x
    // ctrl+a to TOGGLE_ACTION, so the chord presses this Button.
    return (
      <Box flexDirection="column">
        {rule}
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
