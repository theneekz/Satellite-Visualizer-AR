import { useEffect, useState, type RefObject } from "react";
import {
  positionAt,
  type PositionsSnapshot,
  type SatelliteInfo,
} from "../api/satellites";
import { sentenceCase } from "../format";
import { computeLiveState, type LiveState } from "./liveState";
import "./SatelliteCard.css";

const EARTH_RADIUS_KM = 6378.137;
const DAY_MS = 86400000;

function fmt(value: number, digits = 0) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// Older element sets mean less accurate positions.
function elementAge(epochMs: number, nowMs: number) {
  const days = (nowMs - epochMs) / DAY_MS;
  const text =
    days < 1
      ? `${fmt(Math.max(0, days * 24))} hours old`
      : `${fmt(days, 1)} days old`;
  const level = days < 3 ? "fresh" : days < 7 ? "aging" : "stale";
  return { text, level };
}

function Metric({ label, value }: { label: string; value: string }) {
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
      const snapshot = positionsRef.current;
      const index = snapshot?.indexById.get(satellite.id);
      setLive(
        snapshot && index !== undefined
          ? computeLiveState(positionAt(snapshot, index), snapshot.t, t)
          : null
      );
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

  const launchYear = /^(\d{4})-/.exec(satellite.designator)?.[1];
  const age = elementAge(satellite.epoch_ms, nowMs);

  return (
    <aside className="satellite-card" aria-label={`${satellite.name} details`}>
      <div className="satellite-card__header">
        <div>
          <h2 className="satellite-card__name">{satellite.name}</h2>
          <p className="satellite-card__sub">
            NORAD {satellite.id} · {satellite.designator}
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

      <div className="satellite-card__badges">
        {satellite.object_type && (
          <span className="satellite-card__badge satellite-card__badge--type">
            {sentenceCase(satellite.object_type)}
          </span>
        )}
        {satellite.rcs && (
          <span className="satellite-card__badge">
            {sentenceCase(satellite.rcs)}
          </span>
        )}
        {launchYear && (
          <span className="satellite-card__badge">Launched {launchYear}</span>
        )}
      </div>

      <section className="satellite-card__section">
        <h3 className="satellite-card__label">Live position</h3>
        <div className="satellite-card__grid">
          <Metric
            label="Altitude"
            value={live ? `${fmt(live.altitudeKm)} km` : "—"}
          />
          <Metric
            label="Speed"
            value={live ? `${fmt(live.speedKmS, 1)} km/s` : "—"}
          />
          <Metric
            label="Latitude"
            value={
              live
                ? `${fmt(Math.abs(live.latitudeDeg), 1)}° ${live.latitudeDeg >= 0 ? "N" : "S"}`
                : "—"
            }
          />
          <Metric
            label="Longitude"
            value={
              live
                ? `${fmt(Math.abs(live.longitudeDeg), 1)}° ${live.longitudeDeg >= 0 ? "E" : "W"}`
                : "—"
            }
          />
        </div>
      </section>

      <section className="satellite-card__section">
        <h3 className="satellite-card__label">Orbit</h3>
        <OrbitDiagram info={satellite} nowMs={nowMs} />
        <div className="satellite-card__grid">
          <Metric
            label="Period"
            value={`${fmt(satellite.period_min, 1)} min`}
          />
          <Metric
            label="Inclination"
            value={`${fmt(satellite.inclination_deg, 2)}°`}
          />
          <Metric label="Eccentricity" value={fmt(satellite.eccentricity, 3)} />
          <Metric
            label="Mean motion"
            value={`${fmt(satellite.mean_motion, 2)} rev/day`}
          />
        </div>
      </section>

      <section className="satellite-card__section">
        <h3 className="satellite-card__label">Data</h3>
        <div className="satellite-card__epoch">
          <Metric
            label="Epoch"
            value={`${new Date(satellite.epoch_ms).toISOString().slice(0, 16).replace("T", " ")} UTC`}
          />
          <span
            className={`satellite-card__badge satellite-card__badge--${age.level}`}
          >
            {age.text}
          </span>
        </div>
        <div className="satellite-card__grid">
          {satellite.originator && (
            <Metric label="Source" value={satellite.originator} />
          )}
          <Metric label="Revolutions" value={fmt(satellite.rev_at_epoch)} />
        </div>
      </section>

      <section className="satellite-card__section">
        <h3 className="satellite-card__label">Orbital elements</h3>
        <div className="satellite-card__grid">
          <Metric
            label="RA of asc. node"
            value={`${fmt(satellite.raan_deg, 2)}°`}
          />
          <Metric
            label="Arg. of perigee"
            value={`${fmt(satellite.arg_perigee_deg, 2)}°`}
          />
          <Metric
            label="Mean anomaly"
            value={`${fmt(satellite.mean_anomaly_deg, 2)}°`}
          />
          <Metric
            label="BSTAR (drag)"
            value={satellite.bstar.toExponential(2)}
          />
        </div>
      </section>
    </aside>
  );
}

export default SatelliteCard;
