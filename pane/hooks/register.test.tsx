import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'office-monitor-pane',
  component: 'Pane',
  requestId: 'office',
  surface: 'terminal',
  props: {
    title: '사무실',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'office-monitor-pane',
  component: 'AbovePrompt',
  surface: 'terminal',
  props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 4, bodyColumns: 100, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as any

// 엔진 흉내: 등록·열기·시계는 그냥 받아 준다
function engine(on: any) {
  on('command.register', () => ({ value: { command: 'office' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('clock.every', () => ({ value: undefined }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
}

test('아무 일도 없으면 사장은 한숨 돌리고 직원은 월급루팡', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /한숨 돌리는 중/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /○ Explore/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /월급루팡 중/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('일감을 받은 직원: 모델·effort, 도구가 끝나면 일을 떼고, 보고하면 완료', async ($, on) => {
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag1' }))
  on('agent.report', (_: unknown, e: any) => ({ text: e.text }))
  on('turn.step', async function* (_: unknown, e: any) { return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] } as any })
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ tool_use_id: 'tu1', prompt: '결제 모듈 고쳐', description: '결제 모듈 수정', subagentType: 'general-purpose', provider: 'claude' as any, parentModel: 'claude-opus-5-5', background: false, fork: false } as any)
  for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'ag1' })) { /* 흘려보내기 */ }
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/src/pay/foo.ts', old_string: 'a', new_string: 'b', agentId: 'ag1' } as any)

  let ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /● general-purpose/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /머리 굴리는 중/ }))?.text).toBeTruthy()   // 도구가 끝났으니 지금 하는 일은 비었다
  expect((await ui.find({ type: 'Text', text: /Haiku 5\.5 · low/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /보고 기다리는 중/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /맡은 일: 결제 모듈 수정/ }))?.text).toBeTruthy()
  await ui.unmount()

  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /직원 1명 일하는 중/ }))?.text).toBeTruthy()
  await band.unmount()

  await $.agent.report({ agentId: 'ag1', subagentType: 'general-purpose', provider: 'claude' as any, status: 'completed', text: '끝' })
  ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /보고 완료/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('승인을 기다리는 직원은 결재 대기로, 요약 줄에 승인 대기 수가 나온다', async ($, on) => {
  const now = Date.now()
  const seeded = {
    main: { model: 'claude-opus-5-5', effort: 'high', waiting: false, work: null, busy: true, turnStart: now - 5000 },
    agents: [{ id: 'ag2', type: 'code-reviewer', desc: '변경분 리뷰', model: 'claude-opus-5-5', effort: 'xhigh', waiting: true,
      work: { id: 'b1', tool: 'Bash', arg: 'rm -rf dist', since: now - 2000 }, start: now - 9000, end: null, status: 'running' }],
  }
  on('state.get', (_: unknown, e: any) => (e.key === 'office' ? { value: { value: { shape: 'office-1', value: seeded }, version: 1 } } : { value: { value: { shape: 'tick-1', value: 0 }, version: 1 } }))
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /결재 기다리는 중 · rm -rf dist/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /Opus 5\.5 · xhigh/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /^Opus 5\.5 · high/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /승인을 기다리는 곳이 1군데/ }))?.text).toBeTruthy()
  await ui.unmount()
  const band = await $.ui.mount(BAND)
  expect((await band.find({ type: 'Text', text: /승인 대기 1/ }))?.text).toBeTruthy()
  await band.unmount()
})

test('일하는 중인 직원은 하는 일과 처리 시간을 보여 준다', async ($, on) => {
  const now = Date.now()
  const seeded = {
    main: { model: 'claude-opus-5-5', effort: 'high', waiting: false, work: { id: 'm1', tool: 'Read', arg: 'plan.md', since: now - 1000 }, busy: true, turnStart: now - 65_000 },
    agents: [{ id: 'ag3', type: 'Explore', desc: '호출부 찾기', model: 'claude-haiku-5-5', effort: 'low', waiting: false,
      work: { id: 'g1', tool: 'Grep', arg: 'refund(', since: now - 1000 }, start: now - 42_000, end: null, status: 'running' }],
  }
  on('state.get', (_: unknown, e: any) => (e.key === 'office' ? { value: { value: { shape: 'office-1', value: seeded }, version: 1 } } : { value: { value: { shape: 'tick-1', value: 0 }, version: 1 } }))
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^자료 뒤지는 중 · refund\(/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /0:4[12]  Haiku 5\.5 · low/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /처리 중 1:0[56]/ }))?.text).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /직접 자료 뒤지는 중 · plan\.md/ }))?.text).toBeTruthy()
  await ui.unmount()
})
