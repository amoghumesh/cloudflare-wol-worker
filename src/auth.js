export function configuredTokens(env) {
  return [env.USER_TOKEN, env.DEVICE_TOKEN].every(token =>
    typeof token === "string" && token.length >= 32 && token.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(token) && !token.startsWith("replace_")) &&
    env.USER_TOKEN !== env.DEVICE_TOKEN;
}

export async function authorized(header, token) {
  if (typeof header !== "string" || !header.startsWith("Bearer ") || header.length > 263) {
    return false;
  }
  // Compare fixed-length hashes so a matching token prefix does not leak timing.
  const encoder = new TextEncoder();
  const hashes = await Promise.all([header.slice(7), token].map(value =>
    crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(hashes[0]);
  const right = new Uint8Array(hashes[1]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
