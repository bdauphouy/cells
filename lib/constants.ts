// Shared between the server (card resolution) and the client (the carousel
// mesh count) so the two can never drift apart. The spiral loops the
// library round to reach this many cards; beyond it, cards just keep
// growing one-per-video instead of ever being capped.
export const MIN_CARDS = 18;
