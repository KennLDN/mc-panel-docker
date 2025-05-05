export interface TextColorObject {
  text: string;
  color: string;
}

/**
 * Converts a JSON string representing an array of [text, color] pairs 
 * into an array of objects with { text, color } properties.
 * 
 * @param inputJsonString - A JSON string in the format: "[[\"text1\", \"#color1\"], [\"text2\", \"#color2\"], ...]"
 * @returns An array of TextColorObject.
 * @throws Error if the input string is not valid JSON or doesn't match the expected format.
 */
export function convertTextAndColorFormat(inputJsonString: string): TextColorObject[] {
  let parsedInput: unknown;

  try {
    parsedInput = JSON.parse(inputJsonString);
  } catch (error) {
    throw new Error(`Invalid JSON string provided: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsedInput)) {
    throw new Error('Parsed JSON is not an array.');
  }

  return parsedInput.map((item, index) => {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || typeof item[1] !== 'string') {
      throw new Error(`Invalid item format at index ${index}. Expected [string, string], got ${JSON.stringify(item)}.`);
    }
    return {
      text: item[0],
      color: item[1],
    };
  });
}

// Example Usage (can be removed or commented out)
/*
const input = '[[\"[d]\", \"#aa00ff\"], [\"<[username]> [message]\", \"#ffffff\"]]';
try {
  const output = convertTextAndColorFormat(input);
  console.log(output);
  // Expected output:
  // [
  //   { text: '[d]', color: '#aa00ff' },
  //   { text: '<[username]> [message]', color: '#ffffff' }
  // ]
} catch (error) {
  console.error(\"Conversion failed:\", error);
}
*/ 