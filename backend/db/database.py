"""PostgreSQL access for OMM records. Connection string comes from DATABASE_URL."""
import os
from typing import List

import psycopg  # type: ignore

# Defaults to the local `satviz` database over the Unix socket as the current user.
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///satviz")

# The satellites table's OMM columns (see db/schema.sql): each is the OMM keyword in lowercase.
OMM_COLUMNS = [
    "norad_cat_id", "object_name", "object_id",
    "epoch", "mean_motion", "eccentricity", "inclination", "ra_of_asc_node",
    "arg_of_pericenter", "mean_anomaly", "bstar", "mean_motion_dot", "mean_motion_ddot",
    "rev_at_epoch", "element_set_no", "ephemeris_type", "classification_type",
    "ccsds_omm_vers", "creation_date", "originator", "comment", "center_name", "ref_frame",
    "time_system", "mean_element_theory",
    "period", "apoapsis", "periapsis", "object_type", "rcs", "tle_line0", "tle_line1", "tle_line2",
]

# Timestamps are formatted by Postgres back into OMM's string form (EPOCH must match the
# '%Y-%m-%dT%H:%M:%S.%f' pattern sgp4.omm.initialize parses), which is faster than in Python.
_SELECT_EXPRESSIONS = {
    "epoch": """to_char(epoch, 'YYYY-MM-DD"T"HH24:MI:SS.US')""",
    "creation_date": """to_char(creation_date, 'YYYY-MM-DD"T"HH24:MI:SS')""",
}
_SELECT_SQL = "SELECT {} FROM satellites ORDER BY norad_cat_id".format(
    ", ".join(_SELECT_EXPRESSIONS.get(c, c) for c in OMM_COLUMNS))
_RECORD_KEYS = [c.upper() for c in OMM_COLUMNS]


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def read_omm_records() -> List[dict]:
    """Every stored element set as an OMM-style dict (uppercase keys), as read from OMM JSON."""
    with connect() as conn:
        rows = conn.execute(_SELECT_SQL).fetchall()
    return [dict(zip(_RECORD_KEYS, row)) for row in rows]
