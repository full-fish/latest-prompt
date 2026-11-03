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
  // The rule above it fills the band's width.
  expect((await ui.find({ type: 'Text', text: /─/ }))?.text).toBe('─'.repeat(20))
  await ui.unmount()
})

test('the band shows the latest question at or above the bottom of the view', async ($, on) => {
  const clock = mock.clock(on)
  on('prompt.submit', (_, e) => ({ text: e.text }))
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
  const answer = async (requestId: string, onScreen: OnScreenArg) =>
    (
      await $.ui.mount({
        plugin: 'latest-prompt',
        surface: 'terminal',
        component: 'AssistantMessage',
        requestId,
        props: { text: 'answer', isFirstOfReply: true, onScreen },
      })
    ).unmount()
  const shown = async () => {
    await clock.advance(30)
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const text = (await ui.find({ key: 'latest-prompt' }))?.text
    await ui.unmount()

    return text
  }
  const rows = (first: number, last: number) => ({ first, last, of: 5 })

  await $.prompt.submit({ text: 'two', wait: false, origin: composer })
  // At the bottom: the second question and its answer are in view.
  await user('u1', 'one', null)
  await answer('a1', null)
  await user('u2', 'two', rows(0, 4))
  await answer('a2', rows(0, 2))
  expect(await shown()).toBe('two')

  // Scrolled up past the second question: only the first answer is in view.
  await answer('a2', null)
  await user('u2', 'two', null)
  await answer('a1', rows(1, 4))
  expect(await shown()).toBe('one')

  // Back down until the second question shows at the bottom edge.
  await user('u2', 'two', rows(0, 0))
  expect(await shown()).toBe('two')
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
