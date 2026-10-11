/**
 * File content validation using magic bytes (file signatures).
 *
 * This module provides trusted validation of actual file content against
 * expected types. It does not trust client-supplied MIME types or extensions.
 */

export type SupportedMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'application/pdf';

export type ValidationResult =
  | { ok: true; mimeType: SupportedMimeType }
  | { ok: false; reason: string };

/**
 * Magic byte signatures for supported file types.
 * Each entry contains the offset, expected bytes, and the corresponding MIME type.
 */
const MAGIC_SIGNATURES: ReadonlyArray<{
  mimeType: SupportedMimeType;
  offset: number;
  bytes: ReadonlyArray<number>;
  minLength: number;
}> = [
  {
    mimeType: 'image/png',
    offset: 0,
    bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
    minLength: 8,
  },
  {
    mimeType: 'image/jpeg',
    offset: 0,
    bytes: [0xFF, 0xD8, 0xFF],
    minLength: 3,
  },
  {
    mimeType: 'image/webp',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46],
    minLength: 12,
  },
  {
    mimeType: 'image/gif',
    offset: 0,
    bytes: [0x47, 0x49, 0x46, 0x38],
    minLength: 6,
  },
  {
    mimeType: 'application/pdf',
    offset: 0,
    bytes: [0x25, 0x50, 0x44, 0x46],
    minLength: 5,
  },
];

/**
 * Additional WebP validation: after the RIFF header, check for "WEBP" at offset 8.
 */
function validateWebP(buffer: Uint8Array): boolean {
  if (buffer.length < 12) return false;
  // Check for "WEBP" at offset 8
  return (
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50 // P
  );
}

/**
 * Additional GIF validation: check for "7a" or "9a" at offset 4 (GIF87a or GIF89a).
 */
function validateGIF(buffer: Uint8Array): boolean {
  if (buffer.length < 6) return false;
  const version = buffer[4];
  return version === 0x37 || version === 0x39; // '7' or '9'
}

/**
 * Validates a file buffer against its declared MIME type using magic bytes.
 *
 * @param buffer - The file content as Uint8Array (first 12 bytes minimum)
 * @param declaredMimeType - The MIME type declared by the client/upload flow
 * @returns ValidationResult indicating whether the content matches the declared type
 */
export function validateFileSignature(
  buffer: Uint8Array,
  declaredMimeType: string
): ValidationResult {
  if (!buffer || buffer.length === 0) {
    return { ok: false, reason: 'Empty file buffer' };
  }

  const normalizedDeclared = declaredMimeType.toLowerCase();

  // Find matching signature for the declared MIME type
  const signature = MAGIC_SIGNATURES.find((s) => s.mimeType === normalizedDeclared);
  if (!signature) {
    return { ok: false, reason: `Unsupported MIME type for validation: ${declaredMimeType}` };
  }

  if (buffer.length < signature.minLength) {
    return { ok: false, reason: `File too small for ${declaredMimeType} validation (need ${signature.minLength} bytes)` };
  }

  // Check magic bytes
  for (let i = 0; i < signature.bytes.length; i++) {
    if (buffer[signature.offset + i] !== signature.bytes[i]) {
      return {
        ok: false,
        reason: `Magic bytes mismatch for ${declaredMimeType}: expected ${signature.bytes
          .map((b) => b.toString(16).padStart(2, '0'))
          .join(' ')} at offset ${signature.offset}`,
      };
    }
  }

  // Additional format-specific checks
  if (normalizedDeclared === 'image/webp') {
    if (!validateWebP(buffer)) {
      return { ok: false, reason: 'Invalid WebP format: missing WEBP signature' };
    }
  }

  if (normalizedDeclared === 'image/gif') {
    if (!validateGIF(buffer)) {
      return { ok: false, reason: 'Invalid GIF format: not GIF87a or GIF89a' };
    }
  }

  return { ok: true, mimeType: signature.mimeType };
}

/**
 * Validates an image file can be decoded (basic structural validation).
 * This is a lightweight check - full decoding would require a proper image library.
 *
 * @param buffer - The file content as Uint8Array
 * @param mimeType - The validated MIME type
 * @returns true if the file appears structurally valid
 */
