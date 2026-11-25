# office-monitor

Claude Code의 메인 세션과 서브에이전트가 지금 무엇을 하는지 브라우저에서 보여 주는 로컬 모니터입니다.

- **프로젝트별 사무실**: 여러 프로젝트에서 동시에 Claude Code를 써도 프로젝트마다 사무실이 하나씩 한 페이지에 쌓입니다(워크트리는 원래 저장소로 묶음). 순서는 처음 나타난 순서로 고정되어 자리를 바꾸지 않습니다. 처음 나타날 때 쉬는 프로젝트는 머리줄만 보이게 접히고, 그 뒤 펼침·접힘은 직접 누를 때만 바뀝니다(접힌 사무실의 상태는 머리줄의 점과 상태 표시로 보입니다). 한 프로젝트에 세션이 여럿이면 가장 급한 세션(승인 대기 > 일하는 중 > 최근)을 보여 주고, 위쪽 드롭다운에서 특정 세션을 고정할 수 있습니다. 머리줄을 누르면 펼치고 접으며, × 로 사무실을 닫을 수 있습니다(그 프로젝트에 새 요청을 보내면 다시 나타납니다). 실제로 요청이나 도구 사용이 있었던 세션만 보여 줍니다.
- **오피스 뷰(기본 화면)**: 각 사무실의 왼쪽 사장실에 사장(메인 세션)이, 오른쪽 3×2 방에 에이전트 유형별 직원이 있습니다. 평소엔 자리에서 "월급루팡 중"이다가, 사장이 일감을 주면 사장실로 가서 일을 받고 자기 자리로 돌아와 일하고, 끝나면 보고하러 갔다가 돌아옵니다. 방에는 처리 중인 시간과 모델이, 사장실에는 메인 세션의 모델·effort가 보이고, 응답 후 한동안 활동이 없으면 사장은 "자리 비움"이 됩니다. 사람이나 방을 누르면 역할과 지금 하는 일이 보입니다.
- **타임라인 뷰**: 사무실 머리줄의 "오피스 | 타임라인"으로 전환하면, 그 사무실 자리에 해당 세션의 타임라인이 나옵니다. 오른쪽 상세 패널이 하나라서 타임라인도 한 번에 한 사무실에만 열리고, 다른 사무실을 펼치거나 그 안의 사람을 누르면 오피스 그림으로 돌아갑니다. 에이전트마다 한 줄로, 도구 호출을 종류별 색 블록으로, 권한 승인 대기를 빗금으로, 서브에이전트 호출을 점선 화살표로 표시합니다.

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

서버는 프로젝트마다 띄울 필요 없이 **하나만** 띄우면 됩니다. 다른 폴더에서는 `node <클론한 경로>/server.mjs`로 실행하세요.

### macOS에서 항상 켜 두기 (선택)

`~/Library/LaunchAgents/office-monitor.plist`를 만들어 launchd에 등록하면 로그인할 때 켜지고, 꺼지면 다시 켜집니다. node는 `which node`로 나온 절대 경로를 넣으세요.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>office-monitor</string>
  <key>ProgramArguments</key>
  <array>
    <string>/절대/경로/node</string>
    <string>/클론한/경로/office-monitor/server.mjs</string>
  </array>
  <!-- 포트나 기록 폴더를 바꿨다면 여기에도 같은 값을 넣으세요 -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>OFFICE_MONITOR_PORT</key><string>47318</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/office-monitor.log</string>
  <key>StandardErrorPath</key><string>/tmp/office-monitor.log</string>
