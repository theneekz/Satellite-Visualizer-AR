import type { ReactNode } from "react";
import "./SidePanel.css";

const REPO_URL = "https://github.com/theneekz/Satellite-Visualizer-AR";
const AUTHOR_URL = "https://www.linkedin.com/in/nsward";
const DEMO_URL = "https://www.youtube.com/watch?v=2WOAVaL3KC0";

export type PanelSection = "objects" | "about" | "vr";

export interface XRControls {
  // The immersive modes this device supports, in the order to offer them.
  modes: XRSessionMode[];
  start: (mode: XRSessionMode) => void;
}

// Both buttons always show; the ones this browser can't run are disabled.
const XR_MODES: { mode: XRSessionMode; label: string }[] = [
  { mode: "immersive-vr", label: "Enter VR" },
  { mode: "immersive-ar", label: "Enter AR" },
];

const DESTINATIONS: { id: PanelSection; label: string; icon: ReactNode }[] = [
  { id: "about", label: "About", icon: <InfoIcon /> },
  { id: "vr", label: "VR / AR", icon: <HeadsetIcon /> },
  { id: "objects", label: "Objects", icon: <ObjectsIcon /> },
];

/**
 * The page's navigation: a rail of icons that opens one section at a time in a drawer. On phones
 * the rail becomes a bottom bar and the drawer a sheet above it. Selecting the open section
 * closes it, which leaves only the rail.
 */
function SidePanel({
  xr,
  active,
  onActiveChange,
  children,
}: {
  // Set when this device can enter an immersive session; otherwise the buttons are disabled.
  xr: XRControls | null;
  // The open section, or null when the drawer is closed.
  active: PanelSection | null;
  onActiveChange: (section: PanelSection | null) => void;
  // The satellite list, shown in the Objects section.
  children: ReactNode;
}) {
  return (
    <nav className="side-panel" aria-label="SatViz">
      <div className="side-panel__rail">
        <h1 className="side-panel__brand" title="SatViz">
          <OrbitIcon />
          <span className="side-panel__sr-only">SatViz</span>
        </h1>
        {DESTINATIONS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className={`side-panel__destination${active === id ? " is-active" : ""}`}
            aria-expanded={active === id}
            aria-controls={`side-panel-${id}`}
            onClick={() => onActiveChange(active === id ? null : id)}
          >
            <span className="side-panel__indicator">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      <div className="side-panel__drawer" hidden={active === null}>
        {/* Sections stay mounted while hidden so the filters keep any partly typed input. */}
        <div
          id="side-panel-objects"
          className="side-panel__section side-panel__section--objects"
          hidden={active !== "objects"}
        >
          {children}
        </div>

        <section
          id="side-panel-about"
          className="side-panel__section"
          aria-labelledby="side-panel-about-title"
          hidden={active !== "about"}
        >
          <h2 id="side-panel-about-title" className="side-panel__title">
            About
          </h2>
          <p className="side-panel__intro">
            Explore every artificial object orbiting Earth, live, on the web or
            in VR and AR. Filter the list, then select an object to learn more
            about it.
          </p>
          <p className="side-panel__note">
            Built by <ExternalLink href={AUTHOR_URL}>Niko Sward</ExternalLink>
            <span aria-hidden="true"> · </span>
            <ExternalLink href={REPO_URL}>Source</ExternalLink>
          </p>
        </section>

        <section
          id="side-panel-vr"
          className="side-panel__section"
          aria-labelledby="side-panel-vr-title"
          hidden={active !== "vr"}
        >
          <h2 id="side-panel-vr-title" className="side-panel__title">
            VR and AR
          </h2>
          <p className="side-panel__note">
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
        </section>
      </div>
    </nav>
  );
}

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
      width="26"
      height="26"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-25 12 12)" />
      <circle cx="20.3" cy="8.4" r="1.6" fill="#ffd34d" stroke="none" />
    </svg>
  );
}

function ObjectsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 6h16M4 12h7M4 18h7" />
      <circle cx="16.5" cy="15.5" r="3.5" />
      <path d="M19 18l2 2" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M3 9.5A2.5 2.5 0 0 1 5.5 7h13A2.5 2.5 0 0 1 21 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-3l-1.8-2.2a1.5 1.5 0 0 0-2.4 0L9.5 17h-3A2.5 2.5 0 0 1 3 14.5z" />
      <circle cx="8" cy="12" r="1.5" />
      <circle cx="16" cy="12" r="1.5" />
    </svg>
  );
}

export default SidePanel;
