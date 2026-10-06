import React, { useEffect, useRef, useState } from "react";
import type { ActaThemeId, SaveSettingsPayload } from "../../shared/types";

const THEME_OPTIONS: Array<{ value: ActaThemeId; label: string }> = [
  { value: "default", label: "default（標準）" },
  { value: "dracula", label: "dracula" },
  { value: "solarized-dark", label: "solarized dark" },
  { value: "solarized-light", label: "solarized light" },
  { value: "morokai", label: "morokai" },
  { value: "morokai-light", label: "morokai light" },
  { value: "tokyo-night", label: "tokyo night" },
  { value: "nord", label: "nord" },
  { value: "gruvbox-dark", label: "gruvbox dark" },
  { value: "github-light", label: "github light" },
  { value: "gruvbox-light", label: "gruvbox light" },
  { value: "catppuccin-latte", label: "catppuccin latte" },
  { value: "tokyo-night-day", label: "tokyo night day" }
];

type Props = {
  dataDir: string;
  theme: ActaThemeId;
  onChooseDataDir: () => Promise<void>;
  onSaveSettings: (payload: SaveSettingsPayload) => Promise<void>;
  onClose: () => void;
};

export function SettingsModal({ dataDir, theme: themeProp, onChooseDataDir, onSaveSettings, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [theme, setTheme] = useState<ActaThemeId>(themeProp);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    setTheme(themeProp);
  }, [themeProp]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]'
        );
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  async function saveSettings() {
    if (saving) return;

    setSaving(true);
    setSaveMessage("");
    try {
      await onSaveSettings({ theme });
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
      <div ref={dialogRef} className="modalCard" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <div className="modalTitle">設定</div>
          <button className="modalClose" ref={closeRef} type="button" onClick={() => onClose()} title="閉じる" aria-label="設定を閉じる">
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
            <label className="settingLabel" htmlFor="settings-theme">テーマ</label>
            <select id="settings-theme" className="settingTextInput" value={theme} onChange={(e) => { setTheme(e.target.value as ActaThemeId); setSaveMessage(""); }}>
              {THEME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>

            <div className="settingActions">
              <button className="primaryBtn" type="button" onClick={() => void saveSettings()} disabled={saving || theme === themeProp}>
                {saving ? "保存中..." : "テーマを保存"}
              </button>
              <div className="settingHint" role="status" aria-live="polite">{saveMessage || (theme !== themeProp ? "テーマの変更は未保存です" : "")}</div>
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
