import os
import sys
import re
import math
import time
from PIL import Image, ImageDraw, ImageFont

def get_font(size, bold=False):
    font_name = 'segoeuib.ttf' if bold else 'segoeui.ttf'
    path = os.path.join('C:/Windows/Fonts', font_name)
    if os.path.exists(path):
        return ImageFont.truetype(path, max(8, int(size)))
    # fallback
    path_arial = os.path.join('C:/Windows/Fonts', 'arialbd.ttf' if bold else 'arial.ttf')
    if os.path.exists(path_arial):
        return ImageFont.truetype(path_arial, max(8, int(size)))
    return ImageFont.load_default()

def draw_camera_icon(draw, cx, cy, size=36, color=(140, 140, 145), width=2):
    w = int(size * 1.1)
    h = int(size * 0.75)
    top_w = int(size * 0.35)
    top_h = int(size * 0.18)
    draw.rectangle([cx - top_w//2, cy - h//2 - top_h, cx + top_w//2, cy - h//2], fill=color)
    draw.rounded_rectangle([cx - w//2, cy - h//2, cx + w//2, cy + h//2], radius=max(2, int(size*0.1)), outline=color, width=width)
    r = int(size * 0.22)
    draw.ellipse([cx - r, cy - r + 1, cx + r, cy + r + 1], outline=color, width=width)
    f_r = max(1, int(size * 0.04))
    draw.ellipse([cx + w//2 - int(size*0.25) - f_r, cy - h//2 + int(size*0.2) - f_r,
                  cx + w//2 - int(size*0.25) + f_r, cy - h//2 + int(size*0.2) + f_r], fill=color)

def get_aspect_ratio_str(w, h):
    ratio = w / h
    common = [
        (16/9, '16:9'), (16/10, '16:10'), (4/3, '4:3'), (1/1, '1:1'),
        (3/2, '3:2'), (21/9, '21:9'), (9/16, '9:16'), (3/4, '3:4'),
        (2/3, '2:3'), (4.35, '4.35:1'), (3.26, '3.26:1'), (2.6, '2.6:1')
    ]
    for r, s in common:
        if abs(ratio - r) < 0.05:
            return s
    return f'{ratio:.2f}:1'

def create_smooth_gradient(w, h, c1, c2, c3, c4):
    tiny = Image.new('RGB', (2, 2))
    tiny.putpixel((0, 0), c1)
    tiny.putpixel((1, 0), c2)
    tiny.putpixel((0, 1), c3)
    tiny.putpixel((1, 1), c4)
    return tiny.resize((w, h), Image.Resampling.BICUBIC)

def get_clean_name(filename):
    base = os.path.splitext(filename)[0]
    if base.endswith('.png') or base.endswith('.jpg'):
        base = os.path.splitext(base)[0]
    base = re.sub(r'__[a-z0-9]+', '', base)
    base = re.sub(r'-[a-f0-9]{8}$', '', base)
    base = re.sub(r'^[0-9]+_', '', base)
    base = base.replace('_', ' ').replace('-', ' ').strip().title()
    return base

def generate_placeholder(w, h, name='', is_dark=True, is_transparent=False, is_logo=False, tint=None):
    if is_transparent:
        im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(im)
        if is_logo or h <= 120:
            # Sleek translucent pill badge for logos
            pad_x = max(2, min(int(w * 0.05), 16))
            pad_y = max(2, min(int(h * 0.12), 10))
            x0, y0, x1, y1 = pad_x, pad_y, w - pad_x, h - pad_y
            r = min((y1 - y0) // 2, 14)
            if r > 0 and x1 > x0 and y1 > y0:
                draw.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=(15, 16, 20, 150), outline=(255, 255, 255, 130), width=1)
            font_size = max(8, min(int(h * 0.38), 22))
            font = get_font(font_size, bold=True)
            text = f'{w} × {h}'
            bbox = draw.textbbox((0, 0), text, font=font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text(((w - tw) // 2, (h - th) // 2 - 1), text, fill=(255, 255, 255, 245), font=font)
        else:
            # Floating translucent card for transparent overlays / cutouts
            cw = min(w - 20, max(260, int(w * 0.45)))
            ch = min(h - 20, max(120, int(h * 0.45)))
            x0 = (w - cw) // 2
            y0 = (h - ch) // 2
            draw.rounded_rectangle([x0, y0, x0 + cw, y0 + ch], radius=16, fill=(18, 20, 25, 190), outline=(255, 255, 255, 75), width=1)
            scale = min(cw, ch)
            icon_size = max(22, min(int(scale * 0.28), 44))
            draw_camera_icon(draw, w // 2, y0 + int(ch * 0.32), size=icon_size, color=(165, 170, 180), width=2)
            font_dim = get_font(max(11, min(int(scale * 0.14), 24)), bold=True)
            text_dim = f'{w} × {h} px'
            bbox = draw.textbbox((0, 0), text_dim, font=font_dim)
            draw.text(((w - (bbox[2]-bbox[0])) // 2, y0 + int(ch * 0.58)), text_dim, fill=(255, 255, 255, 245), font=font_dim)
            if name:
                font_name = get_font(max(9, min(int(scale * 0.08), 14)))
                bbox_n = draw.textbbox((0, 0), name, font=font_name)
                draw.text(((w - (bbox_n[2]-bbox_n[0])) // 2, y0 + int(ch * 0.78)), name, fill=(170, 175, 185, 230), font=font_name)
        return im

    # Non-transparent image
    if is_dark:
        if tint:
            c1 = (min(255, tint[0]//4 + 20), min(255, tint[1]//4 + 22), min(255, tint[2]//4 + 26))
            c2 = (min(255, tint[0]//5 + 16), min(255, tint[1]//5 + 18), min(255, tint[2]//5 + 22))
            c3 = (min(255, tint[0]//6 + 14), min(255, tint[1]//6 + 15), min(255, tint[2]//6 + 18))
            c4 = (12, 13, 16)
        else:
            c1, c2, c3, c4 = (28, 30, 36), (22, 24, 28), (18, 19, 23), (12, 13, 16)
        im = create_smooth_gradient(w, h, c1, c2, c3, c4)
        fg_color = (255, 255, 255)
        sec_color = (160, 163, 173)
        accent_color = (82, 86, 100)
        border_color = (48, 51, 62)
        pill_bg = (38, 41, 50)
        pill_border = (65, 69, 82)
    else:
        if tint:
            c1 = (max(220, 255 - tint[0]//8), max(220, 255 - tint[1]//8), max(220, 255 - tint[2]//8))
            c2 = (max(215, 248 - tint[0]//9), max(215, 248 - tint[1]//9), max(215, 248 - tint[2]//9))
            c3 = (max(210, 242 - tint[0]//10), max(210, 242 - tint[1]//10), max(210, 242 - tint[2]//10))
            c4 = (228, 230, 236)
        else:
            c1, c2, c3, c4 = (252, 252, 254), (245, 246, 249), (238, 240, 244), (228, 230, 236)
        im = create_smooth_gradient(w, h, c1, c2, c3, c4)
        fg_color = (29, 29, 31)
        sec_color = (110, 110, 115)
        accent_color = (160, 163, 173)
        border_color = (218, 220, 228)
        pill_bg = (235, 237, 242)
        pill_border = (205, 208, 216)

    draw = ImageDraw.Draw(im)

    # Inset frame
    inset = max(6, min(32, int(min(w, h) * 0.04)))
    if w > inset * 2 + 20 and h > inset * 2 + 20:
        draw.rounded_rectangle([inset, inset, w - inset, h - inset],
                               radius=max(3, min(14, int(min(w, h)*0.015))),
                               outline=border_color, width=1)
        # Technical Corner brackets
        blen = max(6, min(24, int(min(w, h) * 0.035)))
        # top-left
        draw.line([(inset, inset), (inset + blen, inset)], fill=accent_color, width=2)
        draw.line([(inset, inset), (inset, inset + blen)], fill=accent_color, width=2)
        # top-right
        draw.line([(w - inset, inset), (w - inset - blen, inset)], fill=accent_color, width=2)
        draw.line([(w - inset, inset), (w - inset, inset + blen)], fill=accent_color, width=2)
        # bottom-left
        draw.line([(inset, h - inset), (inset + blen, h - inset)], fill=accent_color, width=2)
        draw.line([(inset, h - inset), (inset, h - inset - blen)], fill=accent_color, width=2)
        # bottom-right
        draw.line([(w - inset, h - inset), (w - inset - blen, h - inset)], fill=accent_color, width=2)
        draw.line([(w - inset, h - inset), (w - inset, h - inset - blen)], fill=accent_color, width=2)

    scale = min(w, h)
    cx, cy = w // 2, h // 2

    if h < 90 or w < 160:
        # Compact single-line label
        font_dim = get_font(max(9, min(int(scale * 0.3), 20)), bold=True)
        text_dim = f'{w} × {h}'
        bbox = draw.textbbox((0, 0), text_dim, font=font_dim)
        draw.text(((w - (bbox[2]-bbox[0])) // 2, (h - (bbox[3]-bbox[1])) // 2), text_dim, fill=fg_color, font=font_dim)
    else:
        # Full rich layout
        icon_size = max(22, min(int(scale * 0.12), 52))
        font_dim_size = max(12, min(int(scale * 0.065), 44))
        font_sub_size = max(9, min(int(scale * 0.034), 18))
        font_pill_size = max(8, min(int(scale * 0.026), 13))

        font_dim = get_font(font_dim_size, bold=True)
        font_sub = get_font(font_sub_size, bold=False)
        font_pill = get_font(font_pill_size, bold=True)

        text_dim = f'{w} × {h} px'
        bbox_dim = draw.textbbox((0, 0), text_dim, font=font_dim)
        dim_w, dim_h = bbox_dim[2] - bbox_dim[0], bbox_dim[3] - bbox_dim[1]

        text_sub = name if name else 'Placeholder Image'
        bbox_sub = draw.textbbox((0, 0), text_sub, font=font_sub)
        sub_w, sub_h = bbox_sub[2] - bbox_sub[0], bbox_sub[3] - bbox_sub[1]

        aspect = get_aspect_ratio_str(w, h)
        bbox_pill = draw.textbbox((0, 0), aspect, font=font_pill)
        pill_w, pill_h = bbox_pill[2] - bbox_pill[0], bbox_pill[3] - bbox_pill[1]

        total_content_h = icon_size + 14 + dim_h + (8 + sub_h if sub_h else 0) + (14 + pill_h + 8 if scale > 240 else 0)
        start_y = cy - total_content_h // 2

        cur_y = start_y
        draw_camera_icon(draw, cx, cur_y + icon_size // 2, size=icon_size, color=accent_color, width=max(1, int(icon_size * 0.05)))
        cur_y += icon_size + 14

        draw.text(((w - dim_w) // 2, cur_y), text_dim, fill=fg_color, font=font_dim)
        cur_y += dim_h + 8

        if sub_w < w - inset * 2 - 20:
            draw.text(((w - sub_w) // 2, cur_y), text_sub, fill=sec_color, font=font_sub)
            cur_y += sub_h + 14

        if scale > 240:
            pw = pill_w + 18
            ph = pill_h + 8
            px0, py0 = (w - pw) // 2, cur_y
            draw.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=ph // 2, fill=pill_bg, outline=pill_border, width=1)
            draw.text((px0 + 9, py0 + 4), aspect, fill=sec_color, font=font_pill)

    return im

def get_standardized_dimensions(rel_path, orig_w, orig_h):
    filename = os.path.basename(rel_path).lower()
    
    # 1. OPPO INDIA
    if 'oppo-india' in rel_path.lower():
        if filename.startswith('hero_banner_'):
            return (1020, 357)
        if filename.startswith('hero_') or filename == 'find_x9s.jpg':
            return (1376, 768)
        if filename.startswith('explore_'):
            return (389, 258)
        if filename.startswith('offer_'):
            return (389, 266)
        if filename in ('chargingadpters.png', 'f33.jpg', 'oppo_bubble.jpg'):
            return (1024, 1024)
            
    # 2. APPLE TILES
    if 'images' in rel_path.lower() and 'tiles' in rel_path.lower():
        if 'logo' in filename:
            if 'small_2x' in filename: return (480, 100)
            if 'small' in filename: return (240, 50)
            if 'medium_2x' in filename: return (480, 100)
            if 'medium' in filename: return (240, 50)
            if 'large_2x' in filename: return (600, 120)
            if 'large' in filename: return (300, 60)
            
        is_hero = filename.startswith('hero_')
        if is_hero:
            if 'largetall_2x' in filename: return (6016, 1384)
            if 'largetall' in filename: return (3008, 692)
            if 'mediumtall_2x' in filename: return (2136, 1300)
            if 'mediumtall' in filename: return (1068, 650)
            if 'large_2x' in filename: return (6016, 1160)
            if 'large' in filename: return (3008, 580)
            if 'medium_2x' in filename: return (2136, 1140)
            if 'medium' in filename: return (1068, 570)
            if 'small_2x' in filename: return (1468, 1000)
            if 'small' in filename: return (734, 500)
            
        if 'large_2x' in filename: return (2524, 1160)
        if 'large' in filename: return (1262, 580)
        if 'medium_2x' in filename: return (1032, 980)
        if 'medium' in filename: return (516, 490)
        if 'small_2x' in filename: return (1468, 1000)
        if 'small' in filename: return (734, 500)
        
    # 3. APPLE GALLERY
    if 'images' in rel_path.lower() and 'gallery' in rel_path.lower():
        m = re.search(r'[-_]([0-9]+)x([0-9]+)', filename)
        if m:
            return (int(m.group(1)), int(m.group(2)))
            
    if 'seo' in rel_path.lower():
        return (1200, 630)
        
    return (orig_w, orig_h)

def process_backup_images():
    backup_root = os.path.normpath('public/sites.original-backup')
    target_root = os.path.normpath('public/sites')
    
    if not os.path.exists(backup_root):
        print(f'Error: Backup root {backup_root} does not exist!')
        return 0

    count = 0
    start_time = time.time()
    
    for root, _, files in os.walk(backup_root):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext in ('.png', '.jpg', '.jpeg', '.webp'):
                src_path = os.path.join(root, f)
                rel_path = os.path.relpath(src_path, backup_root)
                dest_path = os.path.join(target_root, rel_path)
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)

                if f.startswith('hero_back_to_school_2026__cz07tzsg14sy_') and ext == '.jpg':
                    # Preserve user custom artwork
                    continue
                if f.startswith('hero_back_to_school_startframe__cd4vg5frm39e_') and ext == '.png':
                    # Keep startframe fully transparent
                    empty = Image.new('RGBA', (20, 20), (0, 0, 0, 0))
                    empty.save(dest_path, 'PNG')
                    continue

                try:
                    with Image.open(src_path) as orig:
                        orig_w, orig_h = orig.size
                        w, h = get_standardized_dimensions(rel_path, orig_w, orig_h)
                        orig_format = orig.format
                        orig_mode = orig.mode
                        
                        is_transparent = False
                        if orig_mode in ('RGBA', 'LA') or (orig_mode == 'P' and 'transparency' in orig.info):
                            if orig_mode != 'RGBA':
                                orig_rgba = orig.convert('RGBA')
                            else:
                                orig_rgba = orig
                            alpha = orig_rgba.split()[-1]
                            min_a, max_a = alpha.getextrema()
                            if min_a < 250:
                                is_transparent = True
                        
                        # Determine theme / darkness
                        if not is_transparent:
                            thumb = orig.resize((20, 20)).convert('L')
                            avg_lum = sum(thumb.tobytes()) / 400.0
                            is_dark = avg_lum < 130
                        else:
                            is_dark = True
                        
                        is_logo = 'logo' in f.lower() or 'showlogo' in f.lower() or (is_transparent and h <= 120 and w <= 500)
                        clean_name = get_clean_name(f)

                        placeholder = generate_placeholder(
                            w=w, h=h,
                            name=clean_name,
                            is_dark=is_dark,
                            is_transparent=is_transparent,
                            is_logo=is_logo
                        )

                        if ext == '.png':
                            placeholder.save(dest_path, 'PNG', optimize=True)
                        else:
                            # JPEG
                            if placeholder.mode != 'RGB':
                                placeholder = placeholder.convert('RGB')
                            placeholder.save(dest_path, 'JPEG', quality=92)
                        
                        count += 1
                        if count % 25 == 0:
                            print(f'Processed {count} images...')
                except Exception as e:
                    print(f'Error processing {src_path}: {e}')

    elapsed = time.time() - start_time
    print(f'Successfully generated {count} placeholder images in {elapsed:.2f} seconds!')
    return count

def process_cases_protection():
    target_dir = os.path.normpath('public/sites/cases-protection/images')
    os.makedirs(target_dir, exist_ok=True)
    
    products_file = 'src/components/sites/cases-protection/data/products.ts'
    if not os.path.exists(products_file):
        return 0
        
    with open(products_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match products
    pattern = re.compile(r"id:\s*'([^']+)',\s*name:\s*'([^']+)',[\s\S]*?image:\s*'([^']+)'")
    matches = list(pattern.finditer(content))
    
    print(f'Generating {len(matches)} placeholder images for cases-protection...')
    count = 0
    for m in matches:
        p_id = m.group(1)
        p_name = m.group(2)
        old_url = m.group(3)
        dest_path = os.path.join(target_dir, f'{p_id}.jpg')
        
        # Determine case color tint from name if applicable
        tint = (30, 40, 60) if 'Blue' in p_name or 'Denim' in p_name else None
        
        im = generate_placeholder(
            w=600, h=600,
            name=p_name,
            is_dark=False,
            is_transparent=False,
            is_logo=False,
            tint=tint
        )
        if im.mode != 'RGB':
            im = im.convert('RGB')
        im.save(dest_path, 'JPEG', quality=92)
        count += 1
        
        # Replace image URL in file
        new_url = f'/sites/cases-protection/images/{p_id}.jpg'
        content = content.replace(f"image: '{old_url}'", f"image: '{new_url}'")
        
    with open(products_file, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f'Saved {count} cases-protection placeholders and updated {products_file}.')
    return count

def process_edu_store():
    target_dir = os.path.normpath('public/sites/edu-store/images')
    os.makedirs(target_dir, exist_ok=True)
    
    content_file = 'src/components/sites/edu-store/data/content.ts'
    if not os.path.exists(content_file):
        return 0
        
    with open(content_file, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Back to school offers (1200 x 750)
    offer_matches = [
        ('mac-offer', 'Mac with AirPods 4 - Back to School', 1200, 750, True),
        ('ipad-offer', 'iPad with Apple Pencil - Back to School', 1200, 750, False),
    ]
    # 2. Products (800 x 800)
    prod_matches = [
        ('mba-13-m4', 'MacBook Air 13-inch M4', 800, 800, False),
        ('mba-15-m4', 'MacBook Air 15-inch M4', 800, 800, False),
        ('mbp-14-m4', 'MacBook Pro 14-inch M4', 800, 800, True),
        ('ipad-pro-11', 'iPad Pro 11-inch M4', 800, 800, True),
        ('ipad-pro-13', 'iPad Pro 13-inch M4', 800, 800, True),
        ('ipad-air-11', 'iPad Air 11-inch M3', 800, 800, False),
        ('ipad-10', 'iPad 10th Generation', 800, 800, False),
    ]
    
    count = 0
    all_items = offer_matches + prod_matches
    print(f'Generating {len(all_items)} placeholder images for edu-store...')
    
    for item_id, item_name, w, h, is_dark in all_items:
        dest_path = os.path.join(target_dir, f'{item_id}.jpg')
        im = generate_placeholder(
            w=w, h=h,
            name=item_name,
            is_dark=is_dark,
            is_transparent=False,
            is_logo=False
        )
        if im.mode != 'RGB':
            im = im.convert('RGB')
        im.save(dest_path, 'JPEG', quality=92)
        count += 1
        
    # Replace URLs in content.ts
    # Match any store.storeimages.cdn-apple.com URLs in content.ts
    url_pattern = re.compile(r"id:\s*'([^']+)',[\s\S]*?image:\s*'(https://[^']+)'")
    for m in url_pattern.finditer(content):
        i_id = m.group(1)
        old_url = m.group(2)
        new_url = f'/sites/edu-store/images/{i_id}.jpg'
        content = content.replace(f"image: '{old_url}'", f"image: '{new_url}'")
        
    with open(content_file, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f'Saved {count} edu-store placeholders and updated {content_file}.')
    return count

if __name__ == '__main__':
    print('Starting placeholder generation for all project images...')
    total_public = process_backup_images()
    total_cases = process_cases_protection()
    total_edu = process_edu_store()
    print(f'Finished successfully! Total generated: {total_public + total_cases + total_edu} images.')

