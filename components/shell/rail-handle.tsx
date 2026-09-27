"use client"

import styles from "./rail-handle.module.css"

// The grab handle on the inside edge of a side rail. Both rails use this, so
// they behave identically — the left one had a hover and a grip pill, the right
// was a bare strip of dots, and neither said anything about being minimised.
export function RailHandle({
  side,
  snapped,
  onToggle,
  label,
}: {
  side: "left" | "right"
  snapped: boolean
  onToggle: () => void
  /** What the panel is, e.g. "alerts panel". The title becomes Expand/Collapse it. */
  label: string
}) {
  const action = snapped ? "Expand" : "Collapse"
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!snapped}
      title={`${action} ${label}`}
      aria-label={`${action} ${label}`}
      className={[
        styles.handle,
        side === "left" ? styles.left : styles.right,
        snapped ? styles.snapped : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span aria-hidden="true" className={styles.grip}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={styles.dot} />
        ))}
      </span>
    </button>
  )
}
