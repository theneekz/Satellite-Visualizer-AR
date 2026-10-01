from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Iterable as _Iterable, Mapping as _Mapping, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OMM(_message.Message):
    __slots__ = ("id", "name", "designator", "epoch_ms", "period_min", "inclination_deg", "eccentricity", "perigee_km", "apogee_km", "mean_motion", "raan_deg", "arg_perigee_deg", "mean_anomaly_deg", "bstar", "rev_at_epoch", "object_type", "rcs", "originator")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESIGNATOR_FIELD_NUMBER: _ClassVar[int]
    EPOCH_MS_FIELD_NUMBER: _ClassVar[int]
    PERIOD_MIN_FIELD_NUMBER: _ClassVar[int]
    INCLINATION_DEG_FIELD_NUMBER: _ClassVar[int]
    ECCENTRICITY_FIELD_NUMBER: _ClassVar[int]
    PERIGEE_KM_FIELD_NUMBER: _ClassVar[int]
    APOGEE_KM_FIELD_NUMBER: _ClassVar[int]
    MEAN_MOTION_FIELD_NUMBER: _ClassVar[int]
    RAAN_DEG_FIELD_NUMBER: _ClassVar[int]
    ARG_PERIGEE_DEG_FIELD_NUMBER: _ClassVar[int]
    MEAN_ANOMALY_DEG_FIELD_NUMBER: _ClassVar[int]
    BSTAR_FIELD_NUMBER: _ClassVar[int]
    REV_AT_EPOCH_FIELD_NUMBER: _ClassVar[int]
    OBJECT_TYPE_FIELD_NUMBER: _ClassVar[int]
    RCS_FIELD_NUMBER: _ClassVar[int]
    ORIGINATOR_FIELD_NUMBER: _ClassVar[int]
    id: int
    name: str
    designator: str
    epoch_ms: int
    period_min: float
    inclination_deg: float
    eccentricity: float
    perigee_km: float
    apogee_km: float
    mean_motion: float
    raan_deg: float
    arg_perigee_deg: float
    mean_anomaly_deg: float
    bstar: float
    rev_at_epoch: int
    object_type: str
    rcs: str
    originator: str
    def __init__(self, id: _Optional[int] = ..., name: _Optional[str] = ..., designator: _Optional[str] = ..., epoch_ms: _Optional[int] = ..., period_min: _Optional[float] = ..., inclination_deg: _Optional[float] = ..., eccentricity: _Optional[float] = ..., perigee_km: _Optional[float] = ..., apogee_km: _Optional[float] = ..., mean_motion: _Optional[float] = ..., raan_deg: _Optional[float] = ..., arg_perigee_deg: _Optional[float] = ..., mean_anomaly_deg: _Optional[float] = ..., bstar: _Optional[float] = ..., rev_at_epoch: _Optional[int] = ..., object_type: _Optional[str] = ..., rcs: _Optional[str] = ..., originator: _Optional[str] = ...) -> None: ...

class OMMList(_message.Message):
    __slots__ = ("satellites",)
    SATELLITES_FIELD_NUMBER: _ClassVar[int]
    satellites: _containers.RepeatedCompositeFieldContainer[OMM]
    def __init__(self, satellites: _Optional[_Iterable[_Union[OMM, _Mapping]]] = ...) -> None: ...
