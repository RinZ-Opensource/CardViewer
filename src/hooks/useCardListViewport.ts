import React from "react";

// Tracks the card list's scroll position and height (via ResizeObserver) for the
// caller's virtual-window math.
export function useCardListViewport() {
  const cardListRef = React.useRef<HTMLElement | null>(null);
  const [cardListViewport, setCardListViewport] = React.useState({ height: 0, scrollTop: 0 });

  React.useEffect(() => {
    const element = cardListRef.current;
    if (!element) return;

    const update = () => {
      setCardListViewport({
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const updateCardListScroll = React.useCallback(() => {
    const element = cardListRef.current;
    if (!element) return;
    setCardListViewport((prev) => {
      if (prev.scrollTop === element.scrollTop && prev.height === element.clientHeight) return prev;
      return {
        height: element.clientHeight,
        scrollTop: element.scrollTop,
      };
    });
  }, []);

  return { cardListRef, cardListViewport, updateCardListScroll };
}
