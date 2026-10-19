import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

const categories = ["general", "books", "vacancies", "videos", "python", "blogs"] as const;
const maxRequestBytes = 16 * 1024;
const maxDeliveryAttempts = 8;

export type PushCategory = typeof categories[number];

const allowedRequestHeaders = new Set([
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "x-supabase-api-version"
]);

const localDevelopmentOrigins = new Set([
  "http://127.0.0.1:5500",
  "http://localhost:5500"
]);

function configuredAllowedOrigins() {
  const origins = new Set(localDevelopmentOrigins);
  const configured = Deno.env.get("PUSH_ALLOWED_ORIGINS") || "";

  for (const value of configured.split(",")) {
    const candidate = value.trim();
    if (!candidate) continue;

    try {
      const parsed = new URL(candidate);
      const isLocalHttp = parsed.protocol === "http:" &&
        (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
      if (
        parsed.origin === candidate &&
        (parsed.protocol === "https:" || isLocalHttp) &&
        !parsed.username &&
        !parsed.password
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed configuration values; they cannot expand the allowlist.
    }
  }

  return origins;
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && configuredAllowedOrigins().has(origin);
}

export function corsHeadersFor(request: Request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": [...allowedRequestHeaders].join(", "),
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
    "Vary": "Origin"
  });
  const origin = request.headers.get("origin");
  if (origin && configuredAllowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function assertAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(request)) {
    throw new PushError(403, "This origin is not allowed to use the push API.");
  }
}

export function corsPreflightResponse(request: Request) {
  const headers = corsHeadersFor(request);
  const origin = request.headers.get("origin");
  if (!origin || !configuredAllowedOrigins().has(origin)) {
    return new Response(null, { status: 403, headers });
  }

  const requestedHeaders = (request.headers.get("access-control-request-headers") || "")
    .split(",")
    .map(header => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some(header => !allowedRequestHeaders.has(header))) {
    return new Response(null, { status: 403, headers });
  }

  return new Response(null, { status: 204, headers });
}

export function withCors(request: Request, response: Response) {
  const headers = corsHeadersFor(request);
  response.headers.forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export class PushError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new PushError(503, `Server configuration is missing ${name}.`);
  return value;
}

export function getServiceClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function readJson(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > maxRequestBytes) throw new PushError(413, "Request body is too large.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxRequestBytes) {
    throw new PushError(413, "Request body is too large.");
  }
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new PushError(400, "Request body must be a JSON object.");
  }
}

export function isCategory(value: unknown): value is PushCategory {
  return typeof value === "string" && categories.includes(value as PushCategory);
}

