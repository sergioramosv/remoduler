/**
 * Valida que un objeto tenga los campos requeridos.
 * Ligero — sin dependencia de Zod para mantener el core simple.
 */
export function validateResponse(data, requiredFields) {
  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  const errors = [];
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
