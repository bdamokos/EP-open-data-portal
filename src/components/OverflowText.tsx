import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

interface OverflowTextProps {
  text: string;
  className?: string;
}

interface TextMetrics {
  contentWidth: number;
  viewportWidth: number;
  running: boolean;
}

const TEXT_GAP = 40;
const SCROLL_PIXELS_PER_SECOND = 60;

/** Scroll labels only when their text exceeds the available width. */
export function OverflowText({ text, className = "" }: OverflowTextProps) {
  const viewport = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState<TextMetrics>({
    contentWidth: 0,
    viewportWidth: 0,
    running: false,
  });

  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      const outer = viewport.current;
      const inner = content.current;
      if (!active || !outer || !inner) return;
      const contentWidth = inner.scrollWidth;
      const viewportWidth = outer.clientWidth;
      const next = {
        contentWidth,
        viewportWidth,
        running: contentWidth > viewportWidth,
      };
      setMetrics((current) => (
        current.contentWidth === next.contentWidth
        && current.viewportWidth === next.viewportWidth
        && current.running === next.running
          ? current
          : next
      ));
    };

    measure();
    void document.fonts?.ready.then(measure);
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [text]);

  const style = metrics.running
    ? ({
        "--running-text-distance": `${-(metrics.contentWidth + TEXT_GAP)}px`,
        "--running-text-duration": `${(metrics.contentWidth + TEXT_GAP) / SCROLL_PIXELS_PER_SECOND}s`,
      } as CSSProperties)
    : undefined;
  const animationKey = `${text}:${metrics.contentWidth}:${metrics.viewportWidth}`;

  return (
    <span className={`${className} running-text${metrics.running ? " is-running" : ""}`.trim()} ref={viewport}>
      <span className="running-text__track" key={animationKey} style={style}>
        <span ref={content}>{text}</span>
        {metrics.running ? <span aria-hidden="true">{text}</span> : null}
      </span>
    </span>
  );
}
