'use strict';
import https from 'https';
const MAX_BYTES = 131072;
const BASE = process.env.VERIFY_API_BASE_URL || 'https://api.obligra.ai';
const KEY = process.env.VERIFY_API_KEY;
let policy, configurationError;
try {
  policy = JSON.parse(process.env.CAPTURE_POLICY_JSON || '{"mode":"intent_only"}');
  if (!policy || !['forward_all', 'intent_only', 'policy'].includes(policy.mode)) throw Error('invalid_policy');
  for (const value of [policy.capture, policy.security, policy.capture?.operationalContext, policy.capture?.prompt, policy.capture?.response]) {
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('invalid_policy');
  }
  for (const value of [policy.security?.neverForward, policy.capture?.operationalContext?.allowedKeys, policy.capture?.operationalContext?.redactedKeys]) {
    if (value !== undefined && (!Array.isArray(value) || value.some(x => typeof x !== 'string' || !x))) throw Error('invalid_policy');
  }
  for (const value of [policy.capture?.prompt?.allow, policy.capture?.response?.allow, policy.capture?.operationalContext?.dropUnknownKeys]) {
    if (value !== undefined && typeof value !== 'boolean') throw Error('invalid_policy');
  }
  for (const value of [policy.capture?.prompt?.maxLength, policy.capture?.response?.maxLength, policy.capture?.operationalContext?.maxValueLength]) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw Error('invalid_policy');
  }
  if (policy.capture?.model !== undefined) {
    if (!policy.capture.model || typeof policy.capture.model !== 'object' || Array.isArray(policy.capture.model)) throw Error('invalid_model_policy');
    for (const value of [policy.capture.model.includeProvider, policy.capture.model.includeModelId]) {
      if (value !== undefined && typeof value !== 'boolean') throw Error('invalid_model_policy');
    }
  }
  const knownKeys = (value, allowed) => {
    if (value !== undefined && Object.keys(value).some(key => !allowed.includes(key))) throw Error('unsupported_policy_key');
  };
  knownKeys(policy, ['mode', 'capture', 'security']);
  knownKeys(policy.security, ['neverForward', 'logRedactions']);
  knownKeys(policy.capture, ['operationalContext', 'prompt', 'response', 'model']);
  knownKeys(policy.capture?.operationalContext, ['allowedKeys', 'redactedKeys', 'dropUnknownKeys', 'maxValueLength']);
  knownKeys(policy.capture?.prompt, ['allow', 'maxLength']);
  knownKeys(policy.capture?.response, ['allow', 'maxLength']);
  knownKeys(policy.capture?.model, ['includeProvider', 'includeModelId']);
  if (policy.security?.logRedactions !== undefined && typeof policy.security.logRedactions !== 'boolean') throw Error('invalid_policy');
  if (policy.capture?.operationalContext?.dropUnknownKeys === false) throw Error('unsupported_policy');
  // No key-bearing redirects, URL credentials or alternate hosts.
  if (BASE !== 'https://api.obligra.ai') throw Error('invalid_capture_base');
} catch { configurationError = true; }
const record = value => value && typeof value === 'object' && !Array.isArray(value);
function strip(value, blocked) {
  if (Array.isArray(value)) return value.map(v => strip(v, blocked));
  if (!record(value)) return value;
  const out = Object.create(null);
  for (const [key, val] of Object.entries(value)) {
    if (!blocked.has(key.toLowerCase()) && !['__proto__','constructor','prototype'].includes(key)) out[key] = strip(val, blocked);
  }
  return out;
}
function applyPolicy(body) {
  if (configurationError) throw Error('invalid_configuration');
  if (!record(body) || typeof body.workflowId !== 'string' || !body.workflowId.trim()) throw Error('invalid_request');
  const blocked = new Set((policy.security?.neverForward || []).map(x => x.toLowerCase()));
  if (blocked.has('workflowid')) throw Error('required_field_excluded');
  if (body.workflowId.length > 128 || 'environmentId' in body) throw Error('invalid_capture_scope');
  const clean = strip(body, blocked);
  if (clean.operationalContext !== undefined) {
    if (!record(clean.operationalContext)) throw Error('invalid_context');
    for (const value of Object.values(clean.operationalContext)) {
      if (typeof value !== 'string' || value.length > 128) throw Error('invalid_context');
    }
  }
  if (policy.mode === 'forward_all') { validateContract(clean); return clean; }
  const result = {workflowId: clean.workflowId};
  const cap = policy.capture || {};
  if (clean.model && cap.model !== false) {
    result.model = {};
    if (cap.model?.includeProvider !== false && clean.model.provider) result.model.provider = clean.model.provider;
    if (cap.model?.includeModelId !== false && clean.model.modelId) result.model.modelId = clean.model.modelId;
  }
  if (policy.mode === 'intent_only') {
    if (!blocked.has('operationalcontext') && !blocked.has('capturemode')) result.operationalContext = {captureMode:'intent_only'};
    validateContract(result);
    return result;
  }
  const ctxPolicy = cap.operationalContext || {};
  const redacted = new Set((ctxPolicy.redactedKeys || []).map(x => x.toLowerCase()));
  const allowed = new Set(ctxPolicy.allowedKeys || []);
  if (!blocked.has('operationalcontext')) {
    result.operationalContext = Object.create(null);
    for (const [key,value] of Object.entries(clean.operationalContext || {})) {
      if (redacted.has(key.toLowerCase()) || !allowed.has(key)) continue;
      if (value.length > Math.min(ctxPolicy.maxValueLength || 128,128)) throw Error('context_length_exceeded');
      result.operationalContext[key] = value;
    }
  }
  // AI content stays in its dedicated field. Never silently move it into retrieval references.
  if (clean.aiAssistedContext !== undefined) {
    if (!record(clean.aiAssistedContext)) throw Error('invalid_ai_context');
    const ai = Object.create(null);
    for (const [key,value] of Object.entries(clean.aiAssistedContext)) {
      if (redacted.has(key.toLowerCase())) continue;
      const rule = cap[key];
      if (!['prompt','response'].includes(key)) throw Error('unsupported_ai_policy');
      if (!rule || rule.allow !== true) continue;
      if (typeof value !== 'string' || value.length > (rule.maxLength || 512)) throw Error('ai_length_exceeded');
      ai[key] = value;
    }
    if (!blocked.has('aiassistedcontext') && Object.keys(ai).length) result.aiAssistedContext = ai;
  }
  if (body.prompt !== undefined || body.response !== undefined || body.operationalContext?.prompt !== undefined || body.operationalContext?.response !== undefined) throw Error('legacy_prompt_placement');
  validateContract(result);
  return result;
}
function validateContract(body) {
  if (!record(body.model) || typeof body.model.provider !== "string" || !body.model.provider.trim() || body.model.provider.length>64 || typeof body.model.modelId !== "string" || !body.model.modelId.trim() || body.model.modelId.length>128) throw Error("invalid_model");
  if (!record(body.operationalContext) || Object.keys(body.operationalContext).length>20) throw Error("invalid_context");
  for (const [key,value] of Object.entries(body.operationalContext)) if(key.length>64 || typeof value !== "string" || value.length>128) throw Error("invalid_context");
  if(body.aiAssistedContext!==undefined && (!record(body.aiAssistedContext) || Object.values(body.aiAssistedContext).some(value=>typeof value!=="string"))) throw Error("invalid_ai_context");
}
function forward(payload) {
  return new Promise((resolve,reject) => {
    let done = false;
    const finish = (err,value) => { if(done)return;done=true;clearTimeout(timer);err?reject(err):resolve(value); };
    const req = https.request({hostname:'api.obligra.ai',port:443,path:'/decision-records',method:'POST',headers:{'Content-Type':'application/json','X-Verify-Api-Key':KEY,'Content-Length':Buffer.byteLength(payload)}}, res => {
      let bytes=0,chunks=[];
      res.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>MAX_BYTES){finish(Error('response_limit'));res.destroy();req.destroy();return;}chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));});
      res.on('error',()=>finish(Error('response_error')));
      res.on('aborted',()=>finish(Error('response_aborted')));
      res.on('end',()=>finish(null,{statusCode:res.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });
    const timer = setTimeout(()=>{finish(Error('deadline'));req.destroy();},10000);
    req.on('error',()=>finish(Error('transport_error')));
    req.end(payload);
  });
}
export const handler = async event => {
  const response = (statusCode,code) => ({statusCode,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:code})});
  if(configurationError || !KEY) return response(503,'proxy_configuration_required');
  // IaC sets AWS_IAM. Also reject events without the gateway's verified IAM identity.
  if(!event.requestContext?.authorizer?.iam?.userArn) return response(401,'caller_authentication_required');
  if(event.requestContext?.http?.method !== 'POST') return response(405,'method_not_allowed');
  if(event.isBase64Encoded || typeof event.body !== 'string' || Buffer.byteLength(event.body)>MAX_BYTES) return response(400,'invalid_body');
  let payload;
  try { payload=JSON.stringify(applyPolicy(JSON.parse(event.body))); } catch { return response(400,'invalid_capture_request'); }
  try {
    const result=await forward(payload);
    if(result.statusCode>=200 && result.statusCode<300){
      let receipt;try{receipt=JSON.parse(result.body);}catch{return response(502,'invalid_capture_receipt');}
      if(typeof receipt.decisionRecordId !== 'string' || !receipt.decisionRecordId.trim()) return response(502,'invalid_capture_receipt');
    }
    if(result.statusCode>=300 && result.statusCode<400)return response(502,'capture_redirect_rejected');
    return {statusCode:result.statusCode,headers:{'Content-Type':'application/json'},body:result.body};
  } catch { return response(502,'capture_transport_error'); }
};
