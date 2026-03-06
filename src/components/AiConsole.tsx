import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ActaAiSettings, AiConsoleUpdate } from "../../shared/types";

type Props = {
  settings: ActaAiSettings;
  dataDir: string;
};

type ChatRole = "system" | "user" | "assistant" | "error";
type ProgressTone = "neutral" | "active" | "done" | "error";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

type ProgressItem = {
  id: string;
  label: string;
  detail?: string;
  tone: ProgressTone;
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

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function shorten(text: string, maxLen = 88): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

export function AiConsole({ settings, dataDir }: Props) {
  const api = window.acta;
  const [sessionId, setSessionId] = useState("");
  const [starting, setStarting] = useState(false);
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activities, setActivities] = useState<ProgressItem[]>([]);
  const [phaseLabel, setPhaseLabel] = useState("待機中");
  const [activeCommand, setActiveCommand] = useState("");
  const [turnStartedAtMs, setTurnStartedAtMs] = useState<number | null>(null);
  const [lastTurnDurationMs, setLastTurnDurationMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");
  const pollingRef = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const messageSeqRef = useRef(0);
  const assistantDraftIdRef = useRef("");

  const bootstrapInstruction = useMemo(() => buildBootstrapInstruction(settings, dataDir), [settings, dataDir]);
  const running = Boolean(sessionId);

  function nextId(): string {
    return `${Date.now()}-${messageSeqRef.current++}`;
  }

  function pushActivity(label: string, tone: ProgressTone, detail?: string) {
    setActivities((prev) => [
      ...prev.slice(-5),
      {
        id: nextId(),
        label,
        detail,
        tone
      }
    ]);
  }

  function pushMessage(role: ChatRole, text: string) {
    const clean = String(text ?? "").trim();
    if (!clean) return;
    const nextMessageId = nextId();
    setMessages((prev) => [...prev, { id: nextMessageId, role, text: clean }]);
  }

  function startAssistantDraft() {
    finalizeAssistantDraft(true);
    const draftId = nextId();
    assistantDraftIdRef.current = draftId;
    setMessages((prev) => [...prev, { id: draftId, role: "assistant", text: "" }]);
  }

  function appendAssistantText(text: string) {
    const chunk = String(text ?? "");
    if (!chunk) return;

    setMessages((prev) => {
      const currentId = assistantDraftIdRef.current;
      if (currentId) {
        return prev.map((message) => (message.id === currentId ? { ...message, text: message.text + chunk } : message));
      }

      const nextMessageId = nextId();
      assistantDraftIdRef.current = nextMessageId;
      return [...prev, { id: nextMessageId, role: "assistant", text: chunk }];
    });
  }

  function finalizeAssistantDraft(dropIfEmpty = false) {
    const currentId = assistantDraftIdRef.current;
    if (dropIfEmpty && currentId) {
      setMessages((prev) =>
        prev.filter((message) => !(message.id === currentId && message.role === "assistant" && !message.text.trim()))
      );
    }
    assistantDraftIdRef.current = "";
  }

  function consumeUpdate(update: AiConsoleUpdate) {
    switch (update.kind) {
      case "assistant":
        appendAssistantText(update.text);
        return;
      case "status":
        setPhaseLabel(update.label || "待機中");
        if (update.tone === "done" || update.tone === "error" || update.label === "待機中") {
          finalizeAssistantDraft();
        }
        setActivities((prev) => [
          ...prev.slice(-5),
          {
            id: update.id,
            label: update.label,
            detail: update.detail,
            tone: update.tone
          }
        ]);
        return;
      case "command":
        setActiveCommand(update.status === "started" ? update.command : "");
        setActivities((prev) => [
          ...prev.slice(-5),
          {
            id: update.id,
            label: update.status === "started" ? "コマンド実行" : "コマンド完了",
            detail: shorten(update.command),
            tone:
              update.status === "started"
                ? "active"
                : typeof update.exitCode === "number" && update.exitCode !== 0
                  ? "error"
                  : "done"
          }
        ]);
        return;
      case "error":
        finalizeAssistantDraft();
        pushMessage("error", update.text);
        setActivities((prev) => [
          ...prev.slice(-5),
          {
            id: update.id,
            label: "エラー",
            detail: shorten(update.text),
            tone: "error"
          }
        ]);
        return;
      default:
        return;
    }
  }

  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (thinking && turnStartedAtMs) {
      const tick = () => setElapsedMs(Math.max(0, Date.now() - turnStartedAtMs));
      tick();
      const timer = window.setInterval(tick, 250);
      return () => window.clearInterval(timer);
    }

    setElapsedMs(0);
    return undefined;
  }, [thinking, turnStartedAtMs]);

  useEffect(() => {
    if (!sessionId) {
      setThinking(false);
      setActiveCommand("");
      setTurnStartedAtMs(null);
    }
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
        setPhaseLabel(res.phaseLabel || (res.busy ? "応答を考えています" : "待機中"));
        setActiveCommand(res.activeCommand ?? "");
        setTurnStartedAtMs(res.turnStartedAtMs ?? null);
        setLastTurnDurationMs(res.lastTurnDurationMs ?? null);
        setError(res.error || "");

        for (const update of res.updates) {
          consumeUpdate(update);
        }

        if (!res.busy) {
          finalizeAssistantDraft();
        }

        if (!res.alive) {
          setSessionId("");
          setThinking(false);
          finalizeAssistantDraft(true);
          if (typeof res.exitCode === "number") {
            pushMessage("system", `[AIセッション終了: code=${res.exitCode}]`);
          }
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg || "AI出力の読み込みに失敗しました");
        pushMessage("error", msg || "AI出力の読み込みに失敗しました");
        pushActivity("読み込み失敗", "error", shorten(msg || "AI出力の読み込みに失敗しました"));
        setThinking(false);
        setSessionId("");
        finalizeAssistantDraft(true);
      } finally {
        pollingRef.current = false;
      }
    }, 90);

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
      setPhaseLabel("待機中");
      setActiveCommand("");
      setTurnStartedAtMs(null);
      pushMessage("system", `[AIセッション開始] ${settings.cliPath}`);
      pushActivity("セッション開始", "neutral", shorten(settings.cliPath, 64));

      const boot = bootstrapInstruction.trim();
      if (boot) {
        await api.aiSendInput({ sessionId: sid, input: boot });
        pushMessage("system", "[初期指示を送信しました]");
        pushActivity("初期指示を設定", "neutral");
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
      startAssistantDraft();
      pushActivity("入力を送信", "active", shorten(text));
      setThinking(true);
      setPhaseLabel("CLI に送信しています");
      setTurnStartedAtMs(Date.now());
      setLastTurnDurationMs(null);
      await api.aiSendInput({ sessionId: sid, input: text });
      setInput("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || "送信に失敗しました");
      finalizeAssistantDraft(true);
      pushActivity("送信失敗", "error", shorten(msg || "送信に失敗しました"));
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
      setActiveCommand("");
      setTurnStartedAtMs(null);
      finalizeAssistantDraft(true);
      pushActivity("セッション停止", "neutral");
      pushMessage("system", "[AIセッション停止]");
    }
  }

  const progressMeta = thinking
    ? `経過 ${formatDuration(elapsedMs)}`
    : lastTurnDurationMs
      ? `前回 ${formatDuration(lastTurnDurationMs)}`
      : running
        ? "接続済み"
        : "未接続";

  return (
    <section className="aiConsole">
      <div className="aiConsoleHeader">
        <div className="aiConsoleTitle">AI 対話</div>
        <div className={`aiConsoleStatus ${running ? "isLive" : ""}`}>{running ? "接続中" : "未接続"}</div>
        <div className={`aiThinking ${thinking ? "isActive" : ""}`}>
          <span className="aiThinkingDot" />
          {phaseLabel}
        </div>
        <div className="aiLatencyBadge">{progressMeta}</div>
        <div className="aiConsoleActions">
          <button className="ghostBtn" type="button" disabled={running || starting} onClick={() => void ensureSession()}>
            {starting ? "接続中..." : "接続"}
          </button>
          <button className="ghostBtn" type="button" disabled={!running} onClick={() => void handleStop()}>
            停止
          </button>
          <button
            className="ghostBtn"
            type="button"
            onClick={() => {
              setMessages([]);
              setActivities([]);
              setError("");
              setLastTurnDurationMs(null);
              finalizeAssistantDraft();
            }}
          >
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

      <div className="aiProgressPanel">
        <div className="aiProgressSummary">
          <div>
            <div className="aiProgressLabel">進捗</div>
            <div className={`aiProgressValue ${thinking ? "isActive" : ""}`}>{phaseLabel}</div>
          </div>
          <div className="aiProgressMetric">{progressMeta}</div>
        </div>

        {activeCommand ? <div className="aiProgressCommand">実行中: {activeCommand}</div> : null}

        <div className="aiProgressSteps">
          {activities.length === 0 ? (
            <div className="aiProgressEmpty">CLI の状態と使用コマンドをここに表示します</div>
          ) : (
            activities.map((item) => (
              <div key={item.id} className={`aiProgressStep aiProgressStep--${item.tone}`}>
                <div className="aiProgressStepLabel">{item.label}</div>
                {item.detail ? <div className="aiProgressStepDetail">{item.detail}</div> : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div ref={feedRef} className="aiChatFeed">
        {messages.length === 0 ? (
          <div className="aiChatEmpty">ここに対話ログが表示されます</div>
        ) : (
          messages.map((message) => {
            const isStreaming = thinking && message.id === assistantDraftIdRef.current;
            return (
              <div
                key={message.id}
                className={`aiMsg aiMsg--${message.role} ${isStreaming ? "isStreaming" : ""}`.trim()}
              >
                <div className="aiMsgRole">{roleLabel(message.role)}</div>
                <div className="aiMsgBody">{message.text || (isStreaming ? "..." : "")}</div>
              </div>
            );
          })
        )}
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
    </section>
  );
}
