import crypto from 'node:crypto';

function configuration() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

  if (!cloudName || !apiKey || !apiSecret) return null;
  return {
    cloudName,
    apiKey,
    apiSecret,
    folder: process.env.CLOUDINARY_FOLDER?.trim().replace(/^\/+|\/+$/g, '') || 'wander-wheels',
  };
}

function signature(parameters, apiSecret) {
  const payload = Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join('&');

  return crypto.createHash('sha1').update(`${payload}${apiSecret}`).digest('hex');
}

async function postCloudinary(resourceType, action, parameters, config, file) {
  const signedParameters = { ...parameters };
  const form = new FormData();
  form.set('api_key', config.apiKey);
  form.set('timestamp', String(signedParameters.timestamp));
  form.set('signature', signature(signedParameters, config.apiSecret));

  for (const [key, value] of Object.entries(signedParameters)) {
    if (key !== 'timestamp') form.set(key, String(value));
  }
  if (file) {
    form.set('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  }

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/${action}`,
    { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error?.message || `Cloudinary request failed (${response.status}).`);
  }
  return result;
}

export function isCloudinaryConfigured() {
  return configuration() !== null;
}

export async function uploadToCloudinary(file) {
  const config = configuration();
  if (!config) throw new Error('Cloudinary is not configured.');

  const resourceType = file.mimetype.startsWith('video/') ? 'video' : 'image';
  const parameters = {
    folder: config.folder,
    public_id: crypto.randomUUID(),
    timestamp: Math.floor(Date.now() / 1000),
  };
  const result = await postCloudinary(resourceType, 'upload', parameters, config, file);

  if (!result?.public_id || !result?.secure_url) {
    throw new Error('Cloudinary upload response did not include an asset ID and secure URL.');
  }

  return {
    storageKey: result.public_id,
    publicUrl: result.secure_url,
    sizeBytes: Number.isSafeInteger(result.bytes) ? result.bytes : file.size,
  };
}

export async function deleteFromCloudinary(storageKey, kind) {
  const config = configuration();
  if (!config) throw new Error('Cloudinary is not configured.');

  const resourceType = kind === 'VIDEO' ? 'video' : 'image';
  const result = await postCloudinary(
    resourceType,
    'destroy',
    { public_id: storageKey, timestamp: Math.floor(Date.now() / 1000) },
    config,
  );

  if (result?.result !== 'ok' && result?.result !== 'not found') {
    throw new Error('Cloudinary did not confirm asset deletion.');
  }
}
