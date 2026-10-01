-- SatViz Seed Data
-- Realistic OMM data for active satellites

INSERT INTO satellites (
    norad_id, object_id, name, mean_motion, eccentricity, inclination,
    ra_of_asc_node, arg_of_pericenter, mean_anomaly,
    center_name, ref_frame, time_system, mean_element_theory,
    object_type, country_code, active, epoch
) VALUES

-- International Space Station (ISS)
(
    25544,
    '1998-067A',
    'ISS (ZARYA)',
    15.54184200,
    0.0006247,
    51.6440,
    130.8321,
    269.3841,
    90.7182,
    'EARTH',
    'TEME',
    'UTC',
    'SGP4',
    'ISS',
    'US/RU',
    true,
    '2024-09-14 12:41:38'
),

-- Starlink-1130
(
    57899,
    '2019-074A',
    'STARLINK-1130',
    14.87614920,
    0.0001298,
    53.0546,
    156.2847,
    89.8234,
    270.4156,
    'EARTH',
    'TEME',
    'UTC',
    'SGP4',
    'STARLINK',
    'US',
    true,
    '2024-09-15 10:52:00'
),

-- Starlink-1451
(
    60260,
    '2021-098A',
    'STARLINK-1451',
    14.89043280,
    0.0001156,
    53.0612,
    42.1563,
    85.7342,
    274.8923,
    'EARTH',
    'TEME',
    'UTC',
    'SGP4',
    'STARLINK',
    'US',
    true,
    '2024-09-15 09:18:00'
),

-- Starlink-4156
(
    62842,
    '2023-142A',
    'STARLINK-4156',
    14.88234560,
    0.0001347,
    53.0538,
    268.9234,
    92.1456,
    267.5432,
    'EARTH',
    'TEME',
    'UTC',
    'SGP4',
    'STARLINK',
    'US',
    true,
    '2024-09-15 10:03:00'
),

-- GPS BIIA-21 (Navstar GPS)
(
    20959,
    '1991-047A',
    'GPS BIIA-21 (PRN 07)',
    1.99103360,
    0.0204562,
    64.2156,
    212.5341,
    298.7234,
    61.8945,
    'EARTH',
    'TEME',
    'UTC',
    'SGP4',
    'GPS',
    'US',
    true,
    '2024-09-14 16:38:00'
),

-- NOAA-18 (Weather Satellite)
(
    28654,
    '2005-018A',
    'NOAA-18',
    14.12423680,
    0.0010456,
    99.0123,
    191.4562,
    123.5678,
    236.8934,
    'EARTH',
    'TEME',
    'UTC',
    'SGP4',
    'WEATHER',
    'US',
    true,
    '2024-09-14 20:01:00'
);
