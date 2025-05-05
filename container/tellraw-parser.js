/**
 * Parses Minecraft tellraw JSON data into a plain text string.
 *
 * @param {string | object | Array} tellrawInput - The tellraw data, either as a JSON string,
 *                                                  a single object, or an array of objects.
 * @returns {string} The plain text representation. Returns an empty string if input is invalid or empty.
 */
function parseTellraw(tellrawInput) {
  let data;

  // 1. Ensure input is a parsed object/array
  if (typeof tellrawInput === 'string') {
    try {
      data = JSON.parse(tellrawInput);
    } catch (error) {
      console.error('Error parsing tellraw JSON string:', error);
      return ''; // Return empty string on parse error
    }
  } else if (typeof tellrawInput === 'object' && tellrawInput !== null) {
    data = tellrawInput;
  } else {
    console.error('Invalid tellraw input type:', typeof tellrawInput);
    return ''; // Return empty string for invalid types
  }

  // 2. Process the data to extract text
  let plainText = '';

  if (Array.isArray(data)) {
    // Handle array of objects
    plainText = data
      .map(item => (typeof item === 'object' && item !== null && item.text) ? item.text : '')
      .join('');
  } else if (typeof data === 'object' && data !== null && data.text) {
    // Handle single object
    plainText = data.text;
    // Optionally handle 'extra' property recursively if needed
    if (Array.isArray(data.extra)) {
         plainText += parseTellraw(data.extra); // Recursive call for nested 'extra'
    }
  }
  // Add more conditions here if tellraw structure can be more complex (e.g., just a string)

  return plainText;
}

module.exports = {
  parseTellraw,
}; 