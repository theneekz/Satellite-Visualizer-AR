from contextlib import asynccontextmanager
from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
import math
import os
from datetime import datetime, timezone
from typing import List, cast
import numpy as np
from sgp4.api import Satrec, SatrecArray
from sgp4 import omm
from skyfield.api import load
from skyfield.sgp4lib import TEME
from logger import time_function, log_error
from protos import omm_pb2
import json
import gzip


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build the v2 caches once before serving, so no request sees (or races to fill) an empty cache.
    load_v2_cache()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# CACHE_FILE_JSON = "dummy_data.json"
CACHE_FILE_JSON = "spacebook_omm_2026-09-21.json"
EARTH_RADIUS_KM = 6378.137
EARTH_MU = 398600.4418  # km^3/s^2

# Every satellite as one vectorized SGP4 array; sat_ids[i] is the NORAD id of satrecs[i].
sat_ids = np.array([], dtype=np.int64)
cached_records = []
satrecs: SatrecArray = SatrecArray([])
# Compressed once per cache load so requests don't pay for gzip.
cached_omms_gz = b""


@time_function
def build_omm_protos():
    global cached_omms_gz
    if not cached_records:
        return

    omm_list = omm_pb2.OMMList()
    for record in cached_records:
        meta = build_metadata(record)
        if not meta:
            continue
        # proto3 optional fields can't be set to None; leave them unset instead.
        omm_list.satellites.add(
            **{k: v for k, v in meta.items() if v is not None})

    cached_omms = omm_list.SerializeToString()
    cached_omms_gz = gzip.compress(cached_omms, 6)


def build_metadata(record: dict) -> dict:
    """Static display info for one OMM record. Only changes when the cache reloads."""
    mean_motion = float(record["MEAN_MOTION"])  # rev/day
    eccentricity = float(record["ECCENTRICITY"])
    n = mean_motion * 2 * math.pi / 86400  # rad/s
    semi_major_axis = (EARTH_MU / n**2) ** (1 / 3)
    # OMM EPOCH has no timezone; it is UTC.
    epoch = datetime.fromisoformat(record["EPOCH"]).replace(tzinfo=timezone.utc)
    try:
        return {
            "id": int(record["NORAD_CAT_ID"]),
            "name": record["OBJECT_NAME"],
            "designator": record["OBJECT_ID"],
            "epoch_ms": int(epoch.timestamp() * 1000),
            "period_min": 1440 / mean_motion,
            "inclination_deg": float(record["INCLINATION"]),
            "eccentricity": eccentricity,
            "perigee_km": semi_major_axis * (1 - eccentricity) - EARTH_RADIUS_KM,
            "apogee_km": semi_major_axis * (1 + eccentricity) - EARTH_RADIUS_KM,
            "mean_motion": mean_motion,
            "raan_deg": float(record["RA_OF_ASC_NODE"]),
            "arg_perigee_deg": float(record["ARG_OF_PERICENTER"]),
            "mean_anomaly_deg": float(record["MEAN_ANOMALY"]),
            "bstar": float(record["BSTAR"]),
            "rev_at_epoch": int(record["REV_AT_EPOCH"]),
            # Optional: not present in every OMM source.
            "object_type": record.get("OBJECT_TYPE"),
            "rcs": record.get("RCS"),
            "originator": record.get("ORIGINATOR"),
        }
    except Exception as e:
        log_error('error in build_metadata:', e)
        return {}


@time_function
def load_v2_cache():
    global cached_records
    cached_records = read_station_data()
    update_satrecs(load.timescale())
    build_omm_protos()


# Until API usage is secured, read stale file
@time_function
def read_station_data() -> List[dict]:
    if os.path.exists(CACHE_FILE_JSON):
        with open(CACHE_FILE_JSON) as f:
            return json.load(f)
    return []


@time_function
def update_satrecs(ts):
    global cached_records, satrecs, sat_ids

    temp_satrecs = []
    temp_sat_ids = []

    for record in cached_records:
        # Same Satrec Skyfield builds, without the EarthSatellite wrapper (~2x faster).
        satrec = Satrec()
        omm.initialize(satrec, record)
        temp_satrecs.append(satrec)
        temp_sat_ids.append(satrec.satnum)

    satrecs = SatrecArray(temp_satrecs)
    sat_ids = np.array(temp_sat_ids)


