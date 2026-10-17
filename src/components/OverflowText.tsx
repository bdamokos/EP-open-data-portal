interface OverflowTextProps {
  text: string;
  className?: string;
}

/** Keep the complete label visible as its text size or available width changes. */
export function OverflowText({ text, className = "" }: OverflowTextProps) {
  return <span className={`${className} overflow-text`.trim()}>{text}</span>;
}
