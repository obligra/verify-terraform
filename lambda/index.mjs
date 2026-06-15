import https from 'https';

const VERIFY_URL = process.env.VERIFY_API_BASE_URL;
const API_KEY = process.env.VERIFY_API_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

// ─── Capture Policy Engine ─────────────────────────────────────────────────
let POLICY = { mode: 'forward_all' };
try {
  const raw = process.env.CAPTURE_POLICY_JSON;
  if (raw && raw.trim()) POLICY = JSON.parse(raw);
} catch (e) {
  log({ event: 'policy_parse_error', message: e.message });
}

function applyPolicy(body) {
  if (!POLICY || POLICY.mode === 'forward_all') return body;

  const cap = POLICY.capture || {};
  const sec = POLICY.security || {};
  const neverForward = new Set((sec.neverForward || []).map(k => k.toLowerCase()));
  const result = { workflowId: body.workflowId };

  if (POLICY.mode === 'intent_only') {
    if (body.model && cap.model !== false) {
      result.model = {};
      if (body.model.provider) result.model.provider = body.model.provider;
      if (body.model.modelId) result.model.modelId = body.model.modelId;
    }
    result.operationalContext = { captureMode: 'intent_only' };
    return result;
  }

  // policy mode: explicit field control
  const ctx = body.operationalContext || {};
  const filteredCtx = {};
  const ctxPolicy = cap.operationalContext || {};
  const allowedKeys = ctxPolicy.allowedKeys ? new Set(ctxPolicy.allowedKeys) : null;
  const redactedKeys = new Set((ctxPolicy.redactedKeys || []).map(k => k.toLowerCase()));
  const dropUnknown = ctxPolicy.dropUnknownKeys === true;
  const maxValueLen = ctxPolicy.maxValueLength || 1024;
  let droppedCount = 0;
  let redactedCount = 0;

  for (const [key, value] of Object.entries(ctx)) {
    const keyLower = key.toLowerCase();
    if (neverForward.has(keyLower)) { droppedCount++; continue; }
    if (key === 'prompt' || key === 'response') continue;
    if (redactedKeys.has(keyLower)) { redactedCount++; continue; }
    if (allowedKeys && !allowedKeys.has(key)) {
      if (dropUnknown) { droppedCount++; continue; }
    }
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    filteredCtx[key] = strVal.slice(0, maxValueLen);
  }

  // Handle prompt
  const promptPolicy = cap.prompt || {};
  if (promptPolicy.allow !== false) {
    const promptVal = ctx.prompt || body.prompt || '';
    if (promptVal) filteredCtx.prompt = promptVal.slice(0, promptPolicy.maxLength || 512);
  } else { droppedCount++; }

  // Handle response
  const responsePolicy = cap.response || {};
  if (responsePolicy.allow !== false) {
    const responseVal = ctx.response || body.response || '';
    if (responseVal) filteredCtx.response = responseVal.slice(0, responsePolicy.maxLength || 512);
  } else { droppedCount++; }

  result.operationalContext = filteredCtx;

  // Model
  if (body.model) {
    result.model = {};
    if (body.model.provider) result.model.provider = body.model.provider;
    if (body.model.modelId) result.model.modelId = body.model.modelId;
  }

  // Strip neverForward from top-level
  for (const key of Object.keys(result)) {
    if (neverForward.has(key.toLowerCase()) && key !== 'workflowId') {
      delete result[key]; droppedCount++;
    }
  }

  if (droppedCount > 0 || redactedCount > 0) {
    log({ event: 'policy_applied', mode: POLICY.mode, droppedFields: droppedCount, redactedFields: redactedCount });
  }

  return result;
}

// ─── Handler ───────────────────────────────────────────────────────────────
export async function handler(event) {
  const start = Date.now();
  const requestId = event.requestContext?.requestId || 'unknown';
  const method = event.requestContext?.http?.method || event.httpMethod;
  const origin = event.headers?.origin || event.headers?.Origin || '';

  if (method === 'OPTIONS') return corsResponse(204, '', origin);

  if (method !== 'POST') {
    log({ requestId, action: 'rejected', reason: 'method_not_allowed' });
    return corsResponse(405, JSON.stringify({ error: 'method_not_allowed' }), origin);
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    log({ requestId, action: 'rejected', reason: 'invalid_json' });
    return corsResponse(400, JSON.stringify({ error: 'invalid_json' }), origin);
  }

  if (!body.workflowId) {
    log({ requestId, action: 'rejected', reason: 'missing_workflow_id' });
    return corsResponse(400, JSON.stringify({ error: 'missing_workflow_id', message: 'workflowId is required' }), origin);
  }

  const filteredBody = applyPolicy(body);

  try {
    const result = await forwardToVerify(JSON.stringify(filteredBody));
    const duration = Date.now() - start;
    log({ requestId, action: 'forwarded', workflowId: body.workflowId, policyMode: POLICY.mode, statusCode: result.statusCode, durationMs: duration });
    return corsResponse(result.statusCode, result.body, origin);
  } catch (err) {
    const duration = Date.now() - start;
    log({ requestId, action: 'error', workflowId: body.workflowId, errorCode: err.code || 'PROXY_ERROR', durationMs: duration });
    return corsResponse(502, JSON.stringify({ error: 'proxy_error', message: 'Failed to reach Verify API' }), origin);
  }
}

// ─── Forward ───────────────────────────────────────────────────────────────
function forwardToVerify(payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(VERIFY_URL + '/decision-records');
    const options = {
      hostname: target.hostname,
      port: 443,
      path: target.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Verify-Api-Key': API_KEY,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(payload);
    req.end();
  });
}

// ─── Utilities ─────────────────────────────────────────────────────────────
function corsResponse(statusCode, body, origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes('*') ? '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: body || '',
  };
}

function log(fields) {
  // SECURITY: Never log payloads, API keys, prompts, responses, or customer data.
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), service: 'verify-capture-proxy', ...fields }));
}
