export type VerticalDragSession = { cancel: () => void };

export type VerticalDropTarget = {
  key: string;
  after: boolean;
};

type VerticalDragOptions = {
  event: PointerEvent;
  container: HTMLElement | null;
  item: HTMLElement | null;
  onMove: (clientY: number) => void;
  onDrop: () => void | Promise<void>;
  onCancel?: () => void;
};

let activeVerticalDrag: VerticalDragSession | null = null;

/**
 * Starts a vertical-only pointer drag with a body-level preview. The stable
 * container owns pointer capture, so moving keyed children cannot interrupt it.
 */
export function startVerticalDrag({
  event,
  container,
  item,
  onMove,
  onDrop,
  onCancel,
}: VerticalDragOptions): VerticalDragSession | null {
  if (event.button !== 0 || !container || !item) return null;
  event.preventDefault();
  activeVerticalDrag?.cancel();

  const bounds = item.getBoundingClientRect();
  const preview = item.cloneNode(true) as HTMLElement;
  preview.dataset.dragPreview = "vertical";
  preview.removeAttribute("data-sort-key");
  preview.setAttribute("aria-hidden", "true");
  Object.assign(preview.style, {
    position: "fixed",
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
    margin: "0",
    zIndex: "100",
    pointerEvents: "none",
    opacity: "0.98",
    background: "var(--card)",
    boxShadow: "0 6px 16px color-mix(in oklab, var(--foreground) 10%, transparent)",
    transform: "none",
    transition: "none",
  });
  document.body.append(preview);

  const pointerId = event.pointerId;
  const offsetY = event.clientY - bounds.top;
  let finished = false;

  const cleanup = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleDrop);
    window.removeEventListener("pointercancel", handleCancel);
    window.removeEventListener("keydown", handleKeydown);
    if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
    preview.remove();
    if (activeVerticalDrag === session) activeVerticalDrag = null;
  };

  const finish = (cancelled: boolean) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (cancelled) onCancel?.();
    else void onDrop();
  };

  function handleMove(moveEvent: PointerEvent) {
    if (moveEvent.pointerId !== pointerId) return;
    preview.style.top = `${moveEvent.clientY - offsetY}px`;
    onMove(moveEvent.clientY);
  }

  function handleDrop(upEvent: PointerEvent) {
    if (upEvent.pointerId === pointerId) finish(false);
  }

  function handleCancel(cancelEvent: PointerEvent) {
    if (cancelEvent.pointerId === pointerId) finish(true);
  }

  function handleKeydown(keyEvent: KeyboardEvent) {
    if (keyEvent.key === "Escape") finish(true);
  }

  const session: VerticalDragSession = { cancel: () => finish(true) };
  activeVerticalDrag = session;
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleDrop);
  window.addEventListener("pointercancel", handleCancel);
  window.addEventListener("keydown", handleKeydown);
  container.setPointerCapture(pointerId);
  return session;
}

export function verticalDropTarget(
  container: HTMLElement | null,
  clientY: number,
): VerticalDropTarget | null {
  if (!container) return null;
  const bounds = container.getBoundingClientRect();
  const item = document
    .elementFromPoint(bounds.left + bounds.width / 2, clientY)
    ?.closest<HTMLElement>("[data-sort-key]");
  if (!item || !container.contains(item)) return null;
  const key = item.dataset.sortKey;
  if (!key) return null;
  const itemBounds = item.getBoundingClientRect();
  return { key, after: clientY > itemBounds.top + itemBounds.height / 2 };
}

export function reorderAtVerticalTarget<T>(
  items: T[],
  draggedKey: string,
  target: VerticalDropTarget,
  keyOf: (item: T) => string,
): T[] {
  if (draggedKey === target.key) return items;
  const draggedIndex = items.findIndex((item) => keyOf(item) === draggedKey);
  const targetIndex = items.findIndex((item) => keyOf(item) === target.key);
  if (draggedIndex < 0 || targetIndex < 0) return items;
  if (
    (draggedIndex < targetIndex && !target.after) ||
    (draggedIndex > targetIndex && target.after)
  ) {
    return items;
  }

  const next = items.filter((item) => keyOf(item) !== draggedKey);
  const insertionIndex =
    next.findIndex((item) => keyOf(item) === target.key) + (target.after ? 1 : 0);
  next.splice(insertionIndex, 0, items[draggedIndex] as T);
  return next;
}
