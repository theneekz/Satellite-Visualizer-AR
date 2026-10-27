"""The /v2/satellites payload: every satellite's display info and mean elements as a gzipped
protobuf OMMList (shared/omm.proto).

The local API server (main.py) and the publish job (publish.py) both build it here, so identical
records produce identical bytes, and the same version, wherever they are built.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import hashlib
import math
from typing import List

from logger import time_function, log_error, log
from protos import omm_pb2

EARTH_RADIUS_KM = 6378.137
EARTH_MU = 398600.4418  # km^3/s^2


@dataclass(frozen=True)
class SatellitesPayload:
    """The /v2/satellites body for one set of OMM records.

    Immutable: a reload builds a new payload and replaces the old one in one assignment, so a
    request always sees one consistent version.
    """
    # Hash of the serialized protobuf: identical records give the same version on every machine.
    version: str
    # Satellites in the payload. Records that can't be parsed are left out.
    count: int
    # The gzipped protobuf OMMList, compressed once so requests don't pay.
    body_gz: bytes

    @property
    def etag(self) -> str:
        return f'"{self.version}"'


@time_function
def build_satellites_payload(records: List[dict]) -> SatellitesPayload:
    omm_list = build_omm_protos(records)
    serialized = omm_list.SerializeToString()
    return SatellitesPayload(
        version=hashlib.sha256(serialized).hexdigest()[:16],
        count=len(omm_list.satellites),
        # mtime=0 keeps the bytes deterministic; gzip otherwise embeds the current time.
        body_gz=gzip.compress(serialized, 6, mtime=0),
    )


@time_function
def build_omm_protos(records: List[dict]) -> omm_pb2.OMMList:
    """An OMMList holding every record that can be parsed."""
    omm_list = omm_pb2.OMMList()
    for record in records:
        # Filled in place: no intermediate dict or copy per satellite.
        if not build_omm_proto(omm_list.satellites.add(), record):
            # Drop the partly filled message for a record that couldn't be parsed.
            log("deleted a partly filled message")
            del omm_list.satellites[-1]

    return omm_list


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
