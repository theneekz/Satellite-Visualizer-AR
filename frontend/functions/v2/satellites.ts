/**
 * GET /v2/satellites in production. Serves the gzipped protobuf OMMList that the publish job
 * (backend/publish.py) uploads to R2, cached like the local API server's: browsers keep a copy and
 * revalidate it by ETag, so an unchanged payload costs a 304 with no body.
 */

interface Env {
  // The R2 bucket the publish job uploads to, bound to this Pages project as SATELLITES.
  SATELLITES: R2Bucket;
}

// The object backend/publish.py uploads.
const OBJECT_KEY = "satellites.pb.gz";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // Given the request's If-None-Match, R2 leaves out the body of a payload the browser already has.
  const object = await env.SATELLITES.get(OBJECT_KEY, {
    onlyIf: request.headers,
  });
  if (!object) {
    return new Response("Satellite data not published", { status: 503 });
  }

  const headers = new Headers({
    ETag: object.httpEtag,
    // Browsers may store the payload but must revalidate it on every visit.
    "Cache-Control": "public, no-cache",
  });
  if (!("body" in object)) {
    return new Response(null, { status: 304, headers });
  }
  // Content-Type and Content-Encoding (gzip), as set by the upload.
  object.writeHttpMetadata(headers);
  // The body is already gzipped; "manual" keeps the runtime from compressing it again.
  return new Response(object.body, { headers, encodeBody: "manual" });
};
