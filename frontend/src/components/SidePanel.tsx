import { useState, type ReactNode } from "react";
import "./SidePanel.css";

// Phones have too little room for the panel beside the globe, so it starts collapsed there.
const NARROW_QUERY = "(max-width: 600px)";

const REPO_URL = "https://github.com/theneekz/Satellite-Visualizer-AR";
const AUTHOR_URL = "https://www.linkedin.com/in/nsward";
const DEMO_URL = "https://www.youtube.com/watch?v=2WOAVaL3KC0";

export interface XRControls {
  // The immersive modes this device supports, in the order to offer them.
  modes: XRSessionMode[];
  start: (mode: XRSessionMode) => void;
}

/**
 * The page's navigation panel: a short introduction, a way into VR, and the satellite list
 * (passed as children). On phones it spans the top of the screen and starts collapsed.
 */
function SidePanel({
  xr,
  children,
}: {
  // Set when this device can enter an immersive session; otherwise the buttons are disabled.
  xr: XRControls | null;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(
    () => window.matchMedia(NARROW_QUERY).matches
  );

  return (
    <nav
      className={`side-panel${collapsed ? " is-collapsed" : ""}`}
      aria-label="SatViz"
    >
      <header className="side-panel__header">
        <h1 className="side-panel__brand">
          <OrbitIcon />
          SatViz
        </h1>
        <button
          type="button"
          className="side-panel__toggle"
          aria-expanded={!collapsed}
          aria-controls="side-panel-body"
          aria-label={collapsed ? "Open menu" : "Close menu"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            {collapsed ? (
              <path d="M4 7h16M4 12h16M4 17h16" />
            ) : (
              <path d="M6 6l12 12M18 6L6 18" />
            )}
          </svg>
        </button>
      </header>

      <div id="side-panel-body" className="side-panel__body" hidden={collapsed}>
        <details className="side-panel__section" open>
          <summary>About</summary>
          <div className="side-panel__intro">
            <p>
              Explore every artificial object orbiting Earth, live, on the web
              or in VR and AR. Filter the list, then select an object to learn
              more about it.
            </p>
            <p className="side-panel__byline">
              Built by <ExternalLink href={AUTHOR_URL}>Niko Sward</ExternalLink>
              <span aria-hidden="true"> · </span>
              <ExternalLink href={REPO_URL}>Source</ExternalLink>
            </p>
          </div>
        </details>

        <details className="side-panel__section" open>
          <summary>VR &amp; AR</summary>
          <div className="side-panel__vr">
            <HeadsetIcon />
            <div className="side-panel__vr-text">
              <p>
                Best on Meta Quest.{" "}
                <ExternalLink href={DEMO_URL}>Watch the demo</ExternalLink>
              </p>
              <div className="side-panel__vr-actions">
                {XR_MODES.map(({ mode, label }) => {
                  const supported = xr?.modes.includes(mode) ?? false;
                  return (
                    <button
                      key={mode}
                      type="button"
                      disabled={!supported}
                      title={
                        supported ? undefined : "Not supported in this browser"
                      }
                      onClick={() => xr?.start(mode)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </details>

        {children}
      </div>
    </nav>
  );
}

// Both buttons always show; the ones this browser can't run are disabled.
const XR_MODES: { mode: XRSessionMode; label: string }[] = [
  { mode: "immersive-vr", label: "Enter VR" },
  { mode: "immersive-ar", label: "Enter AR" },
];

// Opens in a new tab so the globe keeps running in this one.
function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function OrbitIcon() {
  return (
    <svg
      className="side-panel__logo"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)" />
      <circle cx="20.3" cy="8.4" r="1.6" fill="#ffd34d" stroke="none" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg
      className="side-panel__vr-icon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden="true"
    >
      <path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3l-1.8-2.2a1.5 1.5 0 0 0-2.4 0L9.5 17h-3A2.5 2.5 0 0 1 3 14.5z" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
    </svg>
  );
}

export default SidePanel;
