import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ActaAiSettings } from "../../shared/types";

type Props = {
  settings: ActaAiSettings;
  dataDir: string;
};

type ChatRole = "system" | "user" | "assistant" | "error";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

function roleLabel(role: ChatRole): string {
  switch (role) {
    case "assistant":
      return "AI";
    case "user":
      return "あなた";
    case "system":
      return "SYSTEM";
    case "error":
      return "ERROR";
    default:
      return "";
  }
}

function buildBootstrapInstruction(settings: ActaAiSettings, dataDir: string): string {
  const dir = String(dataDir ?? "").trim();
  const instruction = String(settings?.instructionMarkdown ?? "").trim();
  const dataBlock = dir ? `<data>${dir}</data>` : "";

  if (dataBlock && instruction) return `${dataBlock}\n\n${instruction}`;
  if (instruction) return instruction;
  return dataBlock;
}

export function AiConsole({ settings, dataDir }: Props) {
  const api = window.acta;
  const [sessionId, setSessionId] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState("");
  const pollingRef = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const messageSeqRef = useRef(0);

  const bootstrapInstruction = useMemo(() => buildBootstrapInstruction(settings, dataDir), [settings, dataDir]);
  const running = Boolean(sessionId);

  function pushMessage(role: ChatRole, text: string) {
    const clean = String(text ?? "").trim();
    if (!clean) return;
    const nextId = `${Date.now()}-${messageSeqRef.current++}`;
    setMessages((prev) => [...prev, { id: nextId, role, text: clean }]);
  }

  function consumeChunk(chunk: string) {
    const text = String(chunk ?? "").trim();
    if (!text) return;

    if (text.includes("[AI実行失敗") || text.includes("[実行ログ]") || text.includes("[エラー]")) {
      pushMessage("error", text);
      return;
    }
    if (text.startsWith("[") && text.endsWith("]")) {
      pushMessage("system", text);
      return;
    }
    pushMessage("assistant", text);
  }

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!sessionId) setThinking(false);
  }, [sessionId]);

  useEffect(() => {
    if (!api || !sessionId) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      if (cancelled || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const res = await api.aiReadOutput({ sessionId });
        if (cancelled) return;
        setThinking(Boolean(res.busy));
        if (res.chunk) consumeChunk(res.chunk);

        if (!res.alive) {
          setSessionId("");
          setThinking(false);
          if (typeof res.exitCode === "number") {
            pushMessage("system", `[AIセッション終了: code=${res.exitCode}]`);
          }
          if (res.error) {
            pushMessage("error", `[エラー] ${res.error}`);
          }
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "AI出力の読み込みに失敗しました");
        pushMessage("error", msg || "AI出力の読み込みに失敗しました");
        setThinking(false);
        setSessionId("");
      } finally {
        pollingRef.current = false;
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, sessionId]);

  async function ensureSession(): Promise<string> {
    if (!api) throw new Error("APIが利用できません");
    if (sessionId) return sessionId;
    if (!settings.cliPath.trim()) throw new Error("CLIパスが未設定です（設定から指定してください）");

    setStarting(true);
    setError("");
    try {
      const started = await api.aiStartSession({ cliPath: settings.cliPath });
      const sid = started.sessionId;
      setSessionId(sid);
      setThinking(false);
      pushMessage("system", `[AIセッション開始] ${settings.cliPath}`);

      const boot = bootstrapInstruction.trim();
      if (boot) {
        await api.aiSendInput({ sessionId: sid, input: boot });
        pushMessage("system", "[初期指示を送信しました]");
      }
      return sid;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(msg || "AIセッション開始に失敗しました");
    } finally {
      setStarting(false);
    }
  }

  async function handleSend() {
    if (!api) return;
    const text = input.trim();
    if (!text || sending || thinking) return;

    setSending(true);
    setError("");
    try {
      const sid = await ensureSession();
      pushMessage("user", text);
      await api.aiSendInput({ sessionId: sid, input: text });
      setThinking(true);
      setInput("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "送信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  async function handleStop() {
    if (!api || !sessionId) return;
    try {
      await api.aiStopSession({ sessionId });
    } catch {
      // ignore
    } finally {
      setSessionId("");
      setThinking(false);
      pushMessage("system", "[AIセッション停止]");
    }
  }

  return (
    <section className="aiConsole">
      <div className="aiConsoleHeader">
        <div className="aiConsoleTitle">AI 対話</div>
        <div className={`aiConsoleStatus ${running ? "isLive" : ""}`}>{running ? "接続中" : "未接続"}</div>
        <div className={`aiThinking ${thinking ? "isActive" : ""}`}>
          <span className="aiThinkingDot" />
          {thinking ? "応答生成中..." : "待機中"}
        </div>
        <div className="aiConsoleActions">
          <button className="ghostBtn" type="button" disabled={running || starting} onClick={() => void ensureSession()}>
            {starting ? "接続中..." : "接続"}
          </button>
          <button className="ghostBtn" type="button" disabled={!running} onClick={() => void handleStop()}>
            停止
          </button>
          <button className="ghostBtn" type="button" onClick={() => setMessages([])}>
            クリア
          </button>
        </div>
      </div>

      <div className="aiConsoleMeta">
        <div className="aiMetaItem">
          <div className="aiMetaLabel">CLI</div>
          <div className="aiMetaValue">{settings.cliPath || "未設定"}</div>
        </div>
        <div className="aiMetaItem">
          <div className="aiMetaLabel">DATA</div>
          <div className="aiMetaValue">{dataDir || "未設定"}</div>
        </div>
      </div>

      {error ? <div className="composerError">{error}</div> : null}

      <div className="aiConsoleInputRow">
        <textarea
          className="aiConsoleInput"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="AIへの指示を入力（Cmd/Ctrl+Enter で送信）"
          onKeyDown={(e) => {
            const submit = (e.metaKey || e.ctrlKey) && e.key === "Enter";
            if (!submit) return;
            e.preventDefault();
            void handleSend();
          }}
        />
        <button
          className="primaryBtn aiSendBtn"
          type="button"
          disabled={sending || thinking || !input.trim()}
          onClick={() => void handleSend()}
        >
          {sending ? "送信中..." : "送信"}
        </button>
      </div>

      <div ref={feedRef} className="aiChatFeed">
        {messages.length === 0 ? (
          <div className="aiChatEmpty">ここに対話ログが表示されます</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`aiMsg aiMsg--${m.role}`}>
              <div className="aiMsgRole">{roleLabel(m.role)}</div>
              <div className="aiMsgBody">{m.text}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
