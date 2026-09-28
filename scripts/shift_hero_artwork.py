"""
Shift the Back to School hero collage artwork down so that the
headline, subhead, and "Verify Eligibility" CTA button do not overlap
the student figures.

Sources are the original master Untitled files in public/sites.original-backup/.
Output files are hero_back_to_school_2026__cz07tzsg14sy_*.jpg in both public/sites/
and public/sites.original-backup/.
"""

import os
from PIL import Image

BACKUP_DIR = 'public/sites.original-backup/www-apple-com-736d3707/root-8a5edab2/images/tiles'
LIVE_DIR = 'public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles'

# (target_name, width, height, source_untitled, shift_down_pixels)
VARIANTS = [
    ('hero_back_to_school_2026__cz07tzsg14sy_small.jpg', 734, 500, '6_Untitled (734 x 500 px).jpg', 55),
    ('hero_back_to_school_2026__cz07tzsg14sy_small_2x.jpg', 1468, 1000, '3_Untitled (1468 x 1000 px).jpg', 110),
    ('hero_back_to_school_2026__cz07tzsg14sy_medium.jpg', 1068, 570, '1_Untitled (1068 x 570 px).jpg', 65),
    ('hero_back_to_school_2026__cz07tzsg14sy_medium_2x.jpg', 2136, 1140, '9_Untitled (2136 x 1140 px).jpg', 130),
    ('hero_back_to_school_2026__cz07tzsg14sy_mediumtall_2x.jpg', 2136, 1300, '7_Untitled (2136 x 1300 px).jpg', 140),
    ('hero_back_to_school_2026__cz07tzsg14sy_large.jpg', 3008, 580, '8_Untitled (3008 x 580 px).jpg', 70),
    ('hero_back_to_school_2026__cz07tzsg14sy_large_2x.jpg', 6016, 1160, '5_Untitled (6016 x 1160 px).jpg', 140),
    ('hero_back_to_school_2026__cz07tzsg14sy_largetall.jpg', 3008, 692, '2_Untitled (3008 x 692 px).jpg', 70),
    ('hero_back_to_school_2026__cz07tzsg14sy_largetall_2x.jpg', 6016, 1384, '4_Untitled (6016 x 1384 px).jpg', 140),
]

def shift_image(source_img: Image.Image, target_w: int, target_h: int, shift_y: int) -> Image.Image:
    # Ensure source matches target dimension
    if source_img.size != (target_w, target_h):
        source_img = source_img.resize((target_w, target_h), Image.Resampling.LANCZOS)
    
    # Create canvas with pure white background
    canvas = Image.new('RGB', (target_w, target_h), (255, 255, 255))
    canvas.paste(source_img, (0, shift_y))
    return canvas

def main():
    os.makedirs(LIVE_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)

    generated = {}
    for target_name, tw, th, src_name, shift in VARIANTS:
        src_path = os.path.join(BACKUP_DIR, src_name)
        if not os.path.exists(src_path):
            raise FileNotFoundError(f"Source file not found: {src_path}")
        
        with Image.open(src_path) as im:
            shifted = shift_image(im, tw, th, shift)
            generated[target_name] = shifted

            # Save to live and backup
            for dest_dir in [LIVE_DIR, BACKUP_DIR]:
                dest_path = os.path.join(dest_dir, target_name)
                shifted.save(dest_path, 'JPEG', quality=95, optimize=True)
            print(f"Shifted & saved: {target_name} ({tw}x{th}) shifted down {shift}px")

    # Generate mediumtall (1068 x 650) from mediumtall_2x
    mt_2x = generated['hero_back_to_school_2026__cz07tzsg14sy_mediumtall_2x.jpg']
    mt_1x = mt_2x.resize((1068, 650), Image.Resampling.LANCZOS)
    for dest_dir in [LIVE_DIR, BACKUP_DIR]:
        dest_path = os.path.join(dest_dir, 'hero_back_to_school_2026__cz07tzsg14sy_mediumtall.jpg')
        mt_1x.save(dest_path, 'JPEG', quality=95, optimize=True)
    print("Downscaled & saved: hero_back_to_school_2026__cz07tzsg14sy_mediumtall.jpg (1068x650)")

if __name__ == '__main__':
    main()
