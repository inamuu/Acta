import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// 本番ビルドの index.html にだけ CSP を挿入する。
// dev では Vite の HMR がインラインスクリプトと WebSocket を使うため付けない。
// 本番は file:// から読み込まれるため、各ディレクティブに file: を明示する
// （file:// ドキュメントでは 'self' がサブリソースに効かない環境がある）。
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' file:",
  "script-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: acta-asset: data: blob:",
  "font-src 'self' file: data:",
  "connect-src 'self' file: acta-asset:",
  "media-src 'self' file: acta-asset:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "acta-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      );
    }
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true
  }
});
