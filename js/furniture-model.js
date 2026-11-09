/* Minimal stub. ProjectModel only calls validate when a furniture item carries an AI model. */
(function (root) {
  'use strict';
  function validate(model) { return model; }
  const api = { validate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FurnitureModel = api;
})(globalThis);
