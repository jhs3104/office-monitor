# office-monitor

Claude Code의 메인 세션과 서브에이전트가 지금 무엇을 하는지 브라우저에서 보여 주는 로컬 모니터입니다.

- **오피스 뷰(기본 화면)**: 왼쪽 사장실에 사장(메인 세션)이, 오른쪽 3×2 방에 에이전트 유형별 직원이 있습니다. 평소엔 자리에서 "월급루팡 중"이다가, 사장이 일감을 주면 사장실로 가서 일을 받고 자기 자리로 돌아와 일하고, 끝나면 보고하러 갔다가 돌아옵니다. 사람이나 방을 누르면 역할과 지금 하는 일이 보입니다.
- **타임라인 뷰**: 에이전트마다 한 줄. 도구 호출을 종류별 색 블록으로, 권한 승인 대기를 빗금으로, 서브에이전트 호출을 점선 화살표로 표시합니다.

의존성 없는 Node 서버 하나(`server.mjs`)와 HTML 한 장(`index.html`)으로 되어 있습니다. **내 컴퓨터에서 혼자 쓰는 도구**로 만들었고, 데이터는 컴퓨터 밖으로 나가지 않습니다.

## 설치

Claude Code에서:

```
/plugin marketplace add jhs3104/office-monitor
/plugin install office-monitor@office
```

플러그인은 hook만 등록합니다. 사용자 범위로 설치하면 어느 폴더·워크트리에서 연 세션이든 이벤트가 잡힙니다.

## 실행

```
git clone https://github.com/jhs3104/office-monitor.git
cd office-monitor
node server.mjs
```

그리고 http://127.0.0.1:47318 을 엽니다. 서버 없이 `index.html`을 파일로 열면 샘플 데이터로 동작하는 데모가 나옵니다.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `OFFICE_MONITOR_PORT` | `47318` | 서버 포트. hook도 같은 변수를 읽으므로 Claude Code를 실행하는 셸에도 같은 값을 설정하세요. |
| `OFFICE_MONITOR_DATA` | `~/.office-monitor` | 수집 기록(`events.jsonl`) 폴더 |

요구 사항: Node 18 이상, hook 실행에 `sh`와 `curl` (macOS·Linux. Windows는 Git Bash가 있어야 합니다).

## 수집하는 것

hook은 hook 입력 JSON 전체를 `127.0.0.1:<포트>`로 보내고, 서버가 그중 화면에 필요한 것만 골라 `events.jsonl`에 저장합니다. 서버가 꺼져 있으면 연결이 바로 거절되어 아무것도 보내지 않습니다.

저장하는 항목:

- 이벤트 종류, 시각, 세션 ID, 서브에이전트 ID·유형, 작업 폴더, 모델
- 도구 이름과 한 줄 요약(명령, 파일 경로, 검색어, URL 등, 최대 240자)
- 서브에이전트 호출의 설명(120자)과 지시문(600자)
- 내가 입력한 프롬프트(매번, 최대 600자)
- 매 턴이 끝날 때 응답 앞부분(최대 600자), 서브에이전트가 끝날 때 응답 앞부분(최대 600자)
- 도구 실패 시 오류 메시지(최대 300자, 명령 출력 일부가 들어갈 수 있음), 알림 메시지(최대 300자)

파일 내용, diff 본문, 성공한 도구의 실행 결과는 저장하지 않습니다. 명령에 토큰 같은 값을 직접 넣었다면 그 명령은 요약에 그대로 남으니 주의하세요. 기록을 지우려면 서버를 끄고 `~/.office-monitor/events.jsonl`을 지우면 됩니다.

서버는 `127.0.0.1`에만 열리고, 호스트 이름이 `127.0.0.1`·`localhost`가 아닌 요청과 JSON이 아닌 쓰기 요청은 거절합니다.

## 등록하는 hook

SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, SubagentStart, SubagentStop, Stop, Notification — 모두 백그라운드(`async`)로 실행되고, 실패해도 Claude Code 동작을 막지 않습니다. 권한 요청에 응답하거나 결정을 바꾸지 않습니다.

## 알려진 한계

- 내장 `web-fetch` 서브에이전트는 플러그인 hook으로 시작 이벤트가 오지 않아, 그 작업이 메인 세션 쪽에 표시될 수 있습니다.
- 백그라운드로 실행한 서브에이전트는 실제보다 일찍 완료로 보일 수 있습니다.
- `claude -p`로 실행한 세션은 종료 이벤트가 빠져 끝나지 않은 것으로 남을 수 있습니다.

## 라이선스

MIT