</dict>
</plist>
```

```
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/office-monitor.plist   # 등록·시작
launchctl kickstart -k gui/$(id -u)/office-monitor                              # server.mjs 수정 후 재시작
launchctl bootout gui/$(id -u)/office-monitor                                   # 끄기
```

Claude Code를 켜 둔 채 플러그인을 처음 설치했다면, 이미 열려 있던 세션에는 hook이 적용되지 않습니다. 세션에서 `/reload-plugins`를 실행하거나 세션을 새로 시작하세요.

| 환경 변수 | 기본값 | 설명 |
|---|---|---|
| `OFFICE_MONITOR_PORT` | `47318` | 서버 포트. hook도 같은 변수를 읽으므로 Claude Code를 실행하는 셸에도 같은 값을 설정하세요. |
| `OFFICE_MONITOR_DATA` | `~/.office-monitor` | 수집 기록(`events.jsonl`) 폴더 |

요구 사항: Node 18 이상, hook 실행에 `sh`와 `curl` (macOS·Linux. Windows는 Git Bash가 있어야 합니다).

## 터미널 패널 모드 (선택)

서버나 브라우저 없이, 터미널의 Claude Code 화면 옆에 **지금 세션의 사무실**을 글자판으로 보여 주는 모드입니다.

```
/plugin install office-monitor-pane@office
```

- 화면 오른쪽 패널(전체 화면 모드에서 터미널 폭 110칸 이상일 때 옆에 붙고, 좁으면 입력창 위에 나옴): 사장(메인)과 유형별 직원의 지금 하는 일, 모델·effort, 처리 시간
- 입력창 위 한 줄 요약: 직원이 일하거나 승인을 기다릴 때만 "사무실 · 직원 2명 일하는 중 · 승인 대기 1"
- `/office`: 패널 다시 열기
- 이 세션의 이벤트(요청·도구·서브에이전트)를 직접 받으므로 hook이나 서버가 필요 없습니다. 여러 프로젝트를 한눈에 보려면 위의 웹 사무실을 함께 쓰세요.

## 수집하는 것

hook은 hook 입력 JSON 전체를 `127.0.0.1:<포트>`로 보내고, 서버가 그중 화면에 필요한 것만 골라 `events.jsonl`에 저장합니다. 서버가 꺼져 있으면 연결이 바로 거절되어 아무것도 보내지 않습니다.

저장하는 항목:

- 이벤트 종류, 시각, 세션 ID, 서브에이전트 ID·유형, 작업 폴더, 프로젝트 이름과 저장소 전체 경로(워크트리면 원래 저장소 경로), 모델, effort
- 도구 이름과 한 줄 요약(명령, 파일 경로, 검색어, URL 등, 최대 240자)
- 서브에이전트 호출의 설명(120자)과 지시문(600자)
- 내가 입력한 프롬프트(매번, 최대 600자)
- 매 턴이 끝날 때 응답 앞부분(최대 600자), 서브에이전트가 끝날 때 응답 앞부분(최대 600자)
- 도구 실패 시 오류 메시지(최대 300자, 명령 출력 일부가 들어갈 수 있음), 알림 메시지(최대 300자)

서버가 저장 외에 읽는 것:

- **모델**: hook 입력에는 모델이 거의 없어서, Claude Code가 남기는 기록 파일에서 읽습니다. 메인 세션은 세션 기록(transcript) 끝부분에서 마지막 응답의 모델 이름(`claude-…`)만, 서브에이전트는 `subagents/agent-<ID>.meta.json`의 모델 이름만 읽습니다. 서브에이전트가 메인과 같은 모델을 쓰면(`inherit`) 메인 모델로 표시합니다. `~/.claude/projects` 아래 파일만 읽고, 모델 이름 외에는 저장하지 않습니다.
- **프로젝트 이름**: 작업 폴더에서 `git rev-parse --git-common-dir`을 실행해 저장소 경로를 구합니다(워크트리를 원래 저장소로 묶기 위해). git 저장소가 아니면 폴더 경로를 씁니다. 저장소 경로로 구분하고, 화면에는 폴더 이름을 보여 줍니다(이름이 겹치면 상위 폴더 이름을 붙임).
- **역할 설명**: 화면을 열 때 `~/.claude/agents/*.md`의 `description`을 한 번 읽어, 방 명패와 직원 카드에 보여 줍니다.

파일 내용, diff 본문, 성공한 도구의 실행 결과는 저장하지 않습니다. 명령에 토큰 같은 값을 직접 넣었다면 그 명령은 요약에 그대로 남으니 주의하세요. 기록을 지우려면 서버를 끄고 `~/.office-monitor/events.jsonl`을 지우면 됩니다. 닫은 사무실 목록(저장소 경로)은 브라우저 저장소(localStorage)에 남으니, 함께 지우려면 브라우저에서 이 페이지의 사이트 데이터를 지우세요.

서버는 `127.0.0.1`에만 열리고, 호스트 이름이 `127.0.0.1`·`localhost`가 아닌 요청과 JSON이 아닌 쓰기 요청은 거절합니다.

## 등록하는 hook

SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, SubagentStart, SubagentStop, Stop, Notification — 모두 백그라운드(`async`)로 실행되고, 실패해도 Claude Code 동작을 막지 않습니다. 권한 요청에 응답하거나 결정을 바꾸지 않습니다.

## 알려진 한계

- 시작 이벤트가 오지 않는 서브에이전트(내장 `web-fetch` 등)는 첫 작업 시점부터 "시작 기록 없음"으로 따로 표시되고, 호출할 때의 설명은 붙지 않습니다.
- 서브에이전트 종료 이벤트를 놓치면(서버가 꺼져 있던 경우 등), 마지막 활동 후 일정 시간이 지나야 끝난 것으로 표시됩니다: 아무것도 열려 있지 않으면 30분, 도구 실행 중이거나 하위 서브에이전트가 일하는 중이면 2시간, 승인 대기 중이면 하루.
- `claude -p`로 실행한 세션은 종료 이벤트가 빠져 끝나지 않은 것으로 남을 수 있습니다. Esc로 응답을 중단한 경우에도 응답 종료 이벤트가 오지 않으면, 하루 동안 "처리 중"으로 남을 수 있습니다.
- 메인 모델은 기록 파일 끝부분의 마지막 모델 ID로 읽습니다. 오래된 Claude Code 버전의 기록에는 서브에이전트 진행 상황이 섞여 있어, 서브에이전트가 도는 동안 메인 모델이 잠깐 서브에이전트 모델로 보일 수 있습니다.
- 프로젝트를 저장소로 묶으려면 `git`이 필요합니다. git이 없으면 작업 폴더별로 나뉩니다.
- `CLAUDE_CONFIG_DIR`로 설정 폴더를 바꿨다면 기록 파일이 `~/.claude/projects` 밖에 있어 모델이 표시되지 않습니다.

## 라이선스

MIT
