import * as crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildKalshiSignatureMessage, signKalshiRequest } from './signer.js';

function generateKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('signKalshiRequest', () => {
  it('returns the three required Kalshi headers', () => {
    const { publicKey, privateKey } = generateKeyPair();
    void publicKey;
    const headers = signKalshiRequest({
      keyId: 'my-key-id',
      privateKeyPem: privateKey,
      method: 'GET',
      path: '/trade-api/v2/markets',
      timestampMs: 1_700_000_000_000,
    });

    expect(headers['KALSHI-ACCESS-KEY']).toBe('my-key-id');
    expect(headers['KALSHI-ACCESS-TIMESTAMP']).toBe('1700000000000');
    expect(typeof headers['KALSHI-ACCESS-SIGNATURE']).toBe('string');
    expect(headers['KALSHI-ACCESS-SIGNATURE']!.length).toBeGreaterThan(0);
  });

  it('produces a signature that round-trips through crypto.verify with the public key', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const timestampMs = 1_700_000_123_456;
    const method = 'get';
    const path = '/trade-api/v2/markets/KXF1RACE-26MON-VER';

    const headers = signKalshiRequest({
      keyId: 'key-abc',
      privateKeyPem: privateKey,
      method,
      path,
      timestampMs,
    });

    const expectedMessage = buildKalshiSignatureMessage({ method, path, timestampMs });
    expect(expectedMessage).toBe(`${timestampMs}GET${path}`);

    const signatureBuf = Buffer.from(headers['KALSHI-ACCESS-SIGNATURE']!, 'base64');
    const isValid = crypto.verify(
      'sha256',
      Buffer.from(expectedMessage),
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      signatureBuf,
    );

    expect(isValid).toBe(true);
  });

  it('excludes the query string from the signed message/path', () => {
    const { publicKey, privateKey } = generateKeyPair();
    const timestampMs = 1_700_000_999_000;
    const method = 'GET';
    const pathWithQuery = '/trade-api/v2/markets?series_ticker=KXF1RACE&limit=50';
    const pathWithoutQuery = '/trade-api/v2/markets';

    const headers = signKalshiRequest({
      keyId: 'key-abc',
      privateKeyPem: privateKey,
      method,
      path: pathWithQuery,
      timestampMs,
    });

    // The signature must validate against the message built from the
    // query-stripped path, proving the query string was excluded.
    const messageWithoutQuery = buildKalshiSignatureMessage({
      method,
      path: pathWithoutQuery,
      timestampMs,
    });

    const signatureBuf = Buffer.from(headers['KALSHI-ACCESS-SIGNATURE']!, 'base64');
    const isValid = crypto.verify(
      'sha256',
      Buffer.from(messageWithoutQuery),
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      },
      signatureBuf,
    );

    expect(isValid).toBe(true);
    expect(buildKalshiSignatureMessage({ method, path: pathWithQuery, timestampMs })).toBe(
      messageWithoutQuery,
    );
  });
});
