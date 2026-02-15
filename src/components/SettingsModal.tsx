import React, { useEffect, useRef, useState } from "react";
import type { ActaThemeId, SaveAiSettingsPayload } from "../../shared/types";

const THEME_OPTIONS: Array<{ value: ActaThemeId; label: string }> = [
  { value: "default", label: "default（現在のテーマ）" },
  { value: "dracula", label: "dracula" },
  { value: "solarized-dark", label: "solarized dark" },
  { value: "solarized-light", label: "solarized light" },
  { value: "morokai", label: "morokai" },
  { value: "morokai-light", label: "morokai light" },
  { value: "tokyo-night", label: "tokyo night" },
  { value: "nord", label: "nord" },
  { value: "gruvbox-dark", label: "gruvbox dark" }
];

type Props = {
  dataDir: string;
  aiCliPath: string;
  aiInstructionMarkdown: string;
  aiTheme: ActaThemeId;
  onChooseDataDir: () => Promise<void>;
  onSaveAiSettings: (payload: SaveAiSettingsPayload) => Promise<void>;
  onClose: () => void;
};

export function SettingsModal({
  dataDir,
  aiCliPath,
  aiInstructionMarkdown,
  aiTheme,
  onChooseDataDir,
  onSaveAiSettings,
  onClose
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [cliPath, setCliPath] = useState(aiCliPath);
  const [instructionMarkdown, setInstructionMarkdown] = useState(aiInstructionMarkdown);
  const [theme, setTheme] = useState<ActaThemeId>(aiTheme);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    setCliPath(aiCliPath);
  }, [aiCliPath]);

  useEffect(() => {
    setInstructionMarkdown(aiInstructionMarkdown);
  }, [aiInstructionMarkdown]);

  useEffect(() => {
    setTheme(aiTheme);
  }, [aiTheme]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function saveAiSettings() {
    if (saving) return;

    setSaving(true);
    setSaveMessage("");
    try {
      await onSaveAiSettings({
        cliPath,
        instructionMarkdown,
        theme
      });
      setSaveMessage("保存しました");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveMessage(msg || "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" aria-label="設定" onMouseDown={() => onClose()}>
      <div className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitle">設定</div>
          <button className="modalClose" ref={closeRef} type="button" onClick={() => onClose()} title="閉じる">
            ×
          </button>
        </div>

        <div className="modalBody">
          <div className="settingBlock">
            <div className="settingLabel">保存先</div>
            <div className="settingRow">
              <div className="settingValue">{dataDir || "..."}</div>
              <button className="primaryBtn" type="button" onClick={() => void onChooseDataDir()}>
                変更
              </button>
            </div>
          </div>

          <div className="settingBlock">
            <div className="settingLabel">生成AI CLI</div>
            <input
              className="settingTextInput"
              type="text"
              value={cliPath}
              onChange={(e) => setCliPath(e.target.value)}
              placeholder="/opt/homebrew/bin/codex"
              spellCheck={false}
            />

            <div className="settingCol">
              <div className="settingSubLabel">テーマ</div>
              <select className="settingTextInput" value={theme} onChange={(e) => setTheme(e.target.value as ActaThemeId)}>
                {THEME_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="settingCol">
              <div className="settingSubLabel">指示 (Markdown)</div>
              <textarea
                className="settingTextarea"
                value={instructionMarkdown}
                onChange={(e) => setInstructionMarkdown(e.target.value)}
                spellCheck={false}
                placeholder="生成AIへ毎回渡す指示をMarkdownで記載"
              />
            </div>

            <div className="settingActions">
              <button className="primaryBtn" type="button" onClick={() => void saveAiSettings()} disabled={saving}>
                {saving ? "保存中..." : "保存"}
              </button>
              {saveMessage ? <div className="settingHint">{saveMessage}</div> : null}
            </div>
          </div>

          <div className="settingHint">
            タグは先頭3文字が同じもの同士で、左メニューにグループ表示されます（例: AWS, AWS_ECR, AWS_SG）。
          </div>
        </div>
      </div>
    </div>
  );
}
