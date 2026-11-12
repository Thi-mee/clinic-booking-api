export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function isAuthorized(request, expectedKey) {
  if (!expectedKey) return false;
  const suppliedKey = request.headers.get('X-API-Key') || '';
  const [suppliedHash, expectedHash] = await Promise.all([
    sha256(suppliedKey),
    sha256(expectedKey),
  ]);
  return suppliedHash === expectedHash;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function fingerprintBody(body) {
  return sha256(JSON.stringify(canonicalize(body)));
}
