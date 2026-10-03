/**
 * LANDING PHOTOGRAPHY MANIFEST.
 *
 * One place that knows every editorial image the public landing page uses: the
 * file, its intrinsic size, and the alt text. Nothing else in the landing layer
 * hard-codes a width, a height or a path, which is what makes an image
 * replaceable without hunting through components.
 *
 * Intrinsic dimensions are declared here so every `img` can carry width/height
 * and reserve its box before the bytes arrive. That is the whole layout-shift
 * budget for the page.
 *
 * Provenance and licence for every file is recorded beside the assets in
 * `public/assets/landing/PROVENANCE.md`.
 */

export interface LandingImage {
  readonly src: string;
  readonly width: number;
  readonly height: number;
  /**
   * Describes what is in the photograph, not what it means. These are scenes of
   * conversation; no image shows a Suggest Key mentor or seeker, and none is
   * captioned as one.
   */
  readonly alt: string;
}

/**
 * Hero. Shot at 85mm f/2.2, so the background falls away and the crop reads
 * cinematic rather than documentary. Loaded eagerly: it is the first viewport,
 * and it is what makes the page say "mentorship" before a word is read.
 */
export const HERO_IMAGE: LandingImage = {
  src: '/assets/landing/hero-conversation.jpg',
  width: 2000,
  height: 1334,
  alt: 'Two people in conversation over coffee at a table beside a window.',
};

/** Human-connection spread. */
export const CONNECTION_IMAGE: LandingImage = {
  src: '/assets/landing/connection-conversation.jpg',
  width: 1300,
  height: 866,
  alt: 'Two people talking through something difficult in a bright living room.',
};

/**
 * Mentorship-area cards.
 *
 * Selected by position, never by segment id: areas are database rows that can
 * be renamed, reordered or deactivated, and an image tied to a slug would break
 * the moment an admin reorders the catalogue. Assignment by index also gives the
 * lead card a deliberate crop rather than whatever happens to be first.
 *
 * Cards are decorative containers for a real action, so the first image is what
 * a screen reader announces for the lead card; the rest repeat that with a
 * per-area description, which is why the lead passes `alt=""` at the call site.
 */
export const AREA_IMAGES: readonly LandingImage[] = [
  {
    src: '/assets/landing/area-1.jpg',
    width: 1100,
    height: 734,
    alt: 'Two people talking across a table beside a large window.',
  },
  {
    src: '/assets/landing/area-2.jpg',
    width: 1100,
    height: 620,
    alt: 'Two colleagues working through a problem together at a desk.',
  },
  {
    src: '/assets/landing/area-3.jpg',
    width: 1100,
    height: 1650,
    alt: 'Two colleagues talking across a shared desk in a bright workspace.',
  },
  {
    src: '/assets/landing/area-4.jpg',
    width: 1100,
    height: 764,
    alt: 'A small group sharing notes around a table.',
  },
  {
    src: '/assets/landing/area-5.jpg',
    width: 1100,
    height: 734,
    alt: 'Two people talking across a cafe table.',
  },
];

/**
 * The image for the card at `index`, wrapping around the manifest. Wrapping
 * keeps a fifth, sixth or seventh area from rendering a bare card if the
 * catalogue ever grows past the photographs.
 */
export function areaImageAt(index: number): LandingImage {
  return AREA_IMAGES[index % AREA_IMAGES.length];
}