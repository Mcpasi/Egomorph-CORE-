(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EgoAgentResponse = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var THOUGHT_TAG = 'egomorph_thought';
  var FINAL_TAG = 'egomorph_final';
  var INTERNAL_REFERENCE = '[interner Dateiverweis ausgeblendet]';

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function sanitize(text, protectedPaths) {
    var value = String(text == null ? '' : text);
    var paths = Array.isArray(protectedPaths) ? protectedPaths : [];
    for (var i = 0; i < paths.length; i++) {
      var path = String(paths[i] || '').trim();
      if (!path) continue;
      value = value.replace(new RegExp(escapeRegex(path), 'gi'), INTERNAL_REFERENCE);
    }
    value = value
      .replace(/(?:[a-z]:[\\/]|\/)?(?:[^\s"'<>]+[\\/])*EgomorphCore[\\/]model-home(?:[\\/][^\s"'<>]*)?/gi, INTERNAL_REFERENCE)
      .replace(/\bmemory\.md\b/gi, INTERNAL_REFERENCE)
      .replace(/\b(?:Egomorph Core Modell-Home-Kontext|Persistenter Egomorph-Core-Nutzerkontext|Inhalt von memory\.md)\s*:?/gi, INTERNAL_REFERENCE);
    return value.replace(/(?:\[interner Dateiverweis ausgeblendet\]\s*){2,}/g, INTERNAL_REFERENCE + ' ').trim();
  }

  function taggedValue(text, tag) {
    var match = String(text || '').match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
    return match ? match[1].trim() : '';
  }

  function stripIncompleteTag(text) {
    return String(text || '').replace(/<[^>]*$/, '');
  }

  function parse(rawReply, options) {
    var opts = options || {};
    var raw = String(rawReply == null ? '' : rawReply).trim();
    var thought = taggedValue(raw, THOUGHT_TAG);
    var finalReply = taggedValue(raw, FINAL_TAG);
    if (!finalReply) finalReply = raw;
    if (!thought) thought = String(opts.fallbackThought || '').trim();
    return {
      thought: sanitize(thought, opts.protectedPaths),
      reply: sanitize(finalReply, opts.protectedPaths),
      skills: Array.isArray(opts.skills)
        ? opts.skills.map(function (skill) { return String(skill || '').trim(); }).filter(Boolean)
        : []
    };
  }

  function parseLive(rawReply, options) {
    var opts = options || {};
    var raw = String(rawReply == null ? '' : rawReply);
    var thoughtOpen = raw.toLowerCase().indexOf('<' + THOUGHT_TAG + '>');
    var thoughtClose = raw.toLowerCase().indexOf('</' + THOUGHT_TAG + '>');
    var finalOpen = raw.toLowerCase().indexOf('<' + FINAL_TAG + '>');
    var finalClose = raw.toLowerCase().indexOf('</' + FINAL_TAG + '>');
    var thought = '';
    var finalReply = '';

    if (thoughtOpen !== -1) {
      var thoughtStart = thoughtOpen + THOUGHT_TAG.length + 2;
      thought = stripIncompleteTag(raw.slice(thoughtStart, thoughtClose === -1 ? raw.length : thoughtClose));
    }
    if (finalOpen !== -1) {
      var finalStart = finalOpen + FINAL_TAG.length + 2;
      finalReply = stripIncompleteTag(raw.slice(finalStart, finalClose === -1 ? raw.length : finalClose));
    } else if (thoughtOpen === -1 && raw.indexOf('<') !== 0) {
      finalReply = raw;
    }

    return {
      thought: sanitize(thought || opts.fallbackThought || '', opts.protectedPaths),
      reply: sanitize(finalReply, opts.protectedPaths)
    };
  }

  return {
    THOUGHT_TAG: THOUGHT_TAG,
    FINAL_TAG: FINAL_TAG,
    INTERNAL_REFERENCE: INTERNAL_REFERENCE,
    parse: parse,
    parseLive: parseLive,
    sanitize: sanitize
  };
});