@time_function
def build_positions(t):
    # Skyfield's pre-split arrays gives 100% precision with zero math overhead
    julian_date_array = np.array([t.whole])
    offset_array = np.array([t.ut1_fraction])

    # One SGP4 call for every satellite at this instant.
    errors_2d, position, velocity = satrecs.sgp4(
        julian_date_array, offset_array)

    # Optimize filtering by dropping the time dimension immediately [:, 0]
    errors = errors_2d[:, 0]
    pos_2d = position[:, 0, :]
    vel_2d = velocity[:, 0, :]

    # Drop satellites SGP4 failed or that produced NaN.
    #     (errors == 0)
    #     If a satellite has an error code of 0 (Success), it becomes True. If it has a non-zero code (like 1 for a decayed orbit), it becomes False.
    #     [True, True, False, ...]

    #     np.isfinite(pos_2d)
    #     It scans the raw position numbers (X, Y, Z) for mathematical errors like NaN (Not a Number) or Inf (Infinity). SGP4 can spit out NaN if a satellite's orbit breaks or experiences a mathematical division-by-zero error.
    #     [
    #       [True, True, True],   # Sat 0: X, Y, Z are all normal numbers
    #       [True, False, True],  # Sat 1: Y is a NaN!
    #     ]

    #     .all(axis=1)
    #     Means look horizontally across the rows. If even a single coordinate in a row is False, the entire row becomes False.
    #     [True,  # Sat 0 is completely fine
    #      False] # Sat 1 failed because one of its coordinates was bad

    # Bitwise & here is AND for comparing two sets
    #       [ True,  True,  False,  True ]  (No SGP4 errors)
    #     & [ True,  False,  True,  True ]  (All coordinates valid)
    #       ---------------------------------
    #       [ True,  False,  False,  True ]  -> final 'ok' mask

    ok: List[bool] = (errors == 0) & np.isfinite(pos_2d).all(axis=1)

    # This converts TEME -> GCRS. Every satellite shares the same rotation at one instant, so a single matrix multiply converts them all.
    rotation = TEME.rotation_at(t)
    pos = pos_2d[ok] @ rotation
    vel = vel_2d[ok] @ rotation
    valid_ids = sat_ids[ok]

    return build_position_byte_list(valid_ids, pos, vel)


def build_position_byte_list(ids, pos, vel):
    # 28 bytes per satellite, so the client derives n = byteLength / 28.
    return (ids.astype("<u4").tobytes()
            + np.hstack([pos, vel]).astype("<f4").tobytes())


@app.get("/v2/satellites")
@time_function
def get_satellites_v2():
    if not cached_omms_gz:
        return Response(status_code=503, content="Satellite cache not loaded")
    return Response(
        content=cached_omms_gz,
        media_type="application/x-protobuf",
        headers={"Content-Encoding": "gzip"})


@app.get("/v2/positions")
@time_function
def get_positions_v2():
    if not len(satrecs):
        return Response(status_code=503, content="Satellite cache not loaded")

    ts = load.timescale()
    t = ts.now()
    time = cast(datetime, t.utc_datetime())
    millis = time.timestamp() * 1000
    positions = build_positions(t)

    return Response(
        content=bytes(positions),
        media_type="application/octet-stream",
        headers={
            "X-Timescale": str(millis),
            "Access-Control-Expose-Headers": "X-Timescale"
        }
    )


# try:
#     headers = {
#         'User-Agent': 'SatViz/1.0 (contact: nicholascsward@gmail.com)'}
#     response = requests.get(
#         STATIONS_URL,
#         headers=headers,
#         timeout=30
#     )

#     if response.status_code == 200:
#         with open(CACHE_FILE, "w") as f:
#             f.write(response.text)
#         return response.text
#     else:
#         raise Exception(f"HTTP Error {response.status_code}")
# except requests.RequestException as e:
#     logger.error(f"Error fetching TLE data from CelesTrak: {e}")
#     return None


@app.get("/test")
def test_api():
    if os.path.exists("spacebook_omm_2026-09-21.json"):
        with open("spacebook_omm_2026-09-21.json") as f:
            j = json.load(f)
            with_comments = [omm["COMMENT"]
                             for omm in list(j) if omm["COMMENT"] != ""]
            return len(with_comments)
    return
