import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "highlight.js/styles/github.css";
import "./styles.css";

// macOS はフレームレス (hiddenInset) なので、ウィンドウ移動用のバーを表示する。
if (/Mac/i.test(navigator.userAgent)) {
  document.documentElement.dataset.os = "mac";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
