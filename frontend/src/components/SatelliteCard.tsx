import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import type { PositionsSnapshot, SatelliteInfo } from "../api/satellites";
import type { LiveState } from "./liveState";
import { useContainTouches } from "../hooks/useContainTouches";
import { useSheetDrag } from "../hooks/useSheetDrag";
import SheetHandle from "./SheetHandle";
import Tooltip from "./Tooltip";
import {
  CARD_HELP,
  fmt,
  liveStateAt,
  satelliteDetails,
  type DetailMetric,
} from "./satelliteDetails";
import "./SatelliteCard.css";
import { DAY_MS, EARTH_RADIUS_KM } from "../constants";

function Metric({ label, value, help }: DetailMetric) {
  return (
    <Tooltip as="div" text={help}>
      <div className="satellite-card__key">{label}</div>
      <div className="satellite-card__value">{value}</div>
    </Tooltip>
  );
}

// The diagram is drawn in this fixed coordinate space and the viewBox scales it to whatever width
// the card gives it, so it can't overflow. The orbit's own scale is derived from the frame.
const VIEW_WIDTH = 260;
const VIEW_HEIGHT = 150;
// Room around the orbit for the markers and the satellite's highlight ring (radius 9).
const PADDING = 14;

/** The orbit ellipse to scale, with Earth at its focus and the satellite's estimated position. */
function OrbitDiagram({ info, nowMs }: { info: SatelliteInfo; nowMs: number }) {
  const perigeeRadius = info.perigee_km + EARTH_RADIUS_KM;
  const apogeeRadius = info.apogee_km + EARTH_RADIUS_KM;
  const semiMajor = (perigeeRadius + apogeeRadius) / 2;
  const ecc = info.eccentricity;
  const semiMinor = semiMajor * Math.sqrt(1 - ecc * ecc);
  const centerX = VIEW_WIDTH / 2;
  const centerY = VIEW_HEIGHT / 2;

  // The largest scale (px per km) at which the whole ellipse fits inside the padded frame.
  const scale = Math.min(
    (VIEW_WIDTH / 2 - PADDING) / semiMajor,
    (VIEW_HEIGHT / 2 - PADDING) / semiMinor
  );
  const rx = semiMajor * scale;
  const ry = semiMinor * scale;
  // Earth sits at the focus, with perigee drawn on the left. For any orbit above the surface
  // its radius is within the perigee distance, so it always stays inside the ellipse.
  const earthX = centerX - semiMajor * ecc * scale;
  const earthR = Math.max(2, EARTH_RADIUS_KM * scale);

  // Advance the mean anomaly from the epoch, then solve Kepler's equation for the position.
  const elapsedDays = (nowMs - info.epoch_ms) / DAY_MS;
  const meanAnomaly =
    ((((info.mean_anomaly_deg + 360 * info.mean_motion * elapsedDays) % 360) +
      360) %
      360) *
    (Math.PI / 180);
  let anomaly = meanAnomaly;
  for (let i = 0; i < 6; i++) {
    anomaly -=
      (anomaly - ecc * Math.sin(anomaly) - meanAnomaly) /
      (1 - ecc * Math.cos(anomaly));
  }
  const satX = earthX - semiMajor * (Math.cos(anomaly) - ecc) * scale;
  const satY = centerY - semiMinor * Math.sin(anomaly) * scale;

  return (
    <>
      <Tooltip as="div" text={CARD_HELP.orbitDiagram}>
        <svg
          className="satellite-card__diagram"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`Orbit shape: perigee ${fmt(info.perigee_km)} km, apogee ${fmt(info.apogee_km)} km`}
        >
          <ellipse
            cx={centerX}
            cy={centerY}
            rx={rx}
            ry={ry}
            fill="none"
            stroke="rgba(255,255,255,.35)"
            strokeDasharray="3 3"
          />
          <circle
            cx={earthX}
            cy={centerY}
            r={earthR}
            fill="#0f2a4a"
            stroke="#1d4f86"
            strokeWidth={0.5}
          />
          <circle cx={centerX - rx} cy={centerY} r={3} fill="#5dcaa5" />
          <circle cx={centerX + rx} cy={centerY} r={3} fill="#ef9f27" />
          <rect x={satX - 3} y={satY - 3} width={6} height={6} fill="#fac775" />
          <circle
            cx={satX}
            cy={satY}
            r={9}
            fill="none"
            stroke="#85b7eb"
            strokeWidth={1.5}
          />
        </svg>
      </Tooltip>
      <ul className="satellite-card__legend">
        <li>
          <Tooltip
            text={CARD_HELP.perigee}
            className="satellite-card__legend-item satellite-card__legend-item--perigee"
          >
            Perigee {fmt(info.perigee_km)} km
          </Tooltip>
        </li>
        <li>
          <Tooltip
            text={CARD_HELP.apogee}
            className="satellite-card__legend-item satellite-card__legend-item--apogee"
          >
            Apogee {fmt(info.apogee_km)} km
          </Tooltip>
        </li>
      </ul>
    </>
  );
}

