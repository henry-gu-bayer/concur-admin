import { UIEvent, useMemo, useRef, useState } from 'react';

export const VIRTUAL_TABLE_ROW_HEIGHT = 37;
const DEFAULT_OVERSCAN = 8;

export function useVirtualTableRows({
  rowCount,
  headerHeight,
  initialScrollTop = 0,
  rowHeight = VIRTUAL_TABLE_ROW_HEIGHT,
  overscan = DEFAULT_OVERSCAN,
  onNearEnd,
}: {
  rowCount: number;
  headerHeight: number;
  initialScrollTop?: number;
  rowHeight?: number;
  overscan?: number;
  onNearEnd?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(initialScrollTop);
  const [viewportHeight, setViewportHeight] = useState(500);
  const range = useMemo(() => {
    const start = Math.max(0, Math.floor(Math.max(0, scrollTop - headerHeight) / rowHeight) - overscan);
    const end = Math.min(rowCount, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
    return {
      start,
      end,
      topSpacerHeight: start * rowHeight,
      bottomSpacerHeight: Math.max(0, (rowCount - end) * rowHeight),
    };
  }, [headerHeight, overscan, rowCount, rowHeight, scrollTop, viewportHeight]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    setViewportHeight(target.clientHeight);
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 500) onNearEnd?.();
  };

  const resetScroll = () => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  return { scrollRef, scrollTop, setScrollTop, viewportHeight, range, onScroll, resetScroll };
}
