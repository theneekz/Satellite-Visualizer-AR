import { useEffect, useState, type RefObject } from "react";
import type { PositionsSnapshot, SatelliteInfo } from "../api/satellites";
import type { LiveState } from "./liveState";
import {
  fmt,
  liveStateAt,
  satelliteDetails,
  type DetailMetric,
} from "./satelliteDetails";
import "./SatelliteCard.css";

const EARTH_RADIUS_KM = 6378.137;
const DAY_MS = 86400000;

function Metric({ label, value }: DetailMetric) {
  return (
    <div>
      <div className="satellite-card__key">{label}</div>
      <div className="satellite-card__value">{value}</div>
    </div>
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
      <ul className="satellite-card__legend">
        <li className="satellite-card__legend-item satellite-card__legend-item--perigee">
          Perigee {fmt(info.perigee_km)} km
        </li>
        <li className="satellite-card__legend-item satellite-card__legend-item--apogee">
          Apogee {fmt(info.apogee_km)} km
        </li>
      </ul>
    </>
  );
}

function SatelliteCard({
  satellite,
  positionsRef,
  onClose,
}: {
  satellite: SatelliteInfo;
  positionsRef: RefObject<PositionsSnapshot | null>;
  onClose: () => void;
}) {
  // Live values are recomputed once a second from the latest polled state.
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

  const details = satelliteDetails(satellite, live, nowMs);

  return (
    <aside className="satellite-card" aria-label={`${details.name} details`}>
      <div className="satellite-card__header">
        <div>
          <h2 className="satellite-card__name">{details.name}</h2>
          <p className="satellite-card__sub">{details.subtitle}</p>
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

      <div className="satellite-card__badges">
        {details.badges.map((badge) => (
          <span
            key={badge.text}
            className={`satellite-card__badge${badge.tone === "type" ? " satellite-card__badge--type" : ""}`}
          >
            {badge.text}
          </span>
        ))}
      </div>

      {details.sections.map((section) => (
        <section key={section.id} className="satellite-card__section">
          <h3 className="satellite-card__label">{section.label}</h3>
          {section.id === "orbit" && (
            <OrbitDiagram info={satellite} nowMs={nowMs} />
          )}
          {section.id === "data" && (
            <div className="satellite-card__epoch">
              <Metric {...details.epoch} />
              <span
                className={`satellite-card__badge satellite-card__badge--${details.age.level}`}
              >
                {details.age.text}
              </span>
            </div>
          )}
          <div className="satellite-card__grid">
            {section.metrics.map((metric) => (
              <Metric key={metric.label} {...metric} />
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
}

export default SatelliteCard;
