/**
 * Kalshi RSA-PSS request signer.
 *
 * Signing spec (Kalshi API docs): the signed message is the concatenation
 * of `${timestampMs}${method.toUpperCase()}${path}`, where `path` includes
 * the full request path (e.g. `/trade-api/v2/markets`) but EXCLUDES any
 * query string. The message is signed with RSA-PSS, SHA-256 digest,
 * MGF1-SHA256 mask generation, and a salt length equal to the digest
 * length (32 bytes), then base64-encoded.
 */
import * as crypto from 'node:crypto';

export interface SignKalshiRequestParams {
  keyId: string;
  privateKeyPem: string;
  method: string;
  path: string;
  timestampMs: number;
}

export type KalshiSignedHeaders = Record<string, string>;

/** Strips a query string (and/or hash fragment) from a request path. */
function stripQueryString(path: string): string {
  const queryIdx = path.indexOf('?');
  const hashIdx = path.indexOf('#');
  let end = path.length;
  if (queryIdx !== -1) end = Math.min(end, queryIdx);
  if (hashIdx !== -1) end = Math.min(end, hashIdx);
  return path.slice(0, end);
}

/** Builds the exact message string Kalshi expects to be signed. */
export function buildKalshiSignatureMessage(params: {
  method: string;
  path: string;
  timestampMs: number;
}): string {
  const cleanPath = stripQueryString(params.path);
  return `${params.timestampMs}${params.method.toUpperCase()}${cleanPath}`;
}

/**
 * Signs a Kalshi API request and returns the headers that must be attached
 * to it: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, and
 * `KALSHI-ACCESS-SIGNATURE`.
 */
export function signKalshiRequest(params: SignKalshiRequestParams): KalshiSignedHeaders {
  const { keyId, privateKeyPem, method, path, timestampMs } = params;
  const message = buildKalshiSignatureMessage({ method, path, timestampMs });

  const signature = crypto.sign('sha256', Buffer.from(message), {
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });

  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-TIMESTAMP': String(timestampMs),
    'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
  };
}