// How far, in pixels, a drag on the handle must go to change the sheet's state.
const DRAG_THRESHOLD = 40;

function SatelliteCard({
  satellite,
  positionsRef,
  onClose,
}: {
  satellite: SatelliteInfo;
  positionsRef: RefObject<PositionsSnapshot | null>;
  onClose: () => void;
}) {
  // Live values are recomputed once a second from the latest snapshot.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [live, setLive] = useState<LiveState | null>(null);

  useEffect(() => {
    function tick() {
      const t = Date.now();
      setNowMs(t);
      setLive(liveStateAt(positionsRef.current, satellite.id, t));
    }
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [satellite.id, positionsRef]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // On phones the card is a bottom sheet. It opens as a short peek with the title and badges,
  // and the handle expands it to the full details. Wider screens always show everything.
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  useContainTouches(sheetRef, ".satellite-card__body");

  function handleDragEnd(deltaY: number) {
    if (deltaY < -DRAG_THRESHOLD) setExpanded(true);
    else if (deltaY > DRAG_THRESHOLD) {
      // Dragging down from the peek dismisses the card, as in map apps.
      if (expanded) setExpanded(false);
      else onClose();
    }
  }

  // The whole title area drags the sheet, not only the handle, so it's easy to grab.
  const dragHandlers = useSheetDrag({
    sheetRef,
    canGrow: !expanded,
    onDragEnd: handleDragEnd,
  });

  const details = satelliteDetails(satellite, live, nowMs);

  return (
    <aside
      ref={sheetRef}
      className={`satellite-card${expanded ? "" : " satellite-card--peek"}`}
      aria-label={`${details.name} details`}
    >
      <div className="satellite-card__top" {...dragHandlers}>
        <SheetHandle
          label={expanded ? "Show less" : "Show all details"}
          expanded={expanded}
          onTap={() => setExpanded(!expanded)}
        />
        <div className="satellite-card__header">
          <div>
            <h2 className="satellite-card__name">
              <Tooltip text={CARD_HELP.name}>{details.name}</Tooltip>
            </h2>
            <p className="satellite-card__sub">
              {details.identifiers.map((identifier, i) => (
                <Fragment key={identifier.help}>
                  {i > 0 && " · "}
                  <Tooltip text={identifier.help}>{identifier.text}</Tooltip>
                </Fragment>
              ))}
            </p>
          </div>
          <button
            type="button"
            className="satellite-card__close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      {/* Only the body scrolls, so the name and close button stay in view. */}
      <div className="satellite-card__body">
        <div className="satellite-card__badges">
          {details.badges.map((badge) => (
            <Tooltip
              key={badge.text}
              text={badge.help}
              className={`satellite-card__badge${badge.tone === "type" ? " satellite-card__badge--type" : ""}`}
            >
              {badge.text}
            </Tooltip>
          ))}
        </div>

        {details.sections.map((section) => (
          <section key={section.id} className="satellite-card__section">
            <h3 className="satellite-card__label">
              <Tooltip text={section.help}>{section.label}</Tooltip>
            </h3>
            {section.id === "orbit" && (
              <OrbitDiagram info={satellite} nowMs={nowMs} />
            )}
            {section.id === "data" && (
              <div className="satellite-card__epoch">
                <Metric {...details.epoch} />
                <Tooltip
                  text={CARD_HELP.age}
                  className={`satellite-card__badge satellite-card__badge--${details.age.level}`}
                >
                  {details.age.text}
                </Tooltip>
              </div>
            )}
            <div className="satellite-card__grid">
              {section.metrics.map((metric) => (
                <Metric key={metric.label} {...metric} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}

export default SatelliteCard;