function base64Bytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytea(bytes: Uint8Array) {
  return `\\x${Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function readBytea(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== "string") throw new PushError(500, "Stored push data is invalid.");
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new PushError(500, "Stored push data is invalid.");
  }
  return Uint8Array.from(hex.match(/.{2}/g) || [], pair => Number.parseInt(pair, 16));
}

async function sha256Bytes(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function encryptionKey() {
  const key = base64Bytes(requiredEnv("PUSH_ENCRYPTION_KEY"));
  if (key.byteLength !== 32) throw new PushError(503, "PUSH_ENCRYPTION_KEY must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value)
  ));
  const combined = new Uint8Array(iv.length + encrypted.length);
  combined.set(iv);
  combined.set(encrypted, iv.length);
  return bytea(combined);
}

async function decrypt(value: unknown) {
  const combined = readBytea(value);
  if (combined.byteLength < 29) throw new PushError(500, "Stored push data is invalid.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: combined.slice(0, 12) },
    await encryptionKey(),
    combined.slice(12)
  );
  return new TextDecoder().decode(plaintext);
}

export async function rateLimit(
  serviceClient: SupabaseClient,
  key: string,
  windowSeconds: number,
  maximum: number
) {
  const bucket = base64Url(await sha256Bytes(key));
  const { data, error } = await serviceClient.rpc("consume_push_rate_limit", {
    p_bucket_key: bucket,
    p_window_seconds: windowSeconds,
    p_max_requests: maximum
  });
  if (error) throw new PushError(503, "Push rate limit could not be checked.");
  if (data !== true) throw new PushError(429, "Too many requests. Try again later.");
}

export async function resolveCaller(request: Request) {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const anonKey = requiredEnv("SUPABASE_ANON_KEY");
  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!bearer || bearer === anonKey) return { userId: null, bearer };

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await callerClient.auth.getUser(bearer);
  if (error || !data.user) throw new PushError(401, "The signed-in session is invalid.");
  return { userId: data.user.id, bearer };
}

function validateEndpoint(value: unknown) {
  if (typeof value !== "string" || value.length < 30 || value.length > 2048) {
    throw new PushError(400, "Invalid push endpoint.");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new PushError(400, "Invalid push endpoint.");
  }
  const host = endpoint.hostname.toLowerCase();
  const trustedHost = host === "fcm.googleapis.com" ||
    host === "updates.push.services.mozilla.com" ||
    host === "web.push.apple.com" ||
    host.endsWith(".push.services.mozilla.com") ||
    host.endsWith(".notify.windows.com");
  if (endpoint.protocol !== "https:" || !trustedHost || endpoint.username || endpoint.password) {
    throw new PushError(400, "Unsupported push service endpoint.");
  }
  return endpoint.toString();
}

function parsePushSubscription(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PushError(400, "Invalid push subscription.");
  }
  const subscription = value as Record<string, unknown>;
  const endpoint = validateEndpoint(subscription.endpoint);
  const keys = subscription.keys;
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
    throw new PushError(400, "Invalid push encryption keys.");
  }
  const keyValues = keys as Record<string, unknown>;
  if (typeof keyValues.p256dh !== "string" || typeof keyValues.auth !== "string") {
    throw new PushError(400, "Invalid push encryption keys.");
  }
  let p256dh: Uint8Array;
  let auth: Uint8Array;
  try {
    p256dh = base64Bytes(keyValues.p256dh);
    auth = base64Bytes(keyValues.auth);
  } catch {
    throw new PushError(400, "Invalid push encryption keys.");
  }
  if (p256dh.byteLength !== 65 || auth.byteLength !== 16) {
    throw new PushError(400, "Invalid push encryption keys.");
  }
  const expirationTime = subscription.expirationTime;
  let expiresAt: string | null = null;
  if (expirationTime !== null && expirationTime !== undefined) {
    if (typeof expirationTime !== "number" || !Number.isFinite(expirationTime) ||
      expirationTime <= Date.now()) {
      throw new PushError(400, "The push subscription has expired.");
    }
    expiresAt = new Date(expirationTime).toISOString();
  }
  return { endpoint, p256dh: keyValues.p256dh, auth: keyValues.auth, expiresAt };
}

async function getOwner(
  userId: string | null,
  anonymousToken: unknown
) {
  if (typeof anonymousToken !== "string" || !/^[A-Za-z0-9_-]{40,64}$/.test(anonymousToken)) {
    if (userId) return { userId, anonymousHash: null as string | null };
    throw new PushError(401, "A valid anonymous subscription token is required.");
  }
  return {
    userId,
    anonymousHash: bytea(await sha256Bytes(anonymousToken))
  };
}

function ownedQuery(serviceClient: SupabaseClient, owner: { userId: string | null; anonymousHash: string | null }) {
  let query = serviceClient.from("push_subscriptions").select(
    "id,user_id,anonymous_token_hash,category_preferences,enabled"
  );
  if (owner.userId) query = query.eq("user_id", owner.userId);
  else query = query.eq("anonymous_token_hash", owner.anonymousHash);
  return query;
}

async function ownedSubscription(
  serviceClient: SupabaseClient,
  owner: { userId: string | null; anonymousHash: string | null },
  endpointHash?: string
) {
  let query = ownedQuery(serviceClient, owner);
  if (endpointHash) query = query.eq("endpoint_hash", endpointHash);
  const { data, error } = await query.limit(2);
  if (error) throw new PushError(503, "Subscription records could not be loaded.");
  if (!data?.length) return null;
  if (!endpointHash && data.length > 1) {
    throw new PushError(400, "Choose the current browser subscription to manage preferences.");
  }
  return data[0];
}

function validatePreferences(value: unknown) {
  if (!Array.isArray(value) || value.length > categories.length ||
    value.some(category => !isCategory(category)) ||
    new Set(value).size !== value.length) {
    throw new PushError(400, "Choose valid notification categories.");
  }
  return value as PushCategory[];
}

async function saveSubscription(
  serviceClient: SupabaseClient,
  userId: string | null,
  body: Record<string, unknown>
) {
  const parsed = parsePushSubscription(body.subscription);
  const endpointHash = bytea(await sha256Bytes(parsed.endpoint));
  const owner = await getOwner(userId, body.anonymousToken);
  if (!owner.anonymousHash) {
    throw new PushError(401, "Secure device management could not be established.");
  }
  const { data: existing, error: lookupError } = await serviceClient
    .from("push_subscriptions")
    .select("id,user_id,anonymous_token_hash,category_preferences")
    .eq("endpoint_hash", endpointHash)
    .maybeSingle();
  if (lookupError) throw new PushError(503, "Subscription ownership could not be verified.");
  if (existing) {
    const sameOwner = owner.userId
        ? existing.user_id === owner.userId ||
          (owner.anonymousHash !== null &&
            bytea(readBytea(existing.anonymous_token_hash)) === owner.anonymousHash)
        : owner.anonymousHash !== null &&
          bytea(readBytea(existing.anonymous_token_hash)) === owner.anonymousHash;
    if (!sameOwner) throw new PushError(409, "This browser subscription belongs to another account.");
  }

  const preferences = existing?.category_preferences || [...categories];
  const update = {
    endpoint_hash: endpointHash,
    endpoint_ciphertext: await encrypt(parsed.endpoint),
    p256dh_ciphertext: await encrypt(parsed.p256dh),
    auth_ciphertext: await encrypt(parsed.auth),
    category_preferences: preferences,
    enabled: true,
    expires_at: parsed.expiresAt,
    user_id: owner.userId,
    anonymous_token_hash: owner.anonymousHash,
    updated_at: new Date().toISOString()
  };

  let result;
  if (existing) {
    let query = serviceClient.from("push_subscriptions").update(update).eq("id", existing.id);
    if (existing.user_id) query = query.eq("user_id", existing.user_id);
    else query = query.is("user_id", null);
    if (owner.anonymousHash) query = query.eq("anonymous_token_hash", owner.anonymousHash);
    result = await query;
  } else {
    result = await serviceClient.from("push_subscriptions").insert(update);
  }
  if (result.error) throw new PushError(503, "Push subscription could not be saved.");
  return { endpointHash, preferences };
}

async function manageSubscription(
  serviceClient: SupabaseClient,
  userId: string | null,
  body: Record<string, unknown>
) {
  const action = body.action;
  const endpoint = validateEndpoint(body.endpoint);
  const endpointHash = bytea(await sha256Bytes(endpoint));
  if (action === "associate" || action === "disassociate") {
    if (!userId) throw new PushError(401, "Sign in to associate this device.");
    const owner = await getOwner(null, body.anonymousToken);
    let lookup = serviceClient
      .from("push_subscriptions")
      .select("id,user_id,category_preferences")
      .eq("endpoint_hash", endpointHash)
      .eq("anonymous_token_hash", owner.anonymousHash);
    if (action === "associate") lookup = lookup.is("user_id", null);
    else lookup = lookup.eq("user_id", userId);
    const { data: anonymousRecord, error } = await lookup.maybeSingle();
    if (error) throw new PushError(503, "Anonymous subscription could not be verified.");
    if (!anonymousRecord) {
      if (action === "associate") {
        const { data: alreadyOwned } = await serviceClient
          .from("push_subscriptions")
          .select("id")
          .eq("endpoint_hash", endpointHash)
          .eq("user_id", userId)
          .eq("anonymous_token_hash", owner.anonymousHash)
          .maybeSingle();
        return { associated: Boolean(alreadyOwned) };
      }
      const { data: alreadyAnonymous } = await serviceClient
        .from("push_subscriptions")
        .select("id")
        .eq("endpoint_hash", endpointHash)
        .is("user_id", null)
        .eq("anonymous_token_hash", owner.anonymousHash)
        .maybeSingle();
      return { associated: false, disassociated: Boolean(alreadyAnonymous) };
    }
    const patch = action === "associate"
      ? { user_id: userId, updated_at: new Date().toISOString() }
      : { user_id: null, anonymous_token_hash: owner.anonymousHash, updated_at: new Date().toISOString() };
    let updateQuery = serviceClient
      .from("push_subscriptions")
      .update(patch)
      .eq("id", anonymousRecord.id);
    if (action === "associate") updateQuery = updateQuery.is("user_id", null);
    else updateQuery = updateQuery.eq("user_id", userId);
    const { error: updateError } = await updateQuery;
    if (updateError) throw new PushError(503, "Device ownership could not be updated.");
    return { associated: action === "associate" };
  }

  const owner = await getOwner(userId, body.anonymousToken);
  const existing = await ownedSubscription(serviceClient, owner, endpointHash);
  if (!existing) throw new PushError(404, "This browser subscription was not found.");

  if (action === "get-preferences") {
    return { preferences: existing.category_preferences || [] };
  }
  if (action === "preferences") {
    const preferences = validatePreferences(body.preferences);
    const { error } = await serviceClient
      .from("push_subscriptions")
      .update({ category_preferences: preferences, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new PushError(503, "Notification preferences could not be saved.");
    return { preferences };
  }
  if (action === "unsubscribe") {
    const { error } = await serviceClient.from("push_subscriptions").delete().eq("id", existing.id);
    if (error) throw new PushError(503, "Subscription could not be removed.");
    return { unsubscribed: true };
  }
  throw new PushError(400, "Unsupported subscription action.");
}

async function dispatchNotifications(serviceClient: SupabaseClient, notificationLimit = 5) {
  const { data: notificationIds, error: claimError } = await serviceClient.rpc(
    "claim_push_notifications",
    { p_limit: notificationLimit }
  );
  if (claimError) throw new PushError(503, "Queued notifications could not be claimed.");

  for (const notificationId of notificationIds || []) {
    const { error } = await serviceClient.rpc("prepare_push_deliveries", {
      p_notification_id: notificationId
    });
    if (error) throw new PushError(503, "Notification recipients could not be prepared.");
  }

  const { data: deliveries, error: deliveryError } = await serviceClient.rpc(
    "claim_push_deliveries",
    { p_limit: 500 }
  );
  if (deliveryError) throw new PushError(503, "Push deliveries could not be claimed.");
  const processedByNotification = new Set<string>();
  let sent = 0;
  let retried = 0;
  let expired = 0;

  if (deliveries?.length) {
    webPush.setVapidDetails(
      requiredEnv("VAPID_SUBJECT"),
      requiredEnv("VAPID_PUBLIC_KEY"),
      requiredEnv("VAPID_PRIVATE_KEY")
    );
  }

  for (const delivery of deliveries || []) {
    const notificationId = String(delivery.notification_id);
    processedByNotification.add(notificationId);
    try {
      const endpoint = await decrypt(delivery.endpoint_ciphertext);
      const p256dh = await decrypt(delivery.p256dh_ciphertext);
      const auth = await decrypt(delivery.auth_ciphertext);
      const result = await webPush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        JSON.stringify({
          title: delivery.title,
          body: delivery.body,
          url: delivery.target_url,
          category: delivery.category
        }),
        { TTL: 60 * 60 }
      );
      const { error } = await serviceClient.from("push_deliveries").update({
        status: "sent",
        provider_status: result.statusCode || 201,
        delivered_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString()
      }).eq("id", delivery.delivery_id);
      if (error) throw new PushError(503, "Delivery status could not be recorded.");
      sent++;
    } catch (error) {
      const status = Number((error as { statusCode?: number })?.statusCode || 0);
      const isExpired = status === 404 || status === 410;
      const isRetryable = status === 0 || status === 408 || status === 425 ||
        status === 429 || status >= 500;
      const terminal = !isExpired && (!isRetryable || Number(delivery.attempts) >= maxDeliveryAttempts);
      const delaySeconds = Math.min(6 * 60 * 60, 30 * (2 ** Math.min(Number(delivery.attempts), 10)));
      const safeError = isExpired
        ? "Push service reports the subscription is expired."
        : status
        ? `Push service returned HTTP ${status}.`
        : "Push delivery failed; retry if attempts remain.";
      const { error: updateError } = await serviceClient.from("push_deliveries").update({
        status: isExpired ? "expired" : terminal ? "failed" : "retry",
        provider_status: status || null,
        last_error: safeError,
        next_attempt_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", delivery.delivery_id);
      if (updateError) throw new PushError(503, "Delivery failure could not be recorded.");
      if (isExpired) {
        const { error: disableError } = await serviceClient.from("push_subscriptions")
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq("id", delivery.subscription_id);
        if (disableError) throw new PushError(503, "Expired subscription could not be disabled.");
        const { error: expireDeliveriesError } = await serviceClient.from("push_deliveries")
          .update({
            status: "expired",
            last_error: "Push service reports this subscription is expired.",
            updated_at: new Date().toISOString()
          })
          .eq("subscription_id", delivery.subscription_id)
          .in("status", ["queued", "retry", "processing"]);
        if (expireDeliveriesError) throw new PushError(503, "Expired subscription deliveries could not be closed.");
        expired++;
      } else if (!terminal) {
        retried++;
      }
    }
  }

  for (const notificationId of new Set([...(notificationIds || []), ...processedByNotification])) {
    const { error } = await serviceClient.rpc("finalize_push_notification", {
      p_notification_id: notificationId
    });
    if (error) throw new PushError(503, "Notification completion could not be recorded.");
  }
  return { claimed: (notificationIds || []).length, sent, retried, expired };
}

export async function handlePushApi(request: Request) {
  if (request.method !== "POST") throw new PushError(405, "Use POST for push operations.");
  const body = await readJson(request);
  const serviceClient = getServiceClient();
  const action = body.action;

  if (action === "config") {
    return jsonResponse({ vapidPublicKey: requiredEnv("VAPID_PUBLIC_KEY") });
  }

  const caller = await resolveCaller(request);
  if (action === "subscribe") {
    const parsed = parsePushSubscription(body.subscription);
    const hash = bytea(await sha256Bytes(parsed.endpoint));
    await rateLimit(serviceClient, `subscribe:${hash}`, 60 * 60, 10);
    const saved = await saveSubscription(serviceClient, caller.userId, body);
    return jsonResponse({ subscribed: true, preferences: saved.preferences });
  }

  if (action === "send") {
    if (!caller.userId) throw new PushError(401, "Sign in with an administrator account.");
    await rateLimit(serviceClient, `manual:${caller.userId}`, 60 * 60, 10);
    const idempotencyKey = body.idempotencyKey;
    const category = body.category;
    const title = body.title;
    const message = body.body;
    const targetUrl = body.targetUrl;
    if (typeof idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey) ||
      !isCategory(category) ||
      typeof title !== "string" || title.trim().length < 1 || title.trim().length > 120 ||
      typeof message !== "string" || message.trim().length < 1 || message.trim().length > 240 ||
      typeof targetUrl !== "string" || targetUrl.length > 500) {
      throw new PushError(400, "Complete the announcement fields with valid values.");
    }
    let safeTarget: URL;
    try {
      safeTarget = new URL(targetUrl, request.headers.get("origin") || requiredEnv("SUPABASE_URL"));
    } catch {
      throw new PushError(400, "Enter a valid same-site destination.");
    }
    const incomingOrigin = request.headers.get("origin");
    if (!targetUrl.startsWith("/") || targetUrl.startsWith("//") ||
      targetUrl.includes("\\") || /[\u0000-\u001f]/.test(targetUrl) ||
      (incomingOrigin && safeTarget.origin !== incomingOrigin)) {
      throw new PushError(400, "Enter a same-site path beginning with '/'.");
    }

    const callerClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${caller.bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: notificationId, error } = await callerClient.rpc(
      "enqueue_manual_push_announcement",
      {
        p_idempotency_key: idempotencyKey,
        p_category: category,
        p_title: title.trim(),
        p_body: message.trim(),
        p_target_url: targetUrl
      }
    );
    if (error) {
      if (error.code === "42501") throw new PushError(403, "Only Admin and Super Admin accounts may send announcements.");
      throw new PushError(400, error.message || "The announcement could not be queued.");
    }
    await dispatchNotifications(serviceClient, 5);
    return jsonResponse({ queued: true, notificationId });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (action === "unsubscribe" || action === "preferences" ||
    action === "get-preferences" || action === "associate" || action === "disassociate") {
    const endpointUrl = validateEndpoint(endpoint);
    const owner = await getOwner(caller.userId, body.anonymousToken);
    const key = `${action}:${owner.userId || owner.anonymousHash}:${endpointUrl}`;
    await rateLimit(serviceClient, key, 60, action === "preferences" ? 30 : 10);
    return jsonResponse(await manageSubscription(serviceClient, caller.userId, body));
  }

  throw new PushError(400, "Unsupported push action.");
}

export async function handlePushDispatcher(request: Request) {
  if (request.method !== "POST") throw new PushError(405, "Use POST to dispatch notifications.");
  if (request.headers.get("authorization") !== `Bearer ${requiredEnv("PUSH_DISPATCH_SECRET")}`) {
    throw new PushError(401, "Dispatcher authorization failed.");
  }
  const serviceClient = getServiceClient();
  const body = await readJson(request);
  const limit = body.limit === undefined ? 5 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    throw new PushError(400, "Dispatcher batch limit must be between 1 and 25.");
  }
  await rateLimit(serviceClient, "dispatcher", 60, 10);
  const { error: cleanupError } = await serviceClient.rpc("disable_expired_push_subscriptions");
  if (cleanupError) throw new PushError(503, "Expired subscriptions could not be cleaned up.");
  return jsonResponse({ result: await dispatchNotifications(serviceClient, limit) });
}

export function handlePushError(error: unknown, request: Request) {
  const status = error instanceof PushError ? error.status : 500;
  if (status === 500) {
    console.error("Push operation failed:", error instanceof Error ? error.name : "UnknownError");
  }
  return withCors(
    request,
    jsonResponse(
      { error: error instanceof Error ? error.message : "Push operation failed." },
      status
    )
  );
}
