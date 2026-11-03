import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'latest-prompt',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 20,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const LONG = '가나다라마바사아자차카타파하\n두 번째 줄'

test('the last question in the transcript shows as one line and expands', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'earlier question', toolUses: [] },
      { role: 'assistant', text: 'ok', toolUses: [] },
      { role: 'user', text: `<system-reminder>ctx</system-reminder>${LONG}`, toolUses: [] },
      { role: 'assistant', text: 'ok', toolUses: [] },
      { role: 'user', text: '<command-name>/model</command-name>', toolUses: [] },
      { role: 'user', text: '', toolUses: [], toolResults: [] },
    ],
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    // 20 columns: nine Hangul (18 cells) and the ellipsis.
    expect((await ui.find({ type: 'Text', text: /…/ }))?.text).toBe('가나다라마바사아자…')

    await ui.press({ key: 'latest-prompt' })
    expect((await ui.find({ type: 'Text', text: /두 번째 줄/ }))?.text).toBe(LONG)

    await ui.press({ key: 'latest-prompt' })
    expect(await ui.find({ type: 'Text', text: /두 번째 줄/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('each submitted question replaces the last; a peer message does not', async ($, on) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))

  const typed = { wait: false, origin: { kind: 'composer' } } as const
  await $.prompt.submit({ ...typed, text: 'first one' })
  await $.prompt.submit({ ...typed, text: 'second one' })
  await $.prompt.submit({ text: 'from a peer', wait: false, origin: { kind: 'peer' } })
  await $.prompt.submit({ ...typed, text: '/model', command: { name: 'model', args: '' } })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /one/ }))?.text).toBe('second one')
  // No rule above the question: the band is the question alone.
  expect(await ui.findAll({ type: 'Text' })).toHaveLength(1)
  await ui.unmount()
})

test('the band shows the latest question at or above the bottom of the view', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'one', toolUses: [] },
      { role: 'assistant', text: 'answer one', toolUses: [] },
      { role: 'assistant', text: '', toolUses: [{ tool_use_id: 'toolu_1', tool: 'Bash', input: {} }] },
      { role: 'user', text: 'two', toolUses: [] },
      { role: 'assistant', text: 'answer two', toolUses: [] },
      { role: 'user', text: 'three', toolUses: [] },
      { role: 'assistant', text: 'answer three', toolUses: [] },
    ],
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const composer = { kind: 'composer' } as const
  const user = async (requestId: string, text: string, onScreen: OnScreenArg) =>
    (
      await $.ui.mount({
        plugin: 'latest-prompt',
        surface: 'terminal',
        component: 'UserMessage',
        requestId,
        props: { text, origin: composer, isExpanded: true, onScreen },
      })
    ).unmount()
  const answer = async (requestId: string, text: string, onScreen: OnScreenArg) =>
    (
      await $.ui.mount({
        plugin: 'latest-prompt',
        surface: 'terminal',
        component: 'AssistantMessage',
        requestId,
        props: { text, isFirstOfReply: true, onScreen },
      })
    ).unmount()
  const tool = async (requestId: string, onScreen: OnScreenArg) =>
    (
      await $.ui.mount({
        plugin: 'latest-prompt',
        surface: 'terminal',
        component: 'ToolUse',
        requestId,
        props: {
          tool_use_id: requestId,
          tool: 'Bash',
          input: {},
          isRunning: false,
          isErrored: false,
          isInterrupted: false,
          onScreen,
        },
      })
    ).unmount()
  // Past the gap between transcript reads.
  const shown = async () => {
    await clock.advance(600)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ key: 'latest-prompt' }))?.text
    await ui.unmount()

    return text
  }
  const rows = (first: number, last: number) => ({ first, last, of: 5 })

  await $.prompt.submit({ text: 'three', wait: false, origin: composer })
  // After a reload at the bottom only the rows in view are drawn, newest first.
  await user('u3', 'three', rows(0, 4))
  await answer('a3', 'answer three', rows(0, 2))
  expect(await shown()).toBe('three')

  // Scrolled up past the third question in one step: the engine reports the new
  // edge row alone, never that the third question and its answer left.
  await answer('a2', 'answer two', rows(1, 3))
  expect(await shown()).toBe('two')

  // Further up into the first answer: its tool row is drawn for the first time,
  // and the first question's row is never drawn at all.
  await tool('toolu_1', rows(1, 4))
  expect(await shown()).toBe('one')

  // A row reported off screen alone keeps the view where it was.
  await answer('a2', 'answer two', null)
  expect(await shown()).toBe('one')

  // Back down to the bottom.
  await user('u3', 'three', rows(0, 4))
  await answer('a3', 'answer three', rows(0, 2))
  expect(await shown()).toBe('three')
})

type OnScreenArg = { first: number; last: number; of: number } | null

test('with no question yet the band goes to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
