import React, { useEffect, useRef } from "react";

type Props = {
  dataDir: string;
  onChooseDataDir: () => Promise<void>;
  onClose: () => void;
};

export function SettingsModal({ dataDir, onChooseDataDir, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

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

          <div className="settingHint">
            タグは先頭3文字が同じもの同士で、左メニューにグループ表示されます（例: AWS, AWS_ECR, AWS_SG）。
          </div>
        </div>
      </div>
    </div>
  );
}
