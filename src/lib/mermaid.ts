let initialized = false;
let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

async function getMermaid() {
  mermaidPromise ??= import("mermaid");
  const mod = await mermaidPromise;
  return mod.default;
}

async function ensureInit() {
  if (initialized) return;
  const mermaid = await getMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral"
  });
  initialized = true;
}

export async function renderMermaid(root: HTMLElement): Promise<void> {
  const nodes = root.querySelectorAll<HTMLElement>(".mermaid:not([data-processed])");
  if (nodes.length === 0) return;

  await ensureInit();

  // In dev, React.StrictMode can run effects twice; mermaid tags processed nodes.
  try {
    const mermaid = await getMermaid();
    await mermaid.run({ nodes });
  } catch {
    // Best-effort: keep showing the source text block if rendering fails.
  }
}
