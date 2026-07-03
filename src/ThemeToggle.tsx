import { ThemePreference, useThemePreference } from "./theme";

// A single compact control that cycles through the three modes, so the feature
// stays lightweight (no settings panel) while still exposing all of them.
const CYCLE: ThemePreference[] = ["system", "light", "dark"];
const LABEL: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const [preference, setPreference] = useThemePreference();
  const next = CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setPreference(next)}
      title={`Theme: ${LABEL[preference]} — click for ${LABEL[next]}`}
      aria-label={`Theme: ${LABEL[preference]}. Click to switch to ${LABEL[next]}.`}
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (preference === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }

  if (preference === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }

  // system: a monitor, signalling "follow the device".
  return (
    <svg {...common}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
