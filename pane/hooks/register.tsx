// office-monitor-pane: 터미널 Claude Code 화면 옆에 이 세션의 사무실을 보여 준다.
// 사장(메인 세션)과 유형별 직원(서브에이전트)의 지금 하는 일, 모델·effort, 처리 시간을 글자판으로 그린다.
// 서버 없이 이 세션의 이벤트(turn·tool·agent)를 직접 받는다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

import type { Agent, Main, Office, Worker } from '../types'

const PLUGIN = 'office-monitor-pane'
const PANE = 'office'
const WEB = 'http://127.0.0.1:47318'

const EMPTY: Office = {
  main: { model: '', effort: '', waiting: false, work: null, busy: false, turnStart: null },
  agents: [],
}
// 값의 모양을 바꾸면 shape 꼬리표도 바꾼다: 예전 버전이 저장한 값은 받지 않는다
const office = atom({ plugin: 'office-monitor-pane', key: 'office' } as const, EMPTY, { shape: 'office-1' })
const tick = atom({ plugin: 'office-monitor-pane', key: 'tick' } as const, 0, { shape: 'tick-1' })

const DEFAULT_TYPES = ['Explore', 'general-purpose', 'Plan', 'code-reviewer', 'web-fetch']
const REPORT_SHOW_MS = 30_000 // 끝난 직원은 30초 동안 '보고 완료'로 보여 준 뒤 월급루팡으로 돌아간다

// 검정 터미널에 맞춘 색: 패널 바탕을 검정으로 칠하고, 그 위에서 또렷한 밝은 톤을 쓴다 (기본 글자색에 기대지 않는다)
const BG = '#000000'
const GRAY = '#9aa0aa'
const RULE = '#4a505a'
const BLUE = '#6ea8ff'
const YELLOW = '#f2c14e'
const GREEN = '#5fd39a'
const RED = '#ff7b72'
const ORANGE = '#f0915a'
const TYPE_HEX: Record<string, string> = {
  Explore: '#7aa2e3', 'general-purpose': '#4fbf98', Plan: '#b294e8', 'code-reviewer': '#e0a83a', 'web-fetch': '#4fc1d1',
}
const typeColor = (t: string) => TYPE_HEX[t] ?? '#a8b0bc'

const PHRASE: Record<string, string> = {
  Read: '자료 뒤지는 중', Grep: '자료 뒤지는 중', Glob: '자료 뒤지는 중', LS: '자료 뒤지는 중',
  Edit: '코드 고치는 중', Write: '코드 고치는 중', MultiEdit: '코드 고치는 중', NotebookEdit: '코드 고치는 중',
  Bash: '터미널 두드리는 중', WebFetch: '인터넷 서핑(업무) 중', WebSearch: '인터넷 서핑(업무) 중',
}
const phraseOf = (tool: string) => PHRASE[tool] ?? (tool.startsWith('mcp__') ? '인터넷 서핑(업무) 중' : '작업 중')

