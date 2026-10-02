"""Loads an OMM JSON file into the satellites table, creating the table first if needed.

Run from backend/:  python -m db.import_omm [path/to/omm.json]
Re-running is safe: rows are upserted by NORAD id. A stored element set is only replaced by one
with the same or a newer epoch, so importing an older file can't roll data back.
"""
import json
import sys
from pathlib import Path

from db.database import OMM_COLUMNS, connect
from logger import log, time_function

DEFAULT_FILE = "spacebook_omm_2026-09-21.json"
SCHEMA_FILE = Path(__file__).with_name("schema.sql")

# Properties of the object that some sources (e.g. CelesTrak)
# omit. Element-set fields (TLE lines, period, apoapsis, ...) are always replaced.
KEEP_IF_MISSING = {"object_type", "rcs"}


def _update_expression(column: str) -> str:
    if column in KEEP_IF_MISSING:
        return f"{column} = COALESCE(EXCLUDED.{column}, satellites.{column})"
    return f"{column} = EXCLUDED.{column}"


# EXCLUDED is the incoming row; satellites.<column> is the stored one. RETURNING reports whether
# each row was inserted (xmax = 0) or updated; rows skipped by the WHERE return nothing.
UPSERT_SQL = f"""
    INSERT INTO satellites ({", ".join(OMM_COLUMNS)}, fetched_at)
    VALUES ({", ".join(f"%({c})s" for c in OMM_COLUMNS)}, now())
    ON CONFLICT (norad_cat_id) DO UPDATE SET
        {", ".join(_update_expression(c) for c in OMM_COLUMNS if c != "norad_cat_id")},
        fetched_at = now()
    WHERE EXCLUDED.epoch >= satellites.epoch
    RETURNING (xmax = 0) AS inserted
"""


def to_row(record: dict) -> dict:
    """An OMM JSON record as column values. Missing optional keys become NULL."""
    row = {column: record.get(column.upper()) for column in OMM_COLUMNS}
    # Required numeric fields some sources send as strings. Read directly so a missing one fails
    # with a KeyError naming it, rather than int(None).
    row["element_set_no"] = int(record["ELEMENT_SET_NO"])
    row["ephemeris_type"] = int(record["EPHEMERIS_TYPE"])
    row["comment"] = row["comment"] or ""
    return row


@time_function
def main(path: str) -> None:
    with open(path) as f:
        records = json.load(f)

    with connect() as conn:
        conn.execute(SCHEMA_FILE.read_text())
        with conn.cursor() as cur:
            cur.executemany(UPSERT_SQL, [to_row(r)
                            for r in records], returning=True)
            results = []
            while True:
                results.extend(row[0] for row in cur.fetchall())
                if not cur.nextset():
                    break
        count = conn.execute("SELECT count(*) FROM satellites").fetchone()[0]

    inserted = sum(results)
    updated = len(results) - inserted
    skipped = len(records) - len(results)
    log(f"{path}: {inserted} inserted, {updated} updated, "
        f"{skipped} skipped (stored epoch is newer); satellites table has {count} rows.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_FILE)
