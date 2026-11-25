// 사무실 패널이 세션 상태로 들고 있는 값
export type Work = { id: string; tool: string; arg: string; since: number }

// 사장(메인)과 직원(서브에이전트)이 함께 쓰는 부분
export type Worker = {
  model: string
  effort: string
  waiting: boolean
  work: Work | null
}

export type Main = Worker & { busy: boolean; turnStart: number | null }

export type Agent = Worker & {
  id: string
  type: string
  desc: string
  start: number
  end: number | null
  status: 'running' | 'done' | 'failed' | 'stopped'
}

export type Office = { main: Main; agents: Agent[] }

declare module 'claude-code' {
  interface PluginState {
    'office-monitor-pane': { office: Shaped<Office>; tick: Shaped<number> }
  }
}
