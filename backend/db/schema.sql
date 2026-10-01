-- SatViz Satellites Database Schema
-- Stores OMM (Orbit Mean Elements) data for tracked satellites

CREATE TABLE IF NOT EXISTS satellites (
    id SERIAL PRIMARY KEY,
    norad_id INTEGER UNIQUE NOT NULL,
    object_id VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,

    -- OMM Orbital Elements (raw mean elements)
    mean_motion DECIMAL(10, 8) NOT NULL,
    eccentricity DECIMAL(10, 8) NOT NULL,
    inclination DECIMAL(10, 8) NOT NULL,
    ra_of_asc_node DECIMAL(10, 8) NOT NULL,
    arg_of_pericenter DECIMAL(10, 8) NOT NULL,
    mean_anomaly DECIMAL(10, 8) NOT NULL,

    -- OMM Reference Information
    center_name VARCHAR(50) NOT NULL DEFAULT 'EARTH',
    ref_frame VARCHAR(20) NOT NULL DEFAULT 'TEME',
    time_system VARCHAR(10) NOT NULL DEFAULT 'UTC',
    mean_element_theory VARCHAR(50) NOT NULL DEFAULT 'SGP4',

    -- Satellite Classification
    object_type VARCHAR(50),
    country_code VARCHAR(5),
    active BOOLEAN DEFAULT true,

    -- Timestamps
    epoch TIMESTAMP NOT NULL,
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_norad_id (norad_id),
    INDEX idx_fetched_at (fetched_at),
    INDEX idx_active (active)
);
