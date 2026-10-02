-- SatViz database schema (PostgreSQL).
-- One row per tracked object holding its latest OMM (Orbit Mean-Elements Message) element set.
-- Apply with: python -m db.import_omm (runs this file first).

CREATE TABLE IF NOT EXISTS satellites (
    norad_cat_id        INTEGER PRIMARY KEY,
    object_name         TEXT NOT NULL,
    object_id           TEXT NOT NULL,              -- international designator, e.g. 1998-067A

    -- Mean elements, as SGP4 consumes them. DOUBLE PRECISION keeps the source values exactly.
    epoch               TIMESTAMP NOT NULL,         -- UTC; OMM EPOCH carries no timezone
    mean_motion         DOUBLE PRECISION NOT NULL,  -- rev/day
    eccentricity        DOUBLE PRECISION NOT NULL,
    inclination         DOUBLE PRECISION NOT NULL,  -- degrees
    ra_of_asc_node      DOUBLE PRECISION NOT NULL,  -- degrees
    arg_of_pericenter   DOUBLE PRECISION NOT NULL,  -- degrees
    mean_anomaly        DOUBLE PRECISION NOT NULL,  -- degrees
    bstar               DOUBLE PRECISION NOT NULL,
    mean_motion_dot     DOUBLE PRECISION NOT NULL,
    mean_motion_ddot    DOUBLE PRECISION NOT NULL,
    rev_at_epoch        INTEGER NOT NULL,
    element_set_no      INTEGER NOT NULL,
    ephemeris_type      SMALLINT NOT NULL DEFAULT 0,
    classification_type CHAR(1) NOT NULL DEFAULT 'U',

    -- OMM header and reference information.
    ccsds_omm_vers      TEXT,
    creation_date       TIMESTAMP,
    originator          TEXT,
    comment             TEXT NOT NULL DEFAULT '',
    center_name         TEXT NOT NULL DEFAULT 'EARTH',
    ref_frame           TEXT NOT NULL DEFAULT 'TEME',
    time_system         TEXT NOT NULL DEFAULT 'UTC',
    mean_element_theory TEXT NOT NULL DEFAULT 'SGP4',

    -- Extras some sources include. Nullable because not every source has them.
    period              DOUBLE PRECISION,           -- minutes
    apoapsis            DOUBLE PRECISION,           -- km above the surface
    periapsis           DOUBLE PRECISION,           -- km above the surface
    object_type         TEXT,                       -- PAYLOAD, ROCKET BODY, DEBRIS, UNKNOWN
    rcs                 TEXT,                       -- radar cross-section bucket
    tle_line0           TEXT,
    tle_line1           TEXT,
    tle_line2           TEXT,

    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
