"""
Generate 25 individual SVG QR codes (one per pot).
Pure vector — no raster, no logo, no decoration. Michiel imports them into his own design tool.

Output:
  /sessions/eager-charming-newton/mnt/Local/ellemelle-pot-qrs/pot-001.svg ... pot-025.svg
  /sessions/eager-charming-newton/mnt/Local/ellemelle-pot-qrs.zip   (all 25 zipped)
"""

import qrcode
from qrcode.image.svg import SvgPathImage
import os, zipfile

OUT_DIR = '/sessions/eager-charming-newton/mnt/Local/ellemelle-pot-qrs'
ZIP_PATH = '/sessions/eager-charming-newton/mnt/Local/ellemelle-pot-qrs.zip'

os.makedirs(OUT_DIR, exist_ok=True)

for n in range(1, 26):
    pot_id = f'POT-{n:03d}'
    url = f'https://ellemelle.netlify.app/pot/{pot_id}'
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
        image_factory=SvgPathImage,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image()
    img.save(os.path.join(OUT_DIR, f'pot-{n:03d}.svg'))

with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:
    for n in range(1, 26):
        f = f'pot-{n:03d}.svg'
        z.write(os.path.join(OUT_DIR, f), arcname=f)

print(f'25 SVGs written to {OUT_DIR}')
print(f'Zipped to {ZIP_PATH}')
