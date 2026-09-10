// Narrow validator for the checked-in closed schema vocabulary; no external refs,
// coercion, defaults, schema downloads, or claim to implement all JSON Schema.
import assert from 'node:assert/strict';

export function validateSchema(value, schema) {
  const supported = new Set(['$schema', 'title', 'type', 'additionalProperties', 'required', 'properties', 'const', 'enum', 'pattern', 'maxItems', 'items', 'oneOf']);
  for (const key of Object.keys(schema)) assert(supported.has(key), 'Unsupported schema keyword');
  if (schema.oneOf) {
    let matches = 0;
    for (const variant of schema.oneOf) {
      try { validateSchema(value, variant); matches++; } catch { /* deliberately test each closed branch */ }
    }
    assert.equal(matches, 1, 'Expected one closed schema branch');
    return;
  }
  if ('const' in schema) assert.deepEqual(value, schema.const, 'Invalid constant');
  if (schema.enum) assert(schema.enum.includes(value), 'Invalid closed enum');
  if (schema.type === 'object') {
    assert(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, 'Expected object');
    assert.equal(schema.additionalProperties, false, 'Objects must be closed');
    for (const key of schema.required) assert(Object.hasOwn(value, key), 'Missing required key');
    for (const key of Object.keys(value)) {
      assert(Object.hasOwn(schema.properties, key), 'Unexpected object key');
      validateSchema(value[key], schema.properties[key]);
    }
  } else if (schema.type === 'array') {
    assert(Array.isArray(value), 'Expected array');
    assert(value.length <= schema.maxItems, 'Too many items');
    for (const item of value) validateSchema(item, schema.items);
  } else if (schema.type === 'string') {
    assert.equal(typeof value, 'string', 'Expected string');
    assert(new RegExp(schema.pattern).test(value), 'Invalid symbolic identifier');
  } else if (schema.type !== undefined) throw new Error('Unsupported schema type');
}
