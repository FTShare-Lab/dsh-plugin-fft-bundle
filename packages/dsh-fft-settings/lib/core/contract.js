/** Protocol version of the settings route and envelope. */
export const FTSHARE_SETTINGS_API_VERSION = 1;
/**
 * Identity of the settings section that carries this plugin's cards.
 *
 * The id replaces the old `ftshare`. The label is a neutral product name, not
 * the internal brand: the page ships publicly, and the data source it
 * integrates is named inside the cards instead.
 */
export const FTSHARE_SETTINGS_SECTION = { id: 'dsh-fft', order: 120, label: '金融终端' };
/**
 * Child slot of {@link FTSHARE_SETTINGS_SECTION} that carries its cards.
 *
 * The section declares the slot when it registers; every card — ours and a
 * third party's — contributes through it with `id`/`order`/`label`, and
 * `order` (ascending, default 100) decides the card's position.
 */
export const FTSHARE_SETTINGS_CARD_SLOT = 'ftshare.settings.card';
/**
 * Browser-facing route for this plugin's settings calls.
 *
 * It sits below `/api` so the shared connection carrier applies the Host/Origin
 * fence and browser authentication before dispatch; this plugin only handles
 * the call itself.
 */
export const FTSHARE_SETTINGS_ROUTE = '/api/ftshare-settings';
/** Largest request body accepted on {@link FTSHARE_SETTINGS_ROUTE}. */
export const FTSHARE_SETTINGS_MAX_BODY_BYTES = 64 * 1024;
