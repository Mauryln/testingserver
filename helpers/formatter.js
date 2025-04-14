/**
 * Format a phone number to be compatible with WhatsApp API
 * @param {string} number - Phone number to format
 * @returns {string} - Formatted phone number with @c.us suffix
 */
const phoneNumberFormatter = (number) => {
    // 1. Remove any non-numeric characters except the plus sign
    let formatted = number.replace(/[^\d+]/g, "")
  
    // 2. Remove any leading zeros
    while (formatted.startsWith("0")) {
      formatted = formatted.substring(1)
    }
  
    // 3. Ensure it has a plus sign at the beginning if not already
    if (!formatted.startsWith("+")) {
      formatted = "+" + formatted
    }
  
    // 4. Add the WhatsApp suffix
    if (!formatted.endsWith("@c.us")) {
      formatted = formatted + "@c.us"
    }
  
    return formatted
  }
  
  /**
   * Extract the phone number from a WhatsApp ID
   * @param {string} id - WhatsApp ID (e.g., "1234567890@c.us")
   * @returns {string} - Phone number with plus sign
   */
  const extractPhoneNumber = (id) => {
    // Remove the @c.us suffix
    let number = id.replace("@c.us", "")
  
    // Ensure it has a plus sign
    if (!number.startsWith("+")) {
      number = "+" + number
    }
  
    return number
  }
  
  /**
   * Format a list of phone numbers
   * @param {Array<string>} numbers - Array of phone numbers
   * @returns {Array<string>} - Array of formatted phone numbers
   */
  const formatPhoneNumbers = (numbers) => {
    return numbers.map((number) => phoneNumberFormatter(number))
  }
  
  module.exports = {
    phoneNumberFormatter,
    extractPhoneNumber,
    formatPhoneNumbers,
  }
  