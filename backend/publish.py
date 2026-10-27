"""Publishes the /v2/satellites payload to Cloudflare R2, where a Pages Function serves it.

Run from backend/:
    python -m publish                                     # download from Spacebook, upload to R2
    python -m publish --input omm.json                    # upload a saved OMM JSON file instead
    python -m publish --input omm.json --output out.pb.gz # write the payload locally; no R2

The scheduled workflow .github/workflows/publish-satellites.yml runs this a few times a day. It
is the only code that calls Spacebook, so the number of requests doesn't grow with traffic.
Uploading reads R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET from the
environment.
"""
import argparse
import gzip
import json
import os
import urllib.request
from pathlib import Path
from typing import List, Optional

from logger import log
from satellites_payload import SatellitesPayload, build_satellites_payload

SPACEBOOK_OMM_URL = "https://spacebook.com/api/entity/omm/json"
# Names the project in every request, so Spacebook can contact it instead of blocking it.
USER_AGENT = "SatViz (+https://github.com/theneekz/Satellite-Visualizer-AR)"
# Seconds to wait for the connection, and for each read of the response.
DOWNLOAD_TIMEOUT_S = 120

# The object frontend/functions/v2/satellites.ts serves.
OBJECT_KEY = "satellites.pb.gz"
# A catalog smaller than this fraction of the published one is treated as a truncated download,
# and the published payload stays in place.
MIN_COUNT_RATIO = 0.9


def download_records() -> List[dict]:
    """Every OMM record from Spacebook, in one request. Never retries: if this run fails, the
    published payload stays in place until the next scheduled run."""
    request = urllib.request.Request(SPACEBOOK_OMM_URL, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_S) as response:
        body = response.read()
        if response.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
    log(f"downloaded {len(body) / 1e6:.1f} MB from {SPACEBOOK_OMM_URL}")
    return json.loads(body)


def read_records(path: str) -> List[dict]:
    with open(path) as f:
        return json.load(f)


def r2_client():
    # Imported here so --output works without boto3 installed.
    import boto3
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )


def published_metadata(client, bucket: str) -> Optional[dict]:
    """The published payload's custom metadata, or None if nothing is published yet."""
    from botocore.exceptions import ClientError
    try:
        return client.head_object(Bucket=bucket, Key=OBJECT_KEY)["Metadata"]
    except ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return None
        raise


def upload(client, bucket: str, payload: SatellitesPayload) -> None:
    """Uploads the payload unless that version is already published. Raises instead of replacing
    the published payload with one that has far fewer satellites."""
    published = published_metadata(client, bucket)
    if published is not None:
        if published.get("version") == payload.version:
            log(f"version {payload.version} is already published; nothing to upload")
            return
        published_count = int(published.get("count", 0))
        if payload.count < published_count * MIN_COUNT_RATIO:
            raise RuntimeError(
                f"only {payload.count} satellites versus {published_count} published; "
                "keeping the published payload")

    client.put_object(
        Bucket=bucket,
        Key=OBJECT_KEY,
        Body=payload.body_gz,
        ContentType="application/x-protobuf",
        ContentEncoding="gzip",
        Metadata={"version": payload.version, "count": str(payload.count)},
    )
    log(f"published version {payload.version} with {payload.count} satellites")


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish the /v2/satellites payload to R2.")
    parser.add_argument(
        "--input", help="OMM JSON file to publish instead of downloading from Spacebook")
    parser.add_argument(
        "--output", help="write the gzipped payload to this file instead of uploading it")
    args = parser.parse_args()

    records = read_records(args.input) if args.input else download_records()
    if not isinstance(records, list):
        raise ValueError(f"expected a JSON array of OMM records, got {type(records).__name__}")
    payload = build_satellites_payload(records)
    if payload.count == 0:
        raise ValueError("none of the OMM records could be parsed")
    log(f"{payload.count} of {len(records)} records parsed; version {payload.version}")

    if args.output:
        Path(args.output).write_bytes(payload.body_gz)
        log(f"wrote {len(payload.body_gz) / 1e6:.2f} MB to {args.output}")
    else:
        upload(r2_client(), os.environ["R2_BUCKET"], payload)


if __name__ == "__main__":
    main()
