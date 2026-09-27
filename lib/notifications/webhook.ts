import crypto from 'crypto';

export interface WebhookVerificationOptions {
  secret: string;
  maxWindowMs?: number;
}

export interface WebhookVerificationResult {
  valid: boolean;
  error?: string;
  code?: 'MISSING_SIGNATURE' | 'MISSING_TIMESTAMP' | 'INVALID_TIMESTAMP' | 'STALE_TIMESTAMP' | 'DUPLICATE_EVENT' | 'INVALID_SIGNATURE' | 'INVALID_SIGNATURE_FORMAT';
}

const processedEventIds = new Set<string>();

export function verifyWebhook(
  payload: string,
  headers: Headers | { [key: string]: string | null | undefined },
  options: WebhookVerificationOptions
): WebhookVerificationResult {
  const getHeader = (name: string) => 
    typeof (headers as Headers).get === 'function' ? (headers as Headers).get(name) : (headers as any)[name];

  const signature = getHeader('x-webhook-signature');
  const timestampStr = getHeader('x-webhook-timestamp');
  const eventId = getHeader('x-webhook-event-id');

  if (!signature) return { valid: false, error: 'Missing signature', code: 'MISSING_SIGNATURE' };
  if (!timestampStr) return { valid: false, error: 'Missing timestamp', code: 'MISSING_TIMESTAMP' };
  
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return { valid: false, error: 'Invalid timestamp', code: 'INVALID_TIMESTAMP' };

  const now = Date.now();
  const maxWindow = options.maxWindowMs || 5 * 60 * 1000; // 5 minutes default

  if (Math.abs(now - timestamp) > maxWindow) {
    return { valid: false, error: 'Webhook timestamp is outside the allowed window', code: 'STALE_TIMESTAMP' };
  }

  if (eventId) {
    if (processedEventIds.has(eventId)) {
      return { valid: false, error: 'Duplicate webhook event', code: 'DUPLICATE_EVENT' };
    }
  }

  try {
    const expectedMac = crypto
      .createHmac('sha256', options.secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedMac, 'hex');
    const signatureBuffer = Buffer.from(signature, 'hex');

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      return { valid: false, error: 'Invalid signature', code: 'INVALID_SIGNATURE' };
    }
  } catch (err) {
    return { valid: false, error: 'Signature verification failed', code: 'INVALID_SIGNATURE_FORMAT' };
  }

  if (eventId) {
    processedEventIds.add(eventId);
    // basic cleanup to prevent memory leak
    if (processedEventIds.size > 10000) {
      const iter = processedEventIds.values();
      for (let i = 0; i < 1000; i++) {
        processedEventIds.delete(iter.next().value as string);
      }
    }
  }

  return { valid: true };
}

/** Test helper to reset state */
export function __resetProcessedWebhooks() {
  processedEventIds.clear();
}
