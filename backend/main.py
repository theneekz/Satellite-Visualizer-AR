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
from logger import time_function, log_error, log
from protos import omm_pb2
from db.database import read_omm_records
import json
import gzip


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build the caches once before serving, so no request sees (or races to fill) an empty cache.
    load_v2_cache()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

EARTH_RADIUS_KM = 6378.137
EARTH_MU = 398600.4418  # km^3/s^2

# Every satellite as one vectorized SGP4 array; sat_ids[i] is the NORAD id of satrecs[i].
satrecs: SatrecArray = SatrecArray([])
sat_ids = np.array([], dtype=np.int64)
cached_records = []
# Compressed once per cache load so requests don't pay for gzip.
cached_omms_gz = b""


@time_function
def build_omm_protos():
    global cached_omms_gz
    if not cached_records:
        return

    omm_list = omm_pb2.OMMList()
    for record in cached_records:
        # Filled in place: no intermediate dict or copy per satellite.
        if not build_omm_proto(omm_list.satellites.add(), record):
            # Drop the partly filled message for a record that couldn't be parsed.
            log("deleted a partly filled message")
            del omm_list.satellites[-1]

    cached_omms = omm_list.SerializeToString()
    cached_omms_gz = gzip.compress(cached_omms, 6)


def build_omm_proto(omm: omm_pb2.OMM, record: dict) -> bool:
    """Fills `omm` with the static display info for one OMM record. Returns False if the record
    can't be parsed. Only changes when the cache reloads."""
    try:
        mean_motion = record["MEAN_MOTION"]  # rev/day
        eccentricity = record["ECCENTRICITY"]
        n = mean_motion * 2 * math.pi / 86400  # rad/s
        semi_major_axis = (EARTH_MU / n**2) ** (1 / 3)
        # OMM EPOCH has no timezone; it is UTC.
        epoch = datetime.fromisoformat(
            record["EPOCH"]).replace(tzinfo=timezone.utc)

        omm.id = record["NORAD_CAT_ID"]
        omm.name = record["OBJECT_NAME"]
        omm.designator = record["OBJECT_ID"]
        omm.epoch_ms = int(epoch.timestamp() * 1000)
        omm.period_min = 1440 / mean_motion
        omm.inclination_deg = record["INCLINATION"]
        omm.eccentricity = eccentricity
        omm.perigee_km = semi_major_axis * (1 - eccentricity) - EARTH_RADIUS_KM
        omm.apogee_km = semi_major_axis * (1 + eccentricity) - EARTH_RADIUS_KM
        omm.mean_motion = mean_motion
        omm.raan_deg = record["RA_OF_ASC_NODE"]
        omm.arg_perigee_deg = record["ARG_OF_PERICENTER"]
        omm.mean_anomaly_deg = record["MEAN_ANOMALY"]
        omm.bstar = record["BSTAR"]
        omm.rev_at_epoch = record["REV_AT_EPOCH"]
        # Optional: not present in every OMM source. proto3 optional fields are left unset
        # rather than assigned None.
        if record.get("OBJECT_TYPE") is not None:
            omm.object_type = record["OBJECT_TYPE"]
        if record.get("RCS") is not None:
            omm.rcs = record["RCS"]
        if record.get("ORIGINATOR") is not None:
            omm.originator = record["ORIGINATOR"]
        return True
    except Exception as e:
        log_error('error in build_omm_proto:', e)
        return False


@time_function
def load_v2_cache():
    global cached_records
    try:
        cached_records = read_omm_records()
    except Exception as e:
        # Leave the caches empty.
        log_error('error reading OMM records from the database:', e)
        return
    update_satrecs(load.timescale())
    build_omm_protos()


@time_function
def update_satrecs(ts):
    global cached_records, satrecs, sat_ids

    temp_satrecs = []
    temp_sat_ids = []

    for record in cached_records:
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
