"""Local development API. Serves /v2/satellites from the PostgreSQL database; Vite proxies /v2 here
(see frontend/vite.config.ts).

In production, publish.py uploads the same payload to Cloudflare R2, and a Pages Function
(frontend/functions/v2/satellites.ts) serves it. The browser propagates positions itself.
"""
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from db.database import read_omm_records
from logger import time_function, log_error
from satellites_payload import SatellitesPayload, build_satellites_payload


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Build the payload once before serving, so no request sees (or races to fill) an empty cache.
    app.state.payload = load_payload()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@time_function
def load_payload() -> Optional[SatellitesPayload]:
    """Reads the OMM records and builds the payload, or None if the database can't be read."""
    try:
        records = read_omm_records()
    except Exception as e:
        log_error('error reading OMM records from the database:', e)
        return None
    return build_satellites_payload(records)


def etag_matches(request: Request, etag: str) -> bool:
    """Whether the client already names this ETag so it can reuse it."""
    header = request.headers.get("if-none-match")
    if not header:
        return False
    # A comma-separated list; weak validators (W/"...") still count for a GET.
    candidates = {tag.strip().removeprefix("W/") for tag in header.split(",")}
    return "*" in candidates or etag in candidates


@app.get("/v2/satellites")
@time_function
def get_satellites_v2(request: Request):
    payload: Optional[SatellitesPayload] = request.app.state.payload
    if payload is None:
        return Response(status_code=503, content="Satellite cache not loaded")

    # no-cache: browsers and CDNs may store the payload but must revalidate each time. While the
    # payload is unchanged that costs a 304 with no body instead of the full payload.
    headers = {"ETag": payload.etag, "Cache-Control": "public, no-cache"}
    if etag_matches(request, payload.etag):
        return Response(status_code=304, headers=headers)
    return Response(
        content=payload.body_gz,
        media_type="application/x-protobuf",
        headers={**headers, "Content-Encoding": "gzip"})
