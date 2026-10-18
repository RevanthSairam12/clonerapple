// Gallery data for the homepage services carousel.
//
// De-brand pass: this file was generated from a captured apple.com page. Every
// item the capture carried was an Apple-owned destination (tv / music / apps /
// fitness.apple.com) with Apple's own show and artist artwork. No Gadzio
// equivalent exists, so the arrays are empty on purpose rather than filled with
// invented content. The types and GALLERY_META timing values are unchanged.

import type { PictureData } from './tiles';

export interface GalleryItem {
  id: string;
  index: number;
  href: string;
  ariaLabel: string;
  buttonLabel: string;
  genre: string | null;
  caption: string;
  logo: string | null;
  musicLayout: boolean;
  bgColor: string | null;
  background: PictureData | null;
  atvLogo: PictureData | null;
  showLogo: PictureData | null;
}

export const GALLERY_META = {
  "headline": null,
  "itemDurationMs": 4160,
  "slideDurationMs": 650,
  "visibleDots": 7,
  "pauseLabel": "Pause endless entertainment gallery",
  "playLabel": "Play endless entertainment gallery"
};

/**
 * Gallery items — intentionally EMPTY.
 *
 * Every captured item pointed at an Apple-owned service and shipped Apple
 * artwork and wordmarks. Gadzio carries no equivalent service, so nothing is
 * substituted here. The gallery's structure, types and renderer are untouched;
 * only the data is emptied.
 *
 * The section stays hidden unless the `apple.gallery` CMS row sets
 * `enabled: true`, and enabling it while these arrays are empty renders
 * nothing at all (see the empty guard in EndlessEntertainmentGallery). Saving
 * Gadzio items into that row is the supported way to bring the section back.
 */
export const TV_GALLERY_ITEMS: GalleryItem[] = [];

/** Second-row services items — empty for the same reason as above. */
export const FAM_GALLERY_ITEMS: GalleryItem[] = [];
