import {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useRef,
  useState,
} from 'react';

const COLUMN_STEP = 16;

export function useColumnWidths<const T extends readonly number[]>(defaults: T) {
  const [widths, setWidths] = useState<number[]>([...defaults]);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  const setWidth = useCallback((index: number, width: number) => {
    setWidths((current) => current.map((value, columnIndex) => (columnIndex === index ? width : value)));
  }, []);
  const resetWidth = useCallback((index: number) => setWidth(index, defaults[index]), [defaults, setWidth]);

  return { widths, totalWidth, setWidth, resetWidth };
}

export function ColumnResizeHandle({
  label,
  width,
  minWidth = 72,
  maxWidth = 640,
  onChange,
  onReset,
}: {
  label: string;
  width: number;
  minWidth?: number;
  maxWidth?: number;
  onChange: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  const clamp = (value: number) => Math.min(maxWidth, Math.max(minWidth, value));
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') nextWidth = width - COLUMN_STEP;
    if (event.key === 'ArrowRight') nextWidth = width + COLUMN_STEP;
    if (event.key === 'Home') nextWidth = minWidth;
    if (event.key === 'End') nextWidth = maxWidth;
    if (nextWidth === null) return;
    event.preventDefault();
    onChange(clamp(nextWidth));
  };

  return (
    <div
      role="separator"
      aria-label={`Resize ${label} column`}
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title={`Drag to resize ${label}. Double-click to reset.`}
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        onChange(clamp(drag.current.startWidth + event.clientX - drag.current.startX));
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={() => { drag.current = null; }}
      className="group absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <span className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-0.5 group-hover:bg-primary group-focus-visible:w-0.5 group-focus-visible:bg-primary" />
    </div>
  );
}

export function ResizableDetailLayout({
  list,
  detail,
  label,
  initialListPercent = 58,
}: {
  list: ReactNode;
  detail: ReactNode;
  label: string;
  initialListPercent?: number;
}) {
  const [listPercent, setListPercent] = useState(initialListPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startPercent: number; width: number } | null>(null);
  const clamp = (value: number) => Math.min(72, Math.max(38, value));
  const layout = `minmax(420px, ${listPercent}fr) 10px minmax(320px, ${100 - listPercent}fr)`;
  const style = { '--pane-layout': layout } as CSSProperties;

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const updateFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const stepPercent = (24 / containerRef.current.clientWidth) * 100;
    let next: number | null = null;
    if (event.key === 'ArrowLeft') next = listPercent - stepPercent;
    if (event.key === 'ArrowRight') next = listPercent + stepPercent;
    if (event.key === 'Home') next = 38;
    if (event.key === 'End') next = 72;
    if (next === null) return;
    event.preventDefault();
    setListPercent(clamp(next));
  };

  return (
    <div
      ref={containerRef}
      style={style}
      className="grid min-h-0 gap-y-4 xl:flex-1 xl:grid-cols-[var(--pane-layout)] xl:gap-y-0"
    >
      {list}
      <div
        role="separator"
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={38}
        aria-valuemax={72}
        aria-valuenow={Math.round(listPercent)}
        tabIndex={0}
        title="Drag to resize the result list and detail panes. Double-click to reset."
        onDoubleClick={() => setListPercent(initialListPercent)}
        onKeyDown={updateFromKeyboard}
        onPointerDown={(event) => {
          if (event.button !== 0 || !containerRef.current) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startPercent: listPercent,
            width: containerRef.current.clientWidth,
          };
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId !== event.pointerId) return;
          setListPercent(clamp(drag.current.startPercent + ((event.clientX - drag.current.startX) / drag.current.width) * 100));
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={() => { drag.current = null; }}
        className="group relative hidden cursor-col-resize touch-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary xl:block"
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:w-1 group-hover:rounded-full group-hover:bg-primary/70 group-focus-visible:w-1 group-focus-visible:rounded-full group-focus-visible:bg-primary" />
      </div>
      {detail}
    </div>
  );
}
