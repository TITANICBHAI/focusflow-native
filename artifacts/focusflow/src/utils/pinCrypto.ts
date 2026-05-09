/**
 * pinCrypto.ts
 *
 * Password hashing (SHA-256) and random password generation utilities for
 * FocusFlow's two-PIN protection system:
 *
 *   Focus Session Password — gates ending any active focus session (native layer)
 *   Defense Password       — gates disabling protections and removing restrictions (JS layer)
 *
 * The raw password is NEVER stored anywhere. Only the SHA-256 hex digest is persisted.
 * Web Crypto API (crypto.subtle) is available natively in React Native 0.73+ / Hermes.
 */

/**
 * Returns the SHA-256 hex digest of a UTF-8 password string.
 */
export async function hashPassword(password: string): Promise<string> {
  const buffer = new TextEncoder().encode(password);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Character set for random passwords — visually ambiguous chars excluded:
 * 0, O, I, l, 1 → reduces transcription errors when writing down.
 */
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!$';

/**
 * Generates a cryptographically random password using crypto.getRandomValues.
 * Default length: 16 characters.
 */
export function generateRandomPassword(length = 16): string {
  try {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => CHARSET[b % CHARSET.length])
      .join('');
  } catch {
    return Array.from({ length }, () =>
      CHARSET[Math.floor(Math.random() * CHARSET.length)],
    ).join('');
  }
}

export type StrengthLevel = 'too-short' | 'weak' | 'fair' | 'strong' | 'very-strong';

export interface PasswordStrength {
  level: StrengthLevel;
  label: string;
  color: string;
  barWidth: number;
  valid: boolean;
}

/**
 * Evaluates password strength. Minimum 8 characters required.
 */
export function getPasswordStrength(password: string): PasswordStrength {
  if (password.length === 0) {
    return { level: 'too-short', label: '', color: '#e5e7eb', barWidth: 0, valid: false };
  }
  if (password.length < 8) {
    return {
      level: 'too-short',
      label: `${password.length}/8 characters minimum`,
      color: '#ef4444',
      barWidth: 15,
      valid: false,
    };
  }
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const variety = [hasUpper, hasLower, hasDigit, hasSpecial].filter(Boolean).length;

  if (password.length >= 16 && variety >= 3) {
    return { level: 'very-strong', label: 'Very strong', color: '#10b981', barWidth: 100, valid: true };
  }
  if (password.length >= 12 && variety >= 2) {
    return { level: 'strong', label: 'Strong', color: '#22c55e', barWidth: 75, valid: true };
  }
  if (password.length >= 8 && variety >= 2) {
    return { level: 'fair', label: 'Fair — try adding symbols or numbers', color: '#f59e0b', barWidth: 50, valid: true };
  }
  return { level: 'weak', label: 'Weak — mix uppercase, lowercase, numbers & symbols', color: '#f97316', barWidth: 30, valid: true };
}

/** Common trivially-guessable passwords to block. */
export const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'qwerty123', 'qwerty',
  'abc123def', 'iloveyou1', 'admin1234', 'letmein1', 'welcome1',
  '12345678', '123456789', '1234567890', '11111111', '00000000',
  'aaaaaaaa', 'bbbbbbbb', 'zxcvbnm1', 'focusflow', 'focusflow1',
]);
