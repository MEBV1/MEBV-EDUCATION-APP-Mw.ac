import {
  assertAllowedOrigin,
  corsPreflightResponse,
  handlePushApi,
  handlePushError,
  withCors
} from "../_shared/push.ts";

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse(request);
  }

  try {
    assertAllowedOrigin(request);
    return withCors(request, await handlePushApi(request));
  } catch (error) {
    return handlePushError(error, request);
  }
});
