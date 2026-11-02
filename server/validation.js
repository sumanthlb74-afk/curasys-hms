export function isOptionalString(value, maxLength) {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

export function isOptionalPhone(value) {
  return isOptionalString(value, 30);
}

export function isOptionalAddress(value) {
  return isOptionalString(value, 500);
}
