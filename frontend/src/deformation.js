// Drawing coordinates only. Simulation frames and reported areas stay unscaled.
export function displayRadii(referenceRadii, radii, scale) {
  if (scale === 1) return radii;
  return radii.map((radius, i) => referenceRadii[i] + scale * (radius - referenceRadii[i]));
}

export function deformationScale(referenceRadii, frames = []) {
  // Use one factor for the whole run, so playback never changes visual scale.
  // Large physical contractions need less amplification to keep the lumen
  // readable and every displayed layer open and correctly ordered.
  return [10, 5, 2].find(scale => frames.every(frame => {
    const radii = displayRadii(referenceRadii, frame.radii, scale);
    return radii[0] >= .5 * referenceRadii[0]
      && radii.slice(1).every((radius, i) => radius - radii[i] >= .1 * (referenceRadii[i + 1] - referenceRadii[i]));
  })) || 1;
}