// "claude-opus-5-5" → "Opus 5.5"
const prettyModel = (m: string) => {
  const x = m.replace(/^(?:[a-z-]{2,8}\.)?(?:anthropic\.)?claude-/, '').replace(/(?:@\d+|-v\d+(?::\d+)?|-\d{8})+$/, '')
    .match(/^(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i)
  if (!x) return m
  const [, fam = '', major = '', minor] = x
  return `${fam.charAt(0).toUpperCase()}${fam.slice(1)} ${major}${minor ? '.' + minor : ''}`
}
const modelLine = (w: Worker) => [w.model ? prettyModel(w.model) : '', w.effort].filter(Boolean).join(' · ')

// 도구 입력에서 한 줄 요약(명령, 파일 이름, 검색어, URL)
const summarize = (e: Record<string, unknown>) => {
  const v = e.command ?? e.file_path ?? e.notebook_path ?? e.pattern ?? e.url ?? e.query ?? e.description ?? ''
  const s = String(v).replace(/\s+/g, ' ').trim()
  return (e.file_path || e.notebook_path ? s.split('/').pop() : s) || ''
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// 터미널 칸 폭: 한글·한자·전각 문자만 2칸 (○, ─, · 같은 기호는 1칸)
const isWide = (c: number) =>
  (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
  (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6)
const cells = (s: string) => [...s].reduce((n, ch) => n + (isWide(ch.codePointAt(0) ?? 0) ? 2 : 1), 0)
const fit = (s: string, max: number) => {
  if (cells(s) <= max) return s
  let out = '', n = 0
  for (const ch of s) {
    const w = cells(ch)
    if (n + w > max - 1) break
    out += ch; n += w
  }
  return out + '…'
}
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - cells(s)))
// 왼쪽 글을 남는 폭에 맞추고 오른쪽 글을 끝에 붙인다
const row = (left: string, right: string, cols: number) => {
  const room = Math.max(4, cols - cells(right) - (right ? 2 : 0))
  return pad(fit(left, room), room) + (right ? '  ' + right : '')
}

// 사무실 상태 바꾸기 (사장은 agentId 없음, 직원은 agentId로 찾는다)
function setOffice($: Engine, fn: (o: Office) => Office) {
  return update($, office, fn)
}
function setWorker($: Engine, agentId: string | undefined, fn: (w: Worker) => Worker) {
  return setOffice($, o => agentId
    ? { ...o, agents: o.agents.map(a => (a.id === agentId ? { ...a, ...fn(a) } : a)) }
    : { ...o, main: { ...o.main, ...fn(o.main) } as Main })
}

export const register: Register = on => {
  // 도구 호출 → 누가 했는지 (승인 대기를 그 주인에게 붙이기 위해). 다시 불러오면 비지만 다음 호출부터 다시 찬다.
  const owners = new Map<string, string | undefined>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'office', description: '이 세션의 사무실 패널 열기 (사장과 서브에이전트 상태)' })
    void $.ui.open({ id: PANE, title: '사무실' })
    // 처리 시간이 흐르도록, 누군가 일하는 동안만 1초마다 다시 그린다
    $.clock.every(1000, async () => {
      const o = await read($, office)
      if (o.main.busy || o.agents.some(a => a.status === 'running' || (a.end && Date.now() - a.end < REPORT_SHOW_MS)))
        await update($, tick, n => n + 1)
    })
    return next(e)
  })

  on('command.run', { command: 'office' }, async $ => {
    const r = await $.ui.open({ id: PANE, title: '사무실' })
    return { text: r.isPlaced ? '사무실 패널을 열었습니다.' : '사무실 패널은 터미널 폭이 넓을 때(전체 화면 110칸 이상) 옆에 붙고, 좁으면 입력창 위에 나옵니다.' }
  })

  // 사장의 요청 시작·끝 (서브에이전트의 턴은 agentId가 있다)
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await setOffice($, o => ({ ...o, main: { ...o.main, busy: true, turnStart: Date.now(), waiting: false } }))
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await setOffice($, o => ({ ...o, main: { ...o.main, busy: false, waiting: false, work: null } }))
    return r
  })

  // 모델 요청마다 실제로 쓰는 모델과 effort (사장·직원 모두)
  // turn.step은 응답을 흘려보내는 이벤트라 생성기 함수로 받아 그대로 넘긴다
  on('turn.step', async function* ($, e, next) {
    await setWorker($, e.agentId, w => ({ ...w, model: e.model || w.model, effort: e.effort != null ? String(e.effort) : w.effort }))
    return yield* next(e)
  })

  // 사장이 일감을 주면 직원이 출근한다
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!r.deny) {
      const agent: Agent = {
        id: r.agentId ?? e.tool_use_id, type: e.subagentType || 'agent', desc: e.description || '',
        model: r.model || e.model || '', effort: '', waiting: false, work: null,
        start: Date.now(), end: null, status: 'running',
      }
      // 끝난 지 오래된 기록은 정리한다(최근 40명까지)
      await setOffice($, o => ({ ...o, agents: [...o.agents.filter(a => a.status === 'running' || (a.end ?? 0) > Date.now() - 3600_000), agent].slice(-40) }))
    }
    return r
  })

  // 직원이 보고하면 일이 끝난다 (완료·실패·중단)
  on('agent.report', async ($, e, next) => {
    const status = e.status === 'completed' ? 'done' : e.status === 'failed' ? 'failed' : 'stopped'
    await setOffice($, o => ({
      ...o, agents: o.agents.map(a => (a.id === e.agentId ? { ...a, status, end: Date.now(), work: null, waiting: false } : a)),
    }))
    return next(e)
  })

  // 지금 하는 일: 도구 호출이 시작되면 붙이고, 끝나면 뗀다
  on('tool.call', async ($, e, next) => {
    if (e.tool === 'Agent') return next(e) // 일감 배정은 agent.spawn이 맡는다
    const id = e.tool_use_id ?? `${e.tool}:${Date.now()}`
    owners.set(id, e.agentId)
    await setWorker($, e.agentId, w => ({ ...w, waiting: false, work: { id, tool: e.tool, arg: summarize(e as Record<string, unknown>), since: Date.now() } }))
    try {
      return await next(e)
    } finally {
      owners.delete(id)
      await setWorker($, e.agentId, w => ({ ...w, waiting: false, work: w.work?.id === id ? null : w.work }))
    }
  })

  // 권한 판단이 '물어보기'면 사용자 승인을 기다린다
  on('tool.check', async ($, e, next) => {
    const v = await next(e)
    if (v.decision === 'ask' && e.tool_use_id && owners.has(e.tool_use_id))
      await setWorker($, owners.get(e.tool_use_id), w => ({ ...w, waiting: true }))
    return v
  })

  // ── 패널 ────────────────────────────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const o = await read($, office)
    await read($, tick) // 1초마다 다시 그리기
    const now = Date.now()
    const cols = Math.max(30, e.props.bodyColumns ?? 60)

    const working = o.agents.filter(a => a.status === 'running')
    const waitingN = working.filter(a => a.waiting).length + (o.main.waiting ? 1 : 0)

    // 사장
    const m = o.main
    const bossPhrase = m.waiting ? `승인 기다리는 중 · ${m.work?.arg ?? ''}`
      : m.work ? `직접 ${phraseOf(m.work.tool)} · ${m.work.arg}`
      : working.length ? `보고 기다리는 중${working.length > 1 ? ` (${working.length}명)` : ''}`
      : m.busy ? '구상 중' : '한숨 돌리는 중'
    const bossTime = m.busy && m.turnStart ? `처리 중 ${fmt(now - m.turnStart)}` : working.length ? '보고 대기' : '대기 중'

    // 직원: 기본 유형 + 이 세션에 나온 유형. 유형마다 일하는 사람 수만큼 줄, 없으면 월급루팡 한 줄.
    // 한 줄은 [점·유형 이름][상태 문구][처리 시간·모델] 세 조각으로, 조각마다 색을 따로 준다.
    const types = [...new Set([...DEFAULT_TYPES, ...o.agents.map(a => a.type)])]
    type Line = { key: string; type: string; dot: string; phrase: string; color: string; right: string; desc?: string }
    const lines: Line[] = []
    for (const ty of types) {
      const mine = o.agents.filter(a => a.type === ty && (a.status === 'running' || (a.end && now - a.end < REPORT_SHOW_MS)))
      if (!mine.length) {
        lines.push({ key: ty, type: ty, dot: '○', phrase: '월급루팡 중', color: GRAY, right: '' })
        continue
      }
      for (const a of mine) {
        const phrase = a.status === 'done' ? '보고 완료' : a.status === 'failed' ? '실패해서 멘붕 중' : a.status === 'stopped' ? '사장이 중간에 멈춤'
          : a.waiting ? `결재 기다리는 중 · ${a.work?.arg ?? ''}`
          : a.work ? `${phraseOf(a.work.tool)} · ${a.work.arg}` : '머리 굴리는 중'
        const right = [fmt((a.end ?? now) - a.start), modelLine(a)].filter(Boolean).join('  ')
        const color = a.status === 'running' ? (a.waiting ? YELLOW : BLUE) : a.status === 'done' ? GREEN : RED
        lines.push({ key: a.id, type: ty, dot: '●', phrase, color, right, desc: a.desc })
      }
    }
    const NAME_W = 18
    const rule = '─'.repeat(cols)
    const bossColor = m.waiting ? YELLOW : m.busy || working.length ? BLUE : GRAY

    return (
      <Box flexDirection="column" backgroundColor={BG} flexGrow={1} minHeight={e.viewport?.rows ?? 0}>
        <Box flexDirection="row">
          <Text bold color={ORANGE}>{pad('사장 (메인)', NAME_W)}</Text>
          <Text color={GRAY}>{pad(fit(modelLine(m), Math.max(4, cols - NAME_W - cells(bossTime) - 2)), Math.max(4, cols - NAME_W - cells(bossTime) - 2))}</Text>
          <Text bold color={bossColor}>{'  ' + bossTime}</Text>
        </Box>
        <Text color={bossColor}>{'  ' + fit(bossPhrase, cols - 2)}</Text>
        {waitingN > 0 && <Text bold color={YELLOW}>{fit(`승인을 기다리는 곳이 ${waitingN}군데 있습니다`, cols)}</Text>}
        <Text color={RULE}>{rule}</Text>
        {lines.map(l => {
          const room = Math.max(4, cols - NAME_W - (l.right ? cells(l.right) + 2 : 0))
          return (
            <Box key={l.key} flexDirection="column">
              <Box flexDirection="row">
                <Text bold color={typeColor(l.type)}>{pad(`${l.dot} ${fit(l.type, NAME_W - 3)}`, NAME_W)}</Text>
                <Text bold={l.color !== GRAY} color={l.color}>{pad(fit(l.phrase, room), room)}</Text>
                {l.right ? <Text color={GRAY}>{'  ' + l.right}</Text> : null}
              </Box>
              {l.desc ? <Text color={GRAY}>{'  ' + fit(`맡은 일: ${l.desc}`, cols - 2)}</Text> : null}
            </Box>
          )
        })}
        <Text color={RULE}>{rule}</Text>
        <Text color={BLUE}>{fit(`여러 프로젝트를 한눈에 보는 웹 사무실: ${WEB} (서버 필요)`, cols)}</Text>
      </Box>
    )
  })

  // ── 입력창 위 한 줄 요약: 직원이 일하거나 승인 대기가 있을 때만 ──
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const o = await read($, office)
    const working = o.agents.filter(a => a.status === 'running')
    const waitingN = working.filter(a => a.waiting).length + (o.main.waiting ? 1 : 0)
    if (!working.length && !waitingN) return next(e)
    const { Text } = $.ui.resolve(e)
    const parts = [working.length ? `직원 ${working.length}명 일하는 중` : '', waitingN ? `승인 대기 ${waitingN}` : ''].filter(Boolean)
    return <Text color={waitingN ? YELLOW : BLUE}>{`사무실 · ${parts.join(' · ')}  (/office)`}</Text>
  })
}
