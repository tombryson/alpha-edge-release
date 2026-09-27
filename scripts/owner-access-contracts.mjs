const object = (properties, required = []) => ({ type: 'object', properties, required });
const string = { type: 'string' };
const boolean = { type: 'boolean' };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, description) => ({ description, content: { 'application/json': { schema } } });
const body = schema => ({ required: true, content: { 'application/json': { schema } } });
const errors = {
    400: { description: 'Invalid input.' },
    401: { description: 'Missing/invalid credential, expired grant or consumed challenge/code. Error is JSON with error, or code/message.' },
    403: { description: 'Origin/CSRF rejected, recovery-only grant, or fresh sign-in required.' },
    404: { description: 'Owner sessions are not enabled.' },
    429: { description: 'Global ceremony attempt limit; Retry-After: 60.' },
    503: { description: 'Configuration, database or session verification unavailable; no fallback access.' },
};
const origin = { name: 'Origin', in: 'header', required: true, schema: string, description: 'Must exactly equal APP_ORIGIN.' };
const csrf = { name: 'X-CSRF-Token', in: 'header', required: true, schema: string, description: 'Session-bound value from GET /api/auth/session. Browser memory only.' };
const writes = { parameters: [origin, csrf], security: [{ ownerSession: [], ownerCSRF: [] }] };
const ceremony = { parameters: [origin], security: [] };
const response = (schema, description) => ({ ...errors, 200: json(schema, description) });

export const ownerAccessSchemas = {
    OwnerSessionStatus: object({ authenticated: boolean, enrolled: boolean, recovery: boolean, csrf_token: string }, ['authenticated','enrolled','recovery']),
    OwnerSessionCreated: object({ authenticated: { const: true }, csrf_token: string, recovery_codes: { type: ['array','null'], items: string, description: 'Eight plaintext codes once at first enrollment or recovery; otherwise null. Never log.' } }, ['authenticated','csrf_token','recovery_codes']),
    OwnerWebAuthnOptions: object({ publicKey: { type: 'object', additionalProperties: true, description: 'Standard WebAuthn JSON creation/request options; pass publicKey unchanged to SimpleWebAuthn. Verification is required.' } }, ['publicKey']),
    OwnerRegistrationResponse: object({ id:string, rawId:string, type:{const:'public-key'}, response:object({clientDataJSON:string, attestationObject:string, transports:{type:'array',items:string}},['clientDataJSON','attestationObject']), clientExtensionResults:{type:'object',additionalProperties:true} },['id','rawId','type','response']),
    OwnerAuthenticationResponse: object({ id:string,rawId:string,type:{const:'public-key'},response:object({clientDataJSON:string,authenticatorData:string,signature:string,userHandle:{type:['string','null']}},['clientDataJSON','authenticatorData','signature']),clientExtensionResults:{type:'object',additionalProperties:true} },['id','rawId','type','response']),
};

export const ownerAccessContracts = {
    'GET /api/auth/session': { security: [], description: 'Public status only; a valid session adds csrf_token. No portfolio data. Host-only cookie, Cache-Control: no-store.', responses: response(ref('OwnerSessionStatus'),'Enrollment/session state.') },
    'POST /api/auth/check': { ...writes, security: [{bearerAuth:[]},{ownerSession:[],ownerCSRF:[]}], description: 'Council mutation authorization probe. No body. Session requires Origin+CSRF; machine bearer remains supported.', responses: { ...errors, 204: {description:'Authorized; no body.'} } },
    'POST /api/auth/register/start': { ...ceremony, requestBody:body(object({setup_token:string})), description:'Before enrollment, setup_token must match offline setup digest. After enrollment, needs a valid owner session authenticated within ten minutes, or a five-minute recovery grant, plus CSRF. Sets a single-use challenge cookie.',responses:response(ref('OwnerWebAuthnOptions'),'Creation options; challenge bound to setup or session grant.') },
    'POST /api/auth/register/finish': { ...ceremony, security:[{ownerChallenge:[]}], requestBody:body(ref('OwnerRegistrationResponse')), description:'Verify and consume challenge. Non-bootstrap registration rechecks session grant and CSRF. Recovery replaces all old credentials/sessions/codes atomically. Issues owner cookie; codes appear once.',responses:{...response(ref('OwnerSessionCreated'),'Registered; cookie and optional offline recovery codes.'),409:{description:'Owner already enrolled or credential cannot be saved.'}} },
    'POST /api/auth/login/start': { ...ceremony, description:'No username; this is a single-owner deployment. Sets single-use challenge cookie. No portfolio access yet.',responses:response(ref('OwnerWebAuthnOptions'),'Request options for a registered passkey.') },
    'POST /api/auth/login/finish': { ...ceremony,security:[{ownerChallenge:[]}],requestBody:body(ref('OwnerAuthenticationResponse')),description:'Verifies challenge, RP, origin, signature and user verification. Rejects counter clone warning/concurrent update. Rotates current session cookie.',responses:response(ref('OwnerSessionCreated'),'Authenticated; recovery_codes is null.') },
    'POST /api/auth/recover': { ...ceremony,requestBody:body(object({code:{type:'string',maxLength:128}},['code'])),description:'Atomically consumes one recovery code. Sets registration-only cookie for five minutes. Does not allow portfolio, Council, refresh or sign-out-everywhere.',responses:response(object({recovery:{const:true},csrf_token:string},['recovery','csrf_token']),'Recovery grant; register a replacement passkey next.') },
    'POST /api/auth/logout': { ...writes,description:'Revokes only the current persisted session and clears its cookie.',responses:response(object({ok:{const:true}},['ok']),'Signed out.') },
    'POST /api/auth/refresh': { ...writes,description:'Owner only. Extends last_seen, not the seven-day absolute expiry. Client calls every five minutes while visible.',responses:response(object({ok:{const:true}},['ok']),'Idle timestamp refreshed.') },
    'POST /api/auth/revoke-all': { ...writes,description:'Owner sign-in must be no older than ten minutes. Revokes all stored sessions, including this one. Does not revoke passkeys or recovery codes.',responses:response(object({ok:{const:true}},['ok']),'All sessions revoked.') },
};
