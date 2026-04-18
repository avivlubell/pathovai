import Image from 'next/image';

type Props = {
  size?: number;
  // The original brand delivered a single raster asset, so 'color' is
  // currently the only rendered variant. 'mono' is accepted as a forward-
  // compatible prop but renders the same file until a vector / mono
  // asset is provided by design. Do not swap this for a CSS filter --
  // filters on the color mark produce muddy output.
  variant?: 'color' | 'mono';
  priority?: boolean;
  className?: string;
  alt?: string;
};

// Single source of truth for rendering the PathovAI mark. Always renders
// into a square box at the requested size and relies on next/image to
// serve the right pixel density. `object-contain` ensures a non-square
// future asset can't be silently stretched.
export default function Logo({
  size = 32,
  variant = 'color',
  priority = false,
  className,
  alt = 'PathovAI',
}: Props) {
  void variant;
  return (
    <Image
      src="/logo/pathovai-mark-512.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={`rounded object-contain ${className ?? ''}`.trim()}
    />
  );
}
