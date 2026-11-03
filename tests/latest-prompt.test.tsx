import { expect, test } from 'claude-code/testing'

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
  expect((await ui.find({ type: 'Text' }))?.text).toBe('second one')
  await ui.unmount()
})

test('with no question yet the band goes to the engine', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  await ui.unmount()
})