export function validateImageStructure(buffer: Uint8Array, mimeType: SupportedMimeType): boolean {
  switch (mimeType) {
    case 'image/png': {
      // PNG: Check IHDR chunk exists after signature (offset 8)
      if (buffer.length < 25) return false;
      // IHDR chunk type at offset 12-15
      return (
        buffer[12] === 0x49 && // I
        buffer[13] === 0x48 && // H
        buffer[14] === 0x44 && // D
        buffer[15] === 0x52 // R
      );
    }
    case 'image/jpeg': {
      // JPEG: Check for SOF marker (Start of Frame) after SOI
      // Look for 0xFF followed by 0xC0-0xCF (SOF markers)
      for (let i = 2; i < buffer.length - 1; i++) {
        if (buffer[i] === 0xFF && buffer[i + 1] >= 0xC0 && buffer[i + 1] <= 0xCF) {
          return true;
        }
      }
      return false;
    }
    case 'image/webp': {
      // WebP: Already validated by magic bytes + WEBP signature
      return validateWebP(buffer);
    }
    case 'image/gif': {
      // GIF: Already validated by magic bytes + version
      return validateGIF(buffer);
    }
    default:
      return false;
  }
}

/**
 * Validates a PDF file structure (basic check).
 *
 * @param buffer - The file content as Uint8Array
 * @returns true if the file appears to be a valid PDF
 */
export function validatePDFStructure(buffer: Uint8Array): boolean {
  // PDF: Check for %%EOF marker near the end (indicates complete file)
  // Also check for trailer dictionary
  const content = new TextDecoder('ascii', { fatal: false }).decode(buffer);
  return content.includes('%%EOF') && content.includes('trailer');
}

/**
 * Performs full validation of a file buffer against declared MIME type.
 * Includes signature validation and basic structural validation.
 *
 * @param buffer - The file content as Uint8Array
 * @param declaredMimeType - The MIME type declared by the client/upload flow
 * @returns ValidationResult with detailed outcome
 */
export function validateFileContent(
  buffer: Uint8Array,
  declaredMimeType: string
): ValidationResult {
  // First: signature validation
  const sigResult = validateFileSignature(buffer, declaredMimeType);
  if (!sigResult.ok) {
    return sigResult;
  }

  // Second: structural validation for images
  if (sigResult.mimeType.startsWith('image/')) {
    if (!validateImageStructure(buffer, sigResult.mimeType)) {
      return { ok: false, reason: `Invalid ${sigResult.mimeType} structure` };
    }
  }

  // Third: structural validation for PDF
  if (sigResult.mimeType === 'application/pdf') {
    if (!validatePDFStructure(buffer)) {
      return { ok: false, reason: 'Invalid PDF structure: missing EOF or trailer' };
    }
  }

  return sigResult;
}

/**
 * Fetches the first N bytes of a file from Supabase Storage for validation.
 * Uses a signed URL with a short TTL to download only the header.
 *
 * @param supabaseAdmin - Supabase admin client
 * @param bucket - Storage bucket name
 * @param path - Object path in the bucket
 * @param bytesToFetch - Number of bytes to fetch (default: 4096)
 * @returns Uint8Array of the file header, or null on failure
 */
export async function fetchFileHeader(
  supabaseAdmin: any,
  bucket: string,
  path: string,
  bytesToFetch: number = 4096
): Promise<Uint8Array | null> {
  try {
    // Create a signed URL for the file
    const { data: signedUrlData, error: signErr } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, 60); // 60 second TTL

    if (signErr || !signedUrlData?.signedUrl) {
      console.error('[FileValidation] Failed to create signed URL:', signErr?.message);
      return null;
    }

    // Fetch only the first N bytes using Range header
    const response = await fetch(signedUrlData.signedUrl, {
      method: 'GET',
      headers: {
        Range: `bytes=0-${bytesToFetch - 1}`,
      },
    });

    if (!response.ok) {
      console.error('[FileValidation] Failed to fetch file header:', response.status, response.statusText);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (err) {
    console.error('[FileValidation] Exception fetching file header:', err);
    return null;
  }
}

/**
 * Validates a file in Supabase Storage by fetching its header and checking content.
 *
 * @param supabaseAdmin - Supabase admin client
 * @param bucket - Storage bucket name
 * @param path - Object path in the bucket
 * @param expectedMimeType - The MIME type that was declared during upload
 * @returns ValidationResult
 */
export async function validateStoredFile(
  supabaseAdmin: any,
  bucket: string,
  path: string,
  expectedMimeType: string
): Promise<ValidationResult> {
  const header = await fetchFileHeader(supabaseAdmin, bucket, path);
  if (!header) {
    return { ok: false, reason: 'Failed to fetch file header for validation' };
  }

  return validateFileContent(header, expectedMimeType);
}

export const ALLOWED_MIME_TYPES_BY_BUCKET: Record<string, readonly SupportedMimeType[]> = {
  'avatars': ['image/jpeg', 'image/png', 'image/webp'],
  'segment-hero': ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  'payment-qr': ['image/png', 'image/jpeg', 'image/webp'],
  'payment-proofs': ['image/jpeg', 'image/png', 'image/webp'],
  'mentor-verification-documents': ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  'support-attachments': ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
  'profile-photos': ['image/jpeg', 'image/png', 'image/webp'],
} as const;