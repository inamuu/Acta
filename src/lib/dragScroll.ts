type DragAxis = "both" | "x" | "y";

type DragScrollOptions = {
  axis?: DragAxis;
  thresholdPx?: number;
};

function isElement(v: unknown): v is Element {
  return typeof v === "object" && v !== null && "closest" in (v as any);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!isElement(target)) return false;
  // Avoid stealing gestures from controls / links / editable content.
  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a",
        "label",
        "[contenteditable='true']",
        // Markdown blocks are often selected/copied; keep native text selection.
        ".md",
        "[data-no-drag-scroll]",
        ".noDragScroll"
      ].join(",")
    )
  );
}

/**
 * Install "grab to scroll" behavior to an overflow container.
 * - Left-drag scrolls the container.
 * - Interactive elements are ignored (inputs/buttons/links/etc).
 */
export function installDragScroll(el: HTMLElement, opts: DragScrollOptions = {}): () => void {
  const axis: DragAxis = opts.axis ?? "both";
  const thresholdPx = Math.max(0, opts.thresholdPx ?? 3);

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;
  let active = false;
  let dragging = false;
  let suppressClick = false;

  function clear() {
    pointerId = null;
    active = false;
    dragging = false;
    el.classList.remove("isDragScrolling");
    document.documentElement.classList.remove("dragScrollNoSelect");
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // left only
    if (pointerId !== null) return;
    if (isInteractiveTarget(e.target)) return;

    pointerId = e.pointerId;
    active = true;
    dragging = false;
    suppressClick = false;

    startX = e.clientX;
    startY = e.clientY;
    startScrollLeft = el.scrollLeft;
    startScrollTop = el.scrollTop;

    try {
      el.setPointerCapture(pointerId);
    } catch {
      // ignore
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!active || pointerId === null || e.pointerId !== pointerId) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) + Math.abs(dy) < thresholdPx) return;
      dragging = true;
      suppressClick = true;
      el.classList.add("isDragScrolling");
      document.documentElement.classList.add("dragScrollNoSelect");
    }

    // Prevent text selection / native drag behaviors while panning.
    e.preventDefault();

    if (axis === "both" || axis === "x") el.scrollLeft = startScrollLeft - dx;
    if (axis === "both" || axis === "y") el.scrollTop = startScrollTop - dy;
  }

  function onPointerUp(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    clear();
  }

  function onPointerCancel(e: PointerEvent) {
    if (pointerId === null || e.pointerId !== pointerId) return;
    clear();
  }

  function onClickCapture(e: MouseEvent) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }

  // Use non-passive move so we can preventDefault while dragging.
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove, { passive: false });
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);
  el.addEventListener("click", onClickCapture, true);

  return () => {
    clear();
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove as any);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerCancel);
    el.removeEventListener("click", onClickCapture, true);
  };
}
