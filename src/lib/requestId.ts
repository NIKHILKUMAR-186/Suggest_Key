import { randomBytes } from 'crypto';

let counter = 0;
const prefix = 'req_';

export function generateRequestId(): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(4).toString('hex');
  counter = (counter + 1) % 1000;
  return `${prefix}${time}${counter.toString(36).padStart(2, '0')}${rand}`;
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^req_[a-z0-9]{10,40}$/.test(value);
}