/**
 * Gadzio's WhatsApp order line.
 *
 * The number lives here and nowhere else, so changing it in one place updates
 * every link and label that points at it (the /android store page today).
 */

/** wa.me form — country code + number, digits only, no leading "+". */
export const WHATSAPP_NUMBER = '916304859367';

/** Readable form of the same number, for display and screen readers. */
export const WHATSAPP_DISPLAY = `+${WHATSAPP_NUMBER.slice(0, 2)} ${WHATSAPP_NUMBER.slice(2, 7)} ${WHATSAPP_NUMBER.slice(7)}`;

/** Pre-encoded so the prefilled message is byte-identical in every client. */
const ORDER_MESSAGE =
  'Hi%20Gadzio%2C%20I%27d%20like%20to%20order%20an%20Android%20accessory';

/** Opens a WhatsApp chat with the Android-accessory order message prefilled. */
export const WHATSAPP_ORDER_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${ORDER_MESSAGE}`;
