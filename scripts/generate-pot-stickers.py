"""
Generate a printable PDF with 25 ELLEMELLE pot QR stickers.
Each sticker contains:
  - ELLEMELLE wordmark/icon
  - Pot ID (POT-001 .. POT-025)
  - QR code linking to https://ellemelle.netlify.app/pot/POT-XXX

Layout: A4 portrait, 5x5 grid of stickers.
Output: /sessions/eager-charming-newton/mnt/Local/ellemelle-pot-stickers.pdf
"""

from PIL import Image, ImageDraw, ImageFont
import qrcode
import os

# A4 at 300 DPI
DPI = 300
A4_W = int(8.27 * DPI)   # 2481
A4_H = int(11.69 * DPI)  # 3507

COLS, ROWS = 5, 5
NUM_STICKERS = 25

PAGE_MARGIN = int(0.4 * DPI)  # 0.4 inch
STICKER_W = (A4_W - 2 * PAGE_MARGIN) // COLS
STICKER_H = (A4_H - 2 * PAGE_MARGIN) // ROWS

RED = (217, 48, 30)
CREAM = (254, 236, 226)
BLACK = (26, 26, 26)
WHITE = (255, 255, 255)

# Font: use a sans-serif TTF available in the sandbox
def load_font(size):
    candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/System/Library/Fonts/HelveticaNeue.ttc',
    ]
    for path in candidates:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

def make_qr(text, size_px):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(text)
    qr.make(fit=True)
    img = qr.make_image(fill_color='black', back_color='white').convert('RGB')
    return img.resize((size_px, size_px), Image.LANCZOS)

def make_sticker(pot_id, width, height):
    sticker = Image.new('RGB', (width, height), CREAM)
    draw = ImageDraw.Draw(sticker)
    # Border
    border_w = max(3, int(width * 0.015))
    inset = border_w
    draw.rounded_rectangle(
        [inset, inset, width - inset - 1, height - inset - 1],
        radius=int(width * 0.05), outline=RED, width=border_w,
    )
    pad = int(width * 0.07)
    # Brand label at top
    brand_font = load_font(int(width * 0.13))
    brand_text = 'ELLEMELLE'
    bbox = draw.textbbox((0, 0), brand_text, font=brand_font)
    bw = bbox[2] - bbox[0]
    bh = bbox[3] - bbox[1]
    bx = (width - bw) // 2
    by = pad
    draw.text((bx, by), brand_text, fill=RED, font=brand_font)
    # Pot ID below brand
    id_font = load_font(int(width * 0.10))
    bbox2 = draw.textbbox((0, 0), pot_id, font=id_font)
    iw = bbox2[2] - bbox2[0]
    ih = bbox2[3] - bbox2[1]
    iy = by + bh + int(pad * 0.5)
    draw.text(((width - iw) // 2, iy), pot_id, fill=BLACK, font=id_font)
    # QR code centered below
    qr_size = int(width * 0.62)
    qr_url = f'https://ellemelle.netlify.app/pot/{pot_id}'
    qr_img = make_qr(qr_url, qr_size)
    qr_x = (width - qr_size) // 2
    qr_y = iy + ih + int(pad * 0.7)
    sticker.paste(qr_img, (qr_x, qr_y))
    # URL hint at bottom (smaller)
    url_font = load_font(int(width * 0.038))
    label = 'scan = mijn pot'
    bbox3 = draw.textbbox((0, 0), label, font=url_font)
    lw = bbox3[2] - bbox3[0]
    draw.text(((width - lw) // 2, qr_y + qr_size + int(pad * 0.4)), label, fill=BLACK, font=url_font)
    return sticker

# Build the A4 page
page = Image.new('RGB', (A4_W, A4_H), WHITE)
for n in range(NUM_STICKERS):
    pot_id = f'POT-{n+1:03d}'
    row = n // COLS
    col = n % COLS
    x = PAGE_MARGIN + col * STICKER_W
    y = PAGE_MARGIN + row * STICKER_H
    sticker = make_sticker(pot_id, STICKER_W, STICKER_H)
    page.paste(sticker, (x, y))

# Save as PDF
out_pdf = '/sessions/eager-charming-newton/mnt/Local/ellemelle-pot-stickers.pdf'
out_png_preview = '/sessions/eager-charming-newton/mnt/Local/ellemelle-pot-stickers-preview.png'
page.save(out_pdf, 'PDF', resolution=DPI)
page.resize((A4_W // 4, A4_H // 4), Image.LANCZOS).save(out_png_preview, 'PNG')
print(f'PDF saved: {out_pdf}')
print(f'Preview PNG: {out_png_preview}')
print(f'Size: {os.path.getsize(out_pdf):,} bytes')
