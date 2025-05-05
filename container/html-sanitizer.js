/**
 * Basic HTML sanitizer to prevent cross-site scripting (XSS) issues
 * by replacing < and > characters with their HTML entities.
 *
 * @param {string} text - The input string.
 * @returns {string} The sanitized string.
 */
function sanitizeHtml(text) {
  if (typeof text !== 'string') {
    return ''; // Return empty for non-string input
  }
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = {
  sanitizeHtml,
}; 