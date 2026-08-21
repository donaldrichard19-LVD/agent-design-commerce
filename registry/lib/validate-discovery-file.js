// Shared between crawler.js (scheduled polling) and server.js (self-serve
// domain submission) so both validate against the exact same schema/rules.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'protocol', 'schema', 'agent-commerce.schema.json');

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const validate = ajv.compile(schema);

function validateDiscoveryFile(doc) {
  const valid = validate(doc);
  return {
    valid,
    errors: valid ? [] : ajv.errorsText(validate.errors, { separator: '; ' }),
  };
}

module.exports = { validateDiscoveryFile };
