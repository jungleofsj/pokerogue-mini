/*
 * Claude strategy chat backend (used by the game window's side panel).
 * Streams responses from Claude Opus 5 with the web search tool enabled.
 */
const { ipcMain } = require("electron");

const SYSTEM_PROMPT =
  "당신은 PokéRogue(포켓로그, pokerogue.net) 공략 도우미입니다. " +
  "사용자의 주력 포켓몬(주로 전설)의 기술 배치, 성격, 아이템, 상성 등을 간결한 한국어로 조언합니다. " +
  "PokéRogue는 본가 포켓몬과 다른 점이 많습니다(스타터 코스트, 패시브 특성, 융합, 바이옴 진행, " +
  "월별 전설 알 픽업 로테이션 등). 게임 사양이 확실하지 않으면 웹 검색으로 wiki.pokerogue.net 등을 " +
  "확인한 뒤 답하세요. 답변은 짧고 실용적으로, 목록 위주로 작성하세요.";

let deps = null; // { settings, save, target: () => webContents | null }
let client = null;
let busy = false;
const history = [];

function send(channel, payload) {
  const wc = deps.target();
  if (wc && !wc.isDestroyed()) {
    wc.send(channel, payload);
  }
}

function getClient() {
  if (client) {
    return client;
  }
  const key = deps.settings.claudeApiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // No usable key anywhere -> caller shows the key-input prompt.
    const err = new Error("no-key");
    err.noKey = true;
    throw err;
  }
  const { Anthropic } = require("@anthropic-ai/sdk");
  client = new Anthropic({ apiKey: key });
  return client;
}

async function run(text) {
  if (busy) {
    send("chat-error", "이전 답변이 아직 진행 중입니다.");
    return;
  }
  let c;
  try {
    c = getClient();
  } catch {
    send("chat-need-key");
    return;
  }
  busy = true;
  history.push({ role: "user", content: text });
  // keep the last ~12 turns so history doesn't grow unbounded
  while (history.length > 24) {
    history.shift();
  }
  if (history[0].role !== "user") {
    history.shift();
  }
  try {
    for (let i = 0; i < 5; i++) {
      const stream = c.messages.stream({
        model: "claude-opus-5",
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
        messages: history,
      });
      stream.on("text", t => send("chat-delta", t));
      stream.on("contentBlock", b => {
        if (b.type === "server_tool_use") {
          send("chat-status", "웹 검색 중…");
        }
      });
      const final = await stream.finalMessage();
      history.push({ role: "assistant", content: final.content });
      if (final.stop_reason !== "pause_turn") {
        break;
      }
    }
    send("chat-done");
  } catch (err) {
    const { Anthropic } = require("@anthropic-ai/sdk");
    if (err instanceof Anthropic.AuthenticationError) {
      client = null;
      send("chat-need-key");
      send("chat-error", "API 키가 유효하지 않습니다.");
    } else {
      send("chat-error", err && err.message ? err.message : String(err));
    }
    // drop the failed turn so a retry starts clean
    if (history[history.length - 1]?.role === "user") {
      history.pop();
    }
  } finally {
    busy = false;
  }
}

function init(d) {
  deps = d;
  ipcMain.on("chat-send", (_e, text) => {
    if (typeof text === "string" && text.trim()) {
      run(text.trim());
    }
  });
  ipcMain.on("chat-set-key", (_e, key) => {
    if (typeof key === "string" && key.trim()) {
      deps.settings.claudeApiKey = key.trim();
      deps.save();
      client = null;
    }
  });
}

module.exports = { init };
