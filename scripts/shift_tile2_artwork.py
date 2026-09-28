"""
Shift the Tile 2 (12_Untitled) product artwork down so that the
headline, subhead, and CTA buttons ("Learn more", "Shop iPhone")
sit cleanly in the empty space above the products without overlapping them.

Sources are in public/sites.original-backup/www-apple-com-736d3707/root-8a5edab2/images/tiles/
Outputs are written to public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/
"""

import os
from PIL import Image

BACKUP_DIR = "public/sites.original-backup/www-apple-com-736d3707/root-8a5edab2/images/tiles"
LIVE_DIR = "public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles"

# (filename, shift_y_pixels)
VARIANTS = [
    # Small (734 x 500)
    ("12_Untitled (2136 x 1140 px) (3).jpg", 55),
    # Small 2x (1468 x 1000)
    ("12_Untitled (2136 x 1140 px) (6).jpg", 110),
    
    # Medium standard (1068 x 570)
    ("12_Untitled (2136 x 1140 px) (2).jpg", 65),
    # Medium standard 2x (2136 x 1140)
    ("12_Untitled (2136 x 1140 px) (1).jpg", 130),
    
    # Medium tall & 2x (2136 x 1300)
    ("12_Untitled (2136 x 1140 px) (8).jpg", 130),
    
    # Large standard (3008 x 580)
    ("12_Untitled (2136 x 1140 px) (5).jpg", 65),
    # Large standard 2x (6016 x 1160)
    ("12_Untitled (2136 x 1140 px) (7).jpg", 130),
    
    # Large tall (3008 x 692)
    ("12_Untitled (2136 x 1140 px) (4).jpg", 70),
    # Large tall 2x (6016 x 1384)
    ("12_Untitled (2136 x 1140 px) (9).jpg", 140),
]

def shift_with_marble_extension(img: Image.Image, shift_y: int) -> Image.Image:
    w, h = img.size
    shifted = Image.new("RGB", (w, h))
    
    # Take the top slice and mirror it vertically so row 0 connects seamlessly
    top_slice = img.crop((0, 0, w, shift_y))
    flipped_top = top_slice.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    
    # Paste flipped marble at the top
    shifted.paste(flipped_top, (0, 0))
    # Paste the original image shifted down by shift_y
    shifted.paste(img.crop((0, 0, w, h - shift_y)), (0, shift_y))
    
    return shifted

def main():
    for filename, shift in VARIANTS:
        src_path = os.path.join(BACKUP_DIR, filename)
        if not os.path.exists(src_path):
            print(f"Skipping missing: {src_path}")
            continue
            
        with Image.open(src_path) as im:
            im = im.convert("RGB")
            result = shift_with_marble_extension(im, shift)
            dest_path = os.path.join(LIVE_DIR, filename)
            result.save(dest_path, "JPEG", quality=95, optimize=True)
            print(f"Shifted & saved: {filename} ({im.size[0]}x{im.size[1]}) down {shift}px")

if __name__ == "__main__":
    main()
