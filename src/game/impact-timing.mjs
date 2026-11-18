/** Simultaneous contacts share one held pose, including mirrored trades and area attacks. */
export function impactHoldFrames(events, frameTable = {}) {
  let longest = 0;
  for (const event of events) {
    if (event.type === 'hit' || event.type === 'parry') {
      longest = Math.max(longest, frameTable[event.impact] ?? 0);
    }
  }
  return longest;
}
