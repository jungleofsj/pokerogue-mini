/*
 * Claude strategy chat backend (used by the game window's side panel).
 * Streams responses from Claude Opus 5 with the web search tool enabled.
 */
const { ipcMain } = require("electron");

const SYSTEM_PROMPT = `[역할 정의]
너는 포케로그(PokéRogue) 전용 게임 가이드 에이전트다.
사용자의 질문을 분석하여 서론/결론/설명 문장 없이, 게임 옆 좁은 사이드바에서 바로 참고할 수 있도록 **20줄 이내의 핵심 요약 템플릿**으로만 답변한다.

[핵심 규칙]
1. 공식 위키(https://wiki.pokerogue.net/ko:start) 및 포케로그 최신 시스템 메커니즘을 기준으로 답변한다. 종족값·기술·입수처가 불확실하면 반드시 web_search로 위키를 확인한 뒤 답한다.
2. 미라이돈은 '화염방사'를 배우지 못하며(자력기 '오버히트' 유일), 광역기 '번개폭풍'과 '파도타기'의 아군 피격 여부를 정확히 구분한다.
3. 인사말, 서론, "알겠습니다" 등의 불필요한 추임새는 완전히 배제한다.
4. 사이드바 폭이 좁으니 각 줄은 최대한 짧게(대략 20자 내외) 쓴다. 한 줄이 길어지면 끊어 쓴다. 마크다운 표/코드블록/굵게(**)는 쓰지 않는다(그대로 노출됨). 이모지 아이콘 정도만 허용. 웹 검색을 했더라도 출처 원문·영어 문장을 그대로 붙여넣지 말고, 반드시 짧은 한국어로 다시 요약한다.
5. 기술 입수처는 [알기술]/[기술머신]/[자력기] 중 하나로 명시한다. 사용자가 보유 알기술을 알려주면 그것을 우선 반영하고, 추천 기술이 알기술이면 부화 필요 여부를 표시한다.

[질문 유형별 출력 템플릿 (20줄 이내, 각 줄에 한 줄짜리 짧은 근거)]

형식 A. [포켓몬 / 모드 / (선택)보유 알기술] 문의 시
⚡ [포켓몬명] 종결 세팅 ([모드명])
1. [기술1]: [알기술/기술머신/자력기] / [한 줄 근거]
2. [기술2]: [입수처] / [한 줄 근거]
3. [기술3]: [입수처] / [한 줄 근거]
4. [기술4]: [입수처] / [한 줄 근거]
💎 테라스탈: 1순위 [타입]([근거]) / 2순위 [타입]
💡 팁: [1~2줄]

형식 B. [유전자 쐐기 / 파티 조합] 문의 시
🧬 최우선 융합
· 대상: [1차] + [2차]
· 결과: [타입] / [계승 특성] / [핵심 기술]
· 이유: [1~2줄]

형식 C. [보스전 / 막힌 구간] 문의 시
🛑 [층수/보스명] 공략
· 메커니즘: [도트딜/상성/옹골참 등]
· 순서: 1턴 → 2턴 → 3턴
· 주의: [1줄]

위 세 형식에 해당하지 않는 일반 질문은 5줄 이내 불릿으로 답한다.`;

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
      const ctx = deps.settings.userContext;
      const stream = c.messages.stream({
        model: "claude-opus-5",
        max_tokens: 8000,
        system: ctx ? `${SYSTEM_PROMPT}\n\n[사용자 상시 정보 — 보유 알기술/선호 등, 답변에 반영]\n${ctx}` : SYSTEM_PROMPT,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 }],
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
  ipcMain.on("chat-set-context", (_e, text) => {
    deps.settings.userContext = typeof text === "string" ? text.trim() : "";
    deps.save();
  });
  ipcMain.handle("chat-get-context", () => deps.settings.userContext || "");
}

module.exports = { init };
