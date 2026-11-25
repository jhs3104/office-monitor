#!/usr/bin/env node
// 서브에이전트 모니터 수집 서버 (의존성 없음, Node 18+)
//   node server.mjs           → http://127.0.0.1:47318
//   OFFICE_MONITOR_PORT       포트 변경 (hook도 같은 환경 변수를 읽는다)
//   OFFICE_MONITOR_DATA       기록 폴더 (기본 ~/.office-monitor)
// Claude Code hook이 POST /events 로 hook 입력 JSON을 보내면
// 필요한 필드만 남겨 <기록 폴더>/events.jsonl 에 쌓고, 브라우저에 SSE로 흘려보낸다.
// 내 컴퓨터에서만 쓰는 도구다: 127.0.0.1에만 열고, 다른 호스트 이름으로 온 요청은 거절한다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OFFICE_MONITOR_PORT || 47318);
const DATA_DIR = process.env.OFFICE_MONITOR_DATA || path.join(os.homedir(), ".office-monitor");
const LOG = path.join(DATA_DIR, "events.jsonl");
const MAX_KEEP = 5000;

fs.mkdirSync(DATA_DIR, { recursive: true });

const cut = (s, n = 240) => (typeof s === "string" && s.length > n ? s.slice(0, n) + "…" : s);
// 문자열로 바꾸고 길이를 제한한다. 값이 없으면 null.
const str = (v, n = 200) => (v == null || v === "" ? null : cut(String(v), n));

// 도구 입력에서 화면에 필요한 한 줄 요약만 뽑는다. 파일 내용·diff 본문은 저장하지 않는다.
function summarizeInput(tool, input = {}) {
  if (!input || typeof input !== "object") return "";
  const pick =
    input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ??
    input.query ?? input.description ?? input.skill ?? input.prompt ?? "";
  let s = String(pick);
  if (input.pattern && input.path) s = `${input.pattern}  (${input.path})`;
  return cut(s.replace(/\s+/g, " ").trim(), 240);
}

function slim(p) {
  const e = {
    ts: Date.now(),
    event: str(p.hook_event_name, 40),
    session: str(p.session_id, 80),
    agent: str(p.agent_id, 80),          // 서브에이전트 안에서 발생한 이벤트면 채워짐
    agentType: str(p.agent_type, 80),
    cwd: str(p.cwd, 300),
  };
  const ti = p.tool_input && typeof p.tool_input === "object" ? p.tool_input : {};
  if (p.tool_name) {
    e.tool = str(p.tool_name, 80);
    e.toolUseId = str(p.tool_use_id, 80);
    e.arg = summarizeInput(p.tool_name, ti);
    if (e.tool === "Agent" || e.tool === "Task") {
      e.spawn = {
        type: str(ti.subagent_type, 80) || "general-purpose",
        description: str(ti.description, 120) || "",
        prompt: str(ti.prompt, 600) || "",
        model: str(ti.model, 80),
      };
    }
  }
  if (e.event === "PostToolUseFailure") e.error = str(p.error ?? p.tool_response?.error, 300) || "실패";
  if (e.event === "UserPromptSubmit") e.prompt = str(p.prompt, 600) || "";
  if (e.event === "Notification") e.message = str(p.message, 300) || "";
  if (e.event === "SessionStart") e.source = str(p.source, 40);
  if (e.event === "SessionStart" || e.event === "SubagentStart") e.model = str(p.model, 80);
  if (e.event === "SubagentStop" || e.event === "Stop") e.result = str(p.last_assistant_message, 600) || "";
  return e;
}

const events = [];
if (fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, "utf8").split("\n")) {
    if (!line) continue;
    try { events.push(JSON.parse(line)); } catch {}
  }
  events.splice(0, Math.max(0, events.length - MAX_KEEP));
}

const clients = new Set();
function broadcast(e) {
  const msg = `data: ${JSON.stringify(e)}\n\n`;
  for (const res of clients) res.write(msg);
}

// 다른 웹사이트가 브라우저를 통해 이 서버에 접근하지 못하게(DNS rebinding) 호스트 이름을 확인한다
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const isJson = req => (req.headers["content-type"] || "").split(";")[0].trim() === "application/json";

const server = http.createServer((req, res) => {
  if (!ALLOWED_HOSTS.has(req.headers.host || "")) { res.writeHead(403).end(); return; }
  let url;
  try { url = new URL(req.url, "http://127.0.0.1"); } catch { res.writeHead(400).end(); return; }

  // 쓰기 요청은 JSON만 받는다 (웹페이지가 사전 확인 없이 보낼 수 있는 형식은 거절)
  if (req.method === "POST" && !isJson(req)) { res.writeHead(415).end(); return; }

  if (req.method === "POST" && url.pathname === "/events") {
    const chunks = []; let size = 0;
    req.on("data", c => { size += c.length; if (size > 5e6) req.destroy(); else chunks.push(c); });
    req.on("end", () => {
      try {
        const p = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!p || typeof p !== "object" || typeof p.hook_event_name !== "string") throw new Error("not a hook event");
        const e = slim(p);
        events.push(e);
        if (events.length > MAX_KEEP) events.shift();
        fs.appendFileSync(LOG, JSON.stringify(e) + "\n");
        broadcast(e);
        res.writeHead(204).end();
      } catch {
        res.writeHead(400).end();
      }
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/roles") {
    // ~/.claude/agents/*.md 의 name·description (사용자 정의 에이전트의 역할 설명)
    const roles = {};
    const dir = path.join(os.homedir(), ".claude", "agents");
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".md")) continue;
        const fm = fs.readFileSync(path.join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---/);
        if (!fm) continue;
        const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() || f.slice(0, -3);
        const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
        if (desc) roles[name] = cut(desc.replace(/^["']|["']$/g, ""), 300);
      }
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(roles));
    return;
  }

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(events));
    return;
  }

  if (req.method === "GET" && url.pathname === "/events/stream") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: history\ndata: ${JSON.stringify(events)}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 15000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (req.method === "POST" && url.pathname === "/events/clear") {
    events.length = 0;
    fs.writeFileSync(LOG, "");
    broadcast({ event: "__clear" });
    res.writeHead(204).end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(ROOT, "index.html")).pipe(res);
    return;
  }

  res.writeHead(404).end();
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") console.error(`포트 ${PORT}을(를) 이미 다른 프로그램이 쓰고 있습니다. OFFICE_MONITOR_PORT로 다른 포트를 지정하세요 (hook을 실행하는 셸에도 같은 값).`);
  else console.error(err.message);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  console.log(`office-monitor → http://127.0.0.1:${PORT}`);
});
